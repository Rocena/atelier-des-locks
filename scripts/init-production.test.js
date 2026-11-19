// @ts-check
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/server/db/pool.js';
import { initProduction } from './init-production.js';

const SCRATCH = 'atelier_init_production_test';
const testUrl = /** @type {string} */ (process.env.TEST_DATABASE_URL);
const withDb = (/** @type {string} */ name) =>
  Object.assign(new URL(testUrl), { pathname: `/${name}` }).href;

/** @type {pg.Client} */
let admin;
/** @type {import('pg').Pool} */
let pool;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: withDb('postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
  await admin.query(`CREATE DATABASE ${SCRATCH}`);
  pool = createPool(withDb(SCRATCH));
}, 60_000);

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
  await admin.end();
}, 60_000);

describe('db:init (production)', { timeout: 90_000 }, () => {
  it('base neuve : migrations + catalogue, horaires et réglages, mais AUCUN avis d’exemple', async () => {
    const first = await initProduction(pool);
    expect(first.seeded).toBe(true);
    expect(first.migrations.length).toBeGreaterThan(0);
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM services)::int AS services,
              (SELECT count(*) FROM reviews)::int AS reviews,
              (SELECT count(*) FROM opening_hours)::int AS hours,
              (SELECT count(*) FROM settings WHERE key = 'booking.policy_text')::int AS policy`,
    );
    expect(rows[0].services).toBeGreaterThan(0);
    expect(rows[0].reviews).toBe(0);
    expect(rows[0].hours).toBeGreaterThan(0);
    expect(rows[0].policy).toBe(1);
  });

  it('relançable : ne touche ni aux prix ni aux textes déjà saisis', async () => {
    await pool.query(
      `UPDATE services SET name = 'Nom modifié par la propriétaire' WHERE id = (SELECT min(id) FROM services)`,
    );
    const again = await initProduction(pool);
    expect(again).toEqual({ migrations: [], seeded: false });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM services WHERE name = 'Nom modifié par la propriétaire'`,
    );
    expect(rows[0].n).toBe(1);
  });
});
