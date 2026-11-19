// @ts-check
/**
 * Cas d'usage de l'authentification de l'administration (§13) :
 * mot de passe (argon2id) → code TOTP ou code de secours → session serveur.
 * Une session « à mi-chemin » (mot de passe vérifié, 2FA non) ne donne accès à rien d'autre
 * qu'à l'écran de la 2FA ; l'identifiant est renouvelé à chaque changement de niveau.
 */
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateSessionToken,
  hashRecoveryCode,
  hashSessionToken,
} from './crypto.js';
import { isLocked, lockoutSeconds } from './lockout.js';
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from './password.js';
import { generateSecret, verifyTotp } from './totp.js';
import * as repo from './repo.js';

/** Inactivité maximale d'une session complète, et durée de vie absolue. */
export const IDLE_MINUTES = 30;
export const ABSOLUTE_HOURS = 12;
/** Une session à mi-chemin (mot de passe seul) expire vite. */
export const PENDING_MINUTES = 10;
/** On ne réécrit la date de dernière activité qu'une fois par minute. */
const TOUCH_EVERY_MS = 60_000;

/**
 * @typedef {object} AuthContext
 * @property {import('pg').Pool} db
 * @property {string} secret  SESSION_SECRET (clé de chiffrement et de hachage)
 * @property {Date} now
 * @property {string|null} [ip]
 * @property {string|null} [userAgent]
 */

/** @param {number} minutes @param {Date} from */
const plusMinutes = (from, minutes) => new Date(from.getTime() + minutes * 60_000);

/**
 * Crée une session et renvoie le jeton à mettre dans le cookie.
 * @param {AuthContext} ctx
 * @param {string} userId
 * @param {boolean} mfaVerified
 */
async function openSession(ctx, userId, mfaVerified) {
  const { token, hash } = generateSessionToken();
  await repo.insertSession(ctx.db, {
    tokenHash: hash,
    userId,
    mfaVerified,
    now: ctx.now,
    expiresAt: plusMinutes(ctx.now, mfaVerified ? IDLE_MINUTES : PENDING_MINUTES),
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
  return token;
}

/**
 * Compte un échec (mot de passe ou 2FA) et verrouille si besoin.
 * @param {AuthContext} ctx
 * @param {repo.User} user
 * @returns {Promise<{ locked: boolean }>}
 */
async function registerFailure(ctx, user) {
  const next = user.failedLoginCount + 1;
  const seconds = lockoutSeconds(next);
  const lockedUntil = seconds > 0 ? new Date(ctx.now.getTime() + seconds * 1000) : null;
  await repo.recordFailure(ctx.db, user.id, lockedUntil);
  return { locked: seconds > 0 };
}

/**
 * Étape 1 : adresse et mot de passe.
 * Réponse volontairement identique pour « compte inconnu », « mauvais mot de passe » et
 * « compte verrouillé » : on n'apprend rien sur les comptes existants.
 * @param {AuthContext} ctx
 * @param {{ email: string, password: string }} input
 * @returns {Promise<{ ok: true, token: string, user: repo.User, needsSetup: boolean } | { ok: false, reason: 'invalid'|'locked', user?: repo.User }>}
 */
export async function login(ctx, { email, password }) {
  const user = await repo.findUserByEmail(ctx.db, email.trim().toLowerCase());
  if (!user || !user.active) {
    await verifyAgainstDummy(password);
    return { ok: false, reason: 'invalid' };
  }
  if (isLocked(user.lockedUntil, ctx.now)) {
    await verifyAgainstDummy(password);
    return { ok: false, reason: 'locked', user };
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    const { locked } = await registerFailure(ctx, user);
    return { ok: false, reason: locked ? 'locked' : 'invalid', user };
  }
  const token = await openSession(ctx, user.id, false);
  return { ok: true, token, user, needsSetup: !user.totpConfirmedAt };
}

/**
 * Passe la session au niveau « complet » : nouvel identifiant, l'ancien est détruit.
 * @param {AuthContext} ctx
 * @param {repo.User} user
 * @param {Buffer} oldHash
 */
async function promoteSession(ctx, user, oldHash) {
  await repo.deleteSession(ctx.db, oldHash);
  await repo.recordSuccess(ctx.db, user.id, ctx.now);
  return openSession(ctx, user.id, true);
}

/**
 * Étape 2 : code TOTP à 6 chiffres, ou code de secours (usage unique).
 * @param {AuthContext} ctx
 * @param {{ user: repo.User, session: repo.SessionRow }} principal  session à mi-chemin
 * @param {{ code: string, kind: 'totp'|'recovery' }} input
 * @returns {Promise<{ ok: true, token: string, usedRecovery: boolean } | { ok: false, reason: 'invalid'|'locked' }>}
 */
export async function verifySecondFactor(ctx, { user, session }, { code, kind }) {
  const fresh = await repo.findUserById(ctx.db, user.id);
  if (!fresh || !fresh.totpConfirmedAt) return { ok: false, reason: 'invalid' };
  if (isLocked(fresh.lockedUntil, ctx.now)) return { ok: false, reason: 'locked' };

  /** @type {boolean} */
  let valid;
  if (kind === 'recovery') {
    valid = await repo.consumeRecoveryCode(ctx.db, fresh.id, hashRecoveryCode(code, ctx.secret));
  } else {
    const secret = decryptTotpSecret(fresh.totpSecretEncrypted, ctx.secret);
    const step = secret
      ? verifyTotp(secret, code, ctx.now, { lastStep: fresh.totpLastStep })
      : null;
    valid = step !== null && (await repo.consumeTotpStep(ctx.db, fresh.id, step));
  }
  if (!valid) {
    const { locked } = await registerFailure(ctx, fresh);
    return { ok: false, reason: locked ? 'locked' : 'invalid' };
  }
  const token = await promoteSession(ctx, fresh, session.tokenHash);
  return { ok: true, token, usedRecovery: kind === 'recovery' };
}

/**
 * Début de la configuration de la 2FA : génère (ou régénère, tant qu'elle n'est pas confirmée)
 * le secret, stocké chiffré. Le secret n'est jamais renvoyé une fois la 2FA confirmée.
 * @param {AuthContext} ctx
 * @param {repo.User} user
 * @returns {Promise<{ secret: string }|null>}  null si la 2FA est déjà active
 */
export async function beginTotpSetup(ctx, user) {
  const fresh = await repo.findUserById(ctx.db, user.id);
  if (!fresh || fresh.totpConfirmedAt) return null;
  const existing = decryptTotpSecret(fresh.totpSecretEncrypted, ctx.secret);
  const secret = existing ?? generateSecret();
  if (!existing) await repo.saveTotpSetup(ctx.db, fresh.id, encryptTotpSecret(secret, ctx.secret));
  return { secret };
}

/**
 * Fin de la configuration : le premier code prouve que l'application est bien configurée.
 * Renvoie les codes de secours EN CLAIR, une seule fois (seules leurs empreintes sont gardées).
 * @param {AuthContext} ctx
 * @param {{ user: repo.User, session: repo.SessionRow }} principal
 * @param {string} code
 * @returns {Promise<{ ok: true, token: string, recoveryCodes: string[] } | { ok: false, reason: 'invalid'|'locked' }>}
 */
export async function confirmTotpSetup(ctx, { user, session }, code) {
  const fresh = await repo.findUserById(ctx.db, user.id);
  if (!fresh || fresh.totpConfirmedAt) return { ok: false, reason: 'invalid' };
  if (isLocked(fresh.lockedUntil, ctx.now)) return { ok: false, reason: 'locked' };
  const secret = decryptTotpSecret(fresh.totpSecretEncrypted, ctx.secret);
  const step = secret ? verifyTotp(secret, code, ctx.now) : null;
  if (step === null) {
    const { locked } = await registerFailure(ctx, fresh);
    return { ok: false, reason: locked ? 'locked' : 'invalid' };
  }
  const recoveryCodes = generateRecoveryCodes();
  await repo.confirmTotp(
    ctx.db,
    fresh.id,
    step,
    recoveryCodes.map((c) => hashRecoveryCode(c, ctx.secret)),
    ctx.now,
  );
  const token = await promoteSession(ctx, fresh, session.tokenHash);
  return { ok: true, token, recoveryCodes };
}

/**
 * Valide le cookie : session existante, non expirée (inactivité et durée absolue), compte actif.
 * Prolonge la session (fenêtre glissante, plafonnée à 12 h depuis la connexion).
 * @param {AuthContext} ctx
 * @param {string|undefined} token
 * @returns {Promise<{ user: repo.User, session: repo.SessionRow }|null>}
 */
export async function authenticate(ctx, token) {
  if (!token || token.length > 100) return null;
  const hash = hashSessionToken(token);
  const found = await repo.findSession(ctx.db, hash, ctx.now);
  if (!found) return null;
  const { session } = found;
  const hardLimit = plusMinutes(session.createdAt, ABSOLUTE_HOURS * 60);
  if (ctx.now >= hardLimit) {
    await repo.deleteSession(ctx.db, hash);
    return null;
  }
  if (ctx.now.getTime() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    const idle = plusMinutes(ctx.now, session.mfaVerified ? IDLE_MINUTES : PENDING_MINUTES);
    await repo.touchSession(ctx.db, hash, ctx.now, idle < hardLimit ? idle : hardLimit);
  }
  return found;
}

/** @param {AuthContext} ctx @param {string|undefined} token */
export async function logout(ctx, token) {
  if (token) await repo.deleteSession(ctx.db, hashSessionToken(token));
}

/**
 * Changement de mot de passe : demande l'ancien, déconnecte les autres sessions.
 * @param {AuthContext} ctx
 * @param {{ user: repo.User, session: repo.SessionRow }} principal
 * @param {{ current: string, next: string }} input
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function changePassword(ctx, { user, session }, { current, next }) {
  const fresh = await repo.findUserById(ctx.db, user.id);
  if (!fresh || !(await verifyPassword(fresh.passwordHash, current))) {
    if (fresh) await registerFailure(ctx, fresh);
    return { ok: false, error: 'Le mot de passe actuel est incorrect.' };
  }
  const problem = passwordProblem(next, { email: fresh.email });
  if (problem) return { ok: false, error: problem };
  await repo.updatePassword(ctx.db, fresh.id, await hashPassword(next));
  await repo.deleteUserSessions(ctx.db, fresh.id, session.tokenHash);
  return { ok: true };
}

/**
 * Régénère les codes de secours (les anciens cessent de fonctionner). Exige un code TOTP.
 * @param {AuthContext} ctx
 * @param {repo.User} user
 * @param {string} code
 * @returns {Promise<{ ok: true, recoveryCodes: string[] } | { ok: false }>}
 */
export async function regenerateRecoveryCodes(ctx, user, code) {
  const fresh = await repo.findUserById(ctx.db, user.id);
  const secret = fresh ? decryptTotpSecret(fresh.totpSecretEncrypted, ctx.secret) : null;
  const step =
    secret && fresh ? verifyTotp(secret, code, ctx.now, { lastStep: fresh.totpLastStep }) : null;
  if (!fresh || step === null || !(await repo.consumeTotpStep(ctx.db, fresh.id, step))) {
    if (fresh) await registerFailure(ctx, fresh);
    return { ok: false };
  }
  const recoveryCodes = generateRecoveryCodes();
  await repo.replaceRecoveryCodes(
    ctx.db,
    fresh.id,
    recoveryCodes.map((c) => hashRecoveryCode(c, ctx.secret)),
  );
  return { ok: true, recoveryCodes };
}

/**
 * Création d'un compte (script en ligne de commande, tests).
 * @param {import('pg').Pool} db
 * @param {{ email: string, displayName: string, password: string, role: 'owner'|'staff', staffId?: number|null }} input
 * @returns {Promise<{ ok: true, id: string } | { ok: false, error: string }>}
 */
export async function createUser(db, input) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: 'Adresse email invalide.' };
  if (!input.displayName.trim()) return { ok: false, error: 'Le nom affiché est obligatoire.' };
  const problem = passwordProblem(input.password, { email });
  if (problem) return { ok: false, error: problem };
  if (await repo.findUserByEmail(db, email)) return { ok: false, error: 'Ce compte existe déjà.' };
  const id = await repo.insertUser(db, {
    email,
    displayName: input.displayName.trim(),
    passwordHash: await hashPassword(input.password),
    role: input.role,
    staffId: input.staffId ?? null,
  });
  return { ok: true, id };
}
