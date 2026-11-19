// @ts-check
/**
 * Initialise une base de PRODUCTION neuve : migrations, puis contenus de départ.
 *
 *   npm run db:init     (dans Docker : docker compose exec app npm run db:init)
 *
 * Sûr à relancer : si le catalogue existe déjà, rien n'est touché (ni vos prix, ni vos textes).
 * Différences avec `db:seed` (réservé au développement) :
 *   - les avis d'exemple ne sont PAS chargés (le site masque la section tant qu'il n'y en a pas) ;
 *   - refus de s'exécuter hors production (utiliser `db:seed` en développement).
 * Les prix, durées et photos chargés sont des exemples marqués « à confirmer » dans l'admin.
 */
import { fileURLToPath } from 'node:url';
import { loadConfig, loadDotEnv } from '../src/server/config.js';
import { migrate } from '../src/server/db/migrate.js';
import { createPool, withTransaction } from '../src/server/db/pool.js';
import { seedContent } from '../src/server/db/seed-content.js';

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ migrations: string[], seeded: boolean }>}
 */
export async function initProduction(pool) {
  const migrations = await migrate(pool);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM services');
  if (rows[0].n > 0) return { migrations, seeded: false };
  await withTransaction(pool, async (client) => {
    // Réglages par défaut (délais, politique de RDV…) puis contenus, sans avis d'exemple.
    const { readFile } = await import('node:fs/promises');
    const settingsSql = fileURLToPath(
      new URL('../src/server/db/seeds/0001_reglages.sql', import.meta.url),
    );
    await client.query(await readFile(settingsSql, 'utf8'));
    await seedContent(client, { sampleReviews: false });
  });
  return { migrations, seeded: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadDotEnv();
  const config = loadConfig();
  if (!config.isProd) {
    console.error('db:init est réservé à la production. En développement : npm run db:seed.');
    process.exit(1);
  }
  const pool = createPool(config.databaseUrl);
  try {
    const { migrations, seeded } = await initProduction(pool);
    console.info(
      migrations.length ? `Migrations appliquées : ${migrations.join(', ')}` : 'Base à jour.',
    );
    console.info(
      seeded
        ? 'Contenus de départ chargés (sans avis d’exemple). Prix et durées : à confirmer dans l’admin.'
        : 'Le catalogue existe déjà : rien à charger.',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
