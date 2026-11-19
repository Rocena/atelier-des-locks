// @ts-check
/**
 * Supprime les rendez-vous et clientes créés par les tests e2e (base de développement).
 * Ne touche qu'aux adresses « @e2e.test.invalid » (domaine réservé, jamais une vraie cliente).
 */
import { loadConfig, loadDotEnv } from '../../src/server/config.js';
import { createPool } from '../../src/server/db/pool.js';

export default async function cleanup() {
  loadDotEnv();
  const { databaseUrl } = loadConfig({ SESSION_SECRET: 'x'.repeat(48), ...process.env });
  const pool = createPool(databaseUrl);
  const pattern = '%@e2e.test.invalid';
  try {
    await pool.query(
      'DELETE FROM appointments WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)',
      [pattern],
    );
    await pool.query('DELETE FROM clients WHERE email LIKE $1', [pattern]);
  } finally {
    await pool.end();
  }
}
