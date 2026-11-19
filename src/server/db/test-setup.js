// @ts-check
/**
 * Vitest (globalSetup) : prépare une base dédiée aux tests (« <base>_test »), migrée et seedée.
 * Les tests n'écrivent jamais dans la base de développement. L'URL est exposée aux tests via
 * process.env.TEST_DATABASE_URL (cf. test-helpers.js).
 * Si PostgreSQL est injoignable, on échoue avec un message clair (npm run db:up).
 */
import pg from 'pg';
import { loadConfig, loadDotEnv } from '../config.js';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';
import { runSeeds } from './seed.js';

export default async function setup() {
  loadDotEnv();
  const { databaseUrl } = loadConfig({ SESSION_SECRET: 'x'.repeat(48), ...process.env });
  const url = new URL(databaseUrl);
  const testName = `${url.pathname.slice(1)}_test`;

  // Création de la base de test si besoin (connexion à la base d'administration « postgres »).
  const admin = new pg.Client({
    connectionString: Object.assign(new URL(databaseUrl), { pathname: '/postgres' }).href,
  });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `PostgreSQL injoignable pour les tests (${error instanceof Error ? error.message : error}). Lancez « npm run db:up ».`,
      { cause: error },
    );
  }
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    testName,
  ]);
  // Un nom de base ne se paramètre pas : il est issu de DATABASE_URL, on le valide strictement.
  if (!rowCount) {
    if (!/^[a-z0-9_]+$/.test(testName))
      throw new Error(`Nom de base de test invalide : ${testName}`);
    await admin.query(`CREATE DATABASE ${testName}`);
  }
  await admin.end();

  const testUrl = Object.assign(new URL(databaseUrl), { pathname: `/${testName}` }).href;
  process.env.TEST_DATABASE_URL = testUrl;
  const pool = createPool(testUrl);
  try {
    await migrate(pool);
    await runSeeds(pool);
  } finally {
    await pool.end();
  }
}
