// @ts-check
/**
 * Données de départ (idempotent : relançable sans doublons).
 * Exécute src/server/db/seeds/*.sql dans l'ordre, puis charge les contenus JSON (seed-content.js),
 * le tout dans une seule transaction.
 * Les prix et durées seedés sont des exemples (is_placeholder = true) à faire valider.
 * Usage : npm run db:seed   (après npm run db:migrate)
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadDotEnv } from '../config.js';
import { createPool, withTransaction } from './pool.js';
import { seedContent } from './seed-content.js';

const SEEDS_DIR = fileURLToPath(new URL('./seeds', import.meta.url));

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<string[]>} fichiers SQL exécutés
 */
export async function runSeeds(pool) {
  const files = (await readdir(SEEDS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  await withTransaction(pool, async (client) => {
    for (const file of files) {
      await client.query(await readFile(`${SEEDS_DIR}/${file}`, 'utf8'));
    }
    await seedContent(client);
  });
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadDotEnv();
  const config = loadConfig();
  if (config.isProd) {
    console.error('db:seed est réservé au développement.');
    process.exit(1);
  }
  const pool = createPool(config.databaseUrl);
  try {
    const files = await runSeeds(pool);
    console.info(
      `Seeds exécutés : ${files.join(', ')} + contenus JSON (catalogue, galerie, avis…)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
