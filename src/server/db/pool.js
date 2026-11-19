// @ts-check
/**
 * Pool PostgreSQL partagé. Règle absolue : requêtes paramétrées ($1, $2…), jamais de concaténation.
 * Le SQL métier ne vit que dans les repo.js des modules.
 */
import pg from 'pg';

/** @param {string} connectionString */
export function createPool(connectionString) {
  // Toutes les dates en UTC côté base (option de session) ; conversion Europe/Paris à l'affichage.
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    // Keep-alive TCP : certains proxys (Docker Desktop, pare-feu) coupent en silence les
    // connexions inactives ; une requête envoyée dessus resterait sans réponse.
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    options: '-c timezone=UTC',
  });
}

/**
 * Exécute une fonction dans une transaction (BEGIN / COMMIT, ROLLBACK en cas d'erreur).
 * @template T
 * @param {pg.Pool} pool
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
