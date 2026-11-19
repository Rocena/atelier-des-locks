// @ts-check
/**
 * Aides de test de l'administration : comptes, sessions posées directement en base (sans passer
 * par le formulaire), jeton CSRF. Les adresses de test sont en @admin.test.invalid : nettoyées
 * par cleanupAdminUsers().
 */
import { buildApp } from '../../app.js';
import { testConfig } from '../../test-helpers.js';
import { generateSessionToken } from '../auth/crypto.js';
import { hashPassword } from '../auth/password.js';
import * as repo from '../auth/repo.js';

export const ADMIN_EMAIL_DOMAIN = '@admin.test.invalid';
export const TEST_PASSWORD = 'correct horse battery staple 42';
export const TEST_NOW = new Date('2026-11-20T10:00:00Z');

let counter = 0;
/** @type {string|null} */
let sharedHash = null;

/**
 * @param {import('pg').Pool} pool
 * @param {{ role?: 'owner'|'staff', totp?: boolean, active?: boolean }} [options]
 */
export async function createTestUser(pool, { role = 'owner', totp = true, active = true } = {}) {
  counter += 1;
  sharedHash ??= await hashPassword(TEST_PASSWORD);
  const email = `${role}${counter}-${Date.now()}${ADMIN_EMAIL_DOMAIN}`;
  const id = await repo.insertUser(pool, {
    email,
    displayName: role === 'owner' ? 'Propriétaire Test' : 'Équipe Test',
    passwordHash: sharedHash,
    role,
  });
  if (totp) await pool.query('UPDATE users SET totp_confirmed_at = now() WHERE id = $1', [id]);
  if (!active) await pool.query('UPDATE users SET active = false WHERE id = $1', [id]);
  return { id, email, role };
}

/**
 * Ouvre une session. `mfa: false` = mot de passe vérifié, 2FA en attente.
 * @param {import('pg').Pool} pool
 * @param {string} userId
 * @param {{ mfa?: boolean, createdAt?: Date, lastSeenAt?: Date, expiresAt?: Date, now?: Date }} [options]
 * @returns {Promise<{ cookie: string, token: string }>}
 */
export async function openTestSession(pool, userId, options = {}) {
  const now = options.now ?? TEST_NOW;
  const { token, hash } = generateSessionToken();
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, mfa_verified, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      hash,
      userId,
      options.mfa ?? true,
      options.createdAt ?? now,
      options.lastSeenAt ?? now,
      options.expiresAt ?? new Date(now.getTime() + 30 * 60_000),
    ],
  );
  return { token, cookie: `adl_admin=${token}` };
}

/** Supprime les comptes de test (sessions et journaux en cascade ou orphelins). @param {import('pg').Pool} pool */
export async function cleanupAdminUsers(pool) {
  await pool.query(
    `DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`%${ADMIN_EMAIL_DOMAIN}`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${ADMIN_EMAIL_DOMAIN}`]);
}

/**
 * Application de test (horloge figée, file en mémoire, notifications espionnées).
 * @param {import('pg').Pool} pool
 * @param {{ env?: Record<string, string>, now?: Date | (() => Date) }} [options]
 */
export async function makeAdminApp(pool, { env = {}, now = TEST_NOW } = {}) {
  const app = await buildApp({
    config: testConfig({ UPLOAD_DIR: env.UPLOAD_DIR ?? 'storage/test-admin-uploads', ...env }),
    logger: false,
    db: pool,
    now: typeof now === 'function' ? now : () => now,
  });
  /** @type {Array<{ event: string, args: any }>} */
  const events = [];
  for (const event of [
    'appointmentBooked',
    'appointmentRescheduled',
    'appointmentValidated',
    'appointmentCancelled',
    'appointmentCompleted',
  ]) {
    /** @type {any} */ (app.notifications)[event] = async (/** @type {any} */ args) => {
      events.push({ event, args });
    };
  }
  return { app, events };
}

/**
 * Jeton CSRF + cookie associé pour une session (page « Mon compte »).
 * @param {import('fastify').FastifyInstance} app
 * @param {string} sessionCookie
 */
export async function csrfFor(app, sessionCookie) {
  const res = await app.inject({ url: '/admin/compte', headers: { cookie: sessionCookie } });
  const token = /name="csrf-token" content="([^"]+)"/.exec(res.body)?.[1] ?? '';
  const csrfCookie = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { token, cookie: [sessionCookie, csrfCookie].filter(Boolean).join('; ') };
}
