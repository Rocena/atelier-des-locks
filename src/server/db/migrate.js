// @ts-check
/**
 * Applique les migrations SQL de src/server/db/migrations, dans l'ordre alphabétique
 * (NNNN_description.sql). Chaque fichier s'exécute dans sa propre transaction et n'est
 * appliqué qu'une fois (table schema_migrations). Une migration appliquée ne se modifie
 * jamais : on en écrit une nouvelle.
 * Usage : npm run db:migrate
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadDotEnv } from '../config.js';
import { createPool, withTransaction } from './pool.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

/** @param {import('pg').Pool} pool */
export async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT name, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));
  const done = [];

  for (const file of files) {
    const sql = await readFile(`${MIGRATIONS_DIR}/${file}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) {
        throw new Error(
          `La migration ${file} a été modifiée après application. Créez-en une nouvelle.`,
        );
      }
      continue;
    }
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ]);
    });
    done.push(file);
  }
  return done;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadDotEnv();
  const pool = createPool(loadConfig().databaseUrl);
  try {
    const done = await migrate(pool);
    console.info(done.length ? `Migrations appliquées : ${done.join(', ')}` : 'Base à jour.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
