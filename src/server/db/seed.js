// @ts-check
/**
 * Données de départ (idempotent : relançable sans doublons).
 * Exécute src/server/db/seeds/*.sql dans l'ordre, dans une seule transaction.
 * Les prix et durées seedés sont des exemples (is_placeholder = true) à faire valider.
 * Usage : npm run db:seed   (après npm run db:migrate)
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadDotEnv } from '../config.js';
import { createPool, withTransaction } from './pool.js';

const SEEDS_DIR = fileURLToPath(new URL('./seeds', import.meta.url));

loadDotEnv();
const config = loadConfig();
if (config.isProd) {
  console.error('db:seed est réservé au développement.');
  process.exit(1);
}

const pool = createPool(config.databaseUrl);
try {
  const files = (await readdir(SEEDS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  await withTransaction(pool, async (client) => {
    for (const file of files) {
      await client.query(await readFile(`${SEEDS_DIR}/${file}`, 'utf8'));
    }
  });
  console.info(files.length ? `Seeds exécutés : ${files.join(', ')}` : 'Aucun seed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
