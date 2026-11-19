// @ts-check
/**
 * Mots de passe : argon2id (paramètres OWASP par défaut de @node-rs/argon2 : 19 Mo, 2 passes).
 */
import { hash, verify, Algorithm } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 12;

/** @param {string} password */
export const hashPassword = (password) => hash(password, { algorithm: Algorithm.Argon2id });

/**
 * @param {string} stored
 * @param {string} password
 */
export async function verifyPassword(stored, password) {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** @type {string|null} */
let dummyHash = null;

/**
 * Quand le compte n'existe pas, on vérifie quand même un faux hash : même durée de réponse,
 * donc impossible de deviner quelles adresses ont un compte.
 * @param {string} password
 */
export async function verifyAgainstDummy(password) {
  dummyHash ??= await hashPassword('mot-de-passe-factice-pour-egaliser-les-durees');
  await verifyPassword(dummyHash, password);
}

/**
 * Règles du mot de passe : 12 caractères au moins, pas un mot de passe évident.
 * @param {string} password
 * @param {{ email?: string }} [context]
 * @returns {string|null}  message d'erreur, ou null si valide
 */
export function passwordProblem(password, { email = '' } = {}) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  if (password.length > 200) return 'Le mot de passe est trop long.';
  if (/^(.)\1+$/.test(password)) return 'Ce mot de passe est trop simple.';
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) {
    return 'Le mot de passe ne doit pas contenir votre adresse email.';
  }
  return null;
}
