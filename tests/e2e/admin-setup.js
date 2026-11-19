// @ts-check
/**
 * Prépare les comptes de test de l'admin avant la suite e2e, et une session déjà ouverte par
 * compte (fichiers « storageState » dans tests/e2e/.auth/). La connexion par formulaire a ses
 * propres tests ; les autres parcours démarrent connectés, sans rejouer mot de passe et code.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { generateSessionToken } from '../../src/server/modules/auth/crypto.js';
import { USERS, DOMAIN, purge, seedUsers, withDb } from './admin-fixture.js';

export default async function setup() {
  await mkdir('tests/e2e/.auth', { recursive: true });
  await withDb(async (db) => {
    await purge(db);
    await seedUsers(db);
    for (const key of Object.keys(USERS)) {
      const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [`${key}${DOMAIN}`]);
      const { token, hash } = generateSessionToken();
      await db.query(
        `INSERT INTO sessions (token_hash, user_id, mfa_verified, expires_at)
         VALUES ($1, $2, true, now() + interval '30 minutes')`,
        [hash, rows[0].id],
      );
      const state = {
        cookies: [
          {
            name: 'adl_admin',
            value: token,
            domain: '127.0.0.1',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: 'Strict',
          },
        ],
        origins: [],
      };
      await writeFile(`tests/e2e/.auth/${key}.json`, JSON.stringify(state));
    }
  });
}
