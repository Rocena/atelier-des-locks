// @ts-check
/**
 * Comptes et données de test de l'administration pour les e2e (base de développement).
 * Tout ce qui est créé porte le domaine réservé « @admin-e2e.test.invalid » ou le préfixe « E2E »,
 * et disparaît avant et après la suite (admin-setup.js, admin-teardown.js).
 */
import { loadConfig, loadDotEnv } from '../../src/server/config.js';
import { createPool } from '../../src/server/db/pool.js';
import { encryptTotpSecret } from '../../src/server/modules/auth/crypto.js';
import { createUser } from '../../src/server/modules/auth/service.js';

export const DOMAIN = '@admin-e2e.test.invalid';
export const PASSWORD = 'e2e correct horse battery 42';
/** Même secret que le serveur lancé par playwright.config.js : il chiffre les secrets TOTP. */
export const SESSION_SECRET = 'e2e-'.padEnd(48, 'x');

/** Comptes prêts à l'emploi (2FA déjà configurée) : un par projet et par rôle (pas de rejeu de code). */
export const USERS = /** @type {const} */ ({
  'owner-desktop': { role: 'owner', secret: 'JBSWY3DPEHPK3PXP' },
  'staff-desktop': { role: 'staff', secret: 'KRSXG5CTMVRXEZLU' },
  'owner-mobile': { role: 'owner', secret: 'MFRGGZDFMZTWQ2LK' },
  'staff-mobile': { role: 'staff', secret: 'NBSWY3DPFQQHO33S' },
});
/** Compte neuf (2FA à configurer) pour le parcours de première connexion. */
export const NEW_USERS = /** @type {const} */ (['new-desktop', 'new-mobile']);

/** @param {(db: import('pg').Pool) => Promise<void>} fn */
export async function withDb(fn) {
  loadDotEnv();
  const { databaseUrl } = loadConfig({ SESSION_SECRET, ...process.env });
  const db = createPool(databaseUrl);
  try {
    await fn(db);
  } finally {
    await db.end();
  }
}

/** @param {import('pg').Pool} db */
export async function purge(db) {
  const clients = `SELECT id FROM clients WHERE email LIKE '%${DOMAIN}' OR email LIKE 'tel-%@sans-email.invalid'`;
  await db.query(
    `DELETE FROM reviews WHERE author_name LIKE 'E2E%' OR appointment_id IN (SELECT id FROM appointments WHERE client_id IN (${clients}))`,
  );
  await db.query(`DELETE FROM notifications_log WHERE client_id IN (${clients})`);
  await db.query(`DELETE FROM appointments WHERE client_id IN (${clients})`);
  await db.query(`DELETE FROM clients WHERE id IN (${clients})`);
  await db.query(`DELETE FROM gallery_items WHERE title LIKE 'E2E %'`);
  await db.query(`DELETE FROM services WHERE slug LIKE 'e2e-%'`);
  await db.query(`DELETE FROM blocks WHERE reason LIKE 'E2E%'`);
  await db.query(
    `DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${DOMAIN}')`,
  );
  await db.query(`DELETE FROM users WHERE email LIKE '%${DOMAIN}'`);
}

/** Crée les comptes de test. @param {import('pg').Pool} db */
export async function seedUsers(db) {
  for (const [key, { role, secret }] of Object.entries(USERS)) {
    const created = await createUser(db, {
      email: `${key}${DOMAIN}`,
      displayName: role === 'owner' ? 'Propriétaire E2E' : 'Équipe E2E',
      password: PASSWORD,
      role,
    });
    if (!created.ok) throw new Error(created.error);
    await db.query(
      'UPDATE users SET totp_secret_encrypted = $2, totp_confirmed_at = now() WHERE id = $1',
      [created.id, encryptTotpSecret(secret, SESSION_SECRET)],
    );
  }
  for (const key of NEW_USERS) {
    const created = await createUser(db, {
      email: `${key}${DOMAIN}`,
      displayName: 'Nouvelle E2E',
      password: PASSWORD,
      role: 'owner',
    });
    if (!created.ok) throw new Error(created.error);
  }
}

/** Autorise une nouvelle connexion dans la même fenêtre de 30 s (rejeu de code). @param {string} key */
export async function resetTotpStep(key) {
  await withDb(async (db) => {
    await db.query(
      `UPDATE users SET totp_last_step = NULL, failed_login_count = 0, locked_until = NULL WHERE email = $1`,
      [`${key}${DOMAIN}`],
    );
  });
}
