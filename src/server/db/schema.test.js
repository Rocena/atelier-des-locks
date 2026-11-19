// @ts-check
import { afterAll, describe, expect, it } from 'vitest';
import { testPool } from '../test-helpers.js';
import { withTransaction } from './pool.js';

const pool = testPool();
afterAll(() => pool.end());

/** Sert à annuler la transaction de test sans faire échouer le test. */
class Rollback extends Error {}

/**
 * Exécute `fn` dans une transaction toujours annulée : la base de test reste intacte.
 * @param {(c: import('pg').PoolClient) => Promise<void>} fn
 */
async function sandbox(fn) {
  await withTransaction(pool, async (c) => {
    await fn(c);
    throw new Rollback();
  }).catch((e) => {
    if (!(e instanceof Rollback)) throw e;
  });
}

/**
 * Insère une cliente et renvoie de quoi réserver.
 * @param {import('pg').PoolClient} c
 */
async function fixtures(c) {
  const staff = (await c.query('SELECT min(id) AS id FROM staff')).rows[0].id;
  const service = (await c.query('SELECT min(id) AS id FROM services')).rows[0].id;
  const client = (
    await c.query(
      `INSERT INTO clients (first_name, last_name, email)
       VALUES ('Test', 'Cliente', 'test@example.org') RETURNING id`,
    )
  ).rows[0].id;
  /**
   * @param {string} start
   * @param {string} end
   * @param {string} [status]
   */
  const book = (start, end, status = 'confirmed') =>
    c.query(
      `INSERT INTO appointments (client_id, staff_id, service_id, status, starts_at, ends_at,
         duration_minutes, policy_accepted_at)
       VALUES ($1, $2, $3, $6, $4, $5, 60, now()) RETURNING id`,
      [client, staff, service, start, end, status],
    );
  return { staff, service, client, book };
}

describe('contrainte anti-chevauchement des rendez-vous (§7.3)', () => {
  it('refuse deux rendez-vous qui se chevauchent pour la même praticienne', async () => {
    await sandbox(async (c) => {
      const { book } = await fixtures(c);
      await book('2030-01-10 09:00+00', '2030-01-10 12:00+00');
      await c.query('SAVEPOINT s');
      await expect(book('2030-01-10 11:00+00', '2030-01-10 14:00+00')).rejects.toMatchObject({
        code: '23P01',
      });
      await c.query('ROLLBACK TO s');
    });
  });

  it('accepte des rendez-vous qui se touchent (fin = début suivant)', async () => {
    await sandbox(async (c) => {
      const { book } = await fixtures(c);
      await book('2030-01-10 09:00+00', '2030-01-10 12:00+00');
      await expect(book('2030-01-10 12:00+00', '2030-01-10 13:00+00')).resolves.toBeTruthy();
    });
  });

  it('libère le créneau quand le rendez-vous est annulé', async () => {
    await sandbox(async (c) => {
      const { book } = await fixtures(c);
      await book('2030-01-10 09:00+00', '2030-01-10 12:00+00', 'cancelled_by_client');
      await expect(book('2030-01-10 10:00+00', '2030-01-10 11:00+00')).resolves.toBeTruthy();
    });
  });

  it('autorise le même créneau pour une autre praticienne', async () => {
    await sandbox(async (c) => {
      const { book, client, service } = await fixtures(c);
      await book('2030-01-10 09:00+00', '2030-01-10 12:00+00');
      const other = (
        await c.query(`INSERT INTO staff (display_name) VALUES ('Autre') RETURNING id`)
      ).rows[0].id;
      await expect(
        c.query(
          `INSERT INTO appointments (client_id, staff_id, service_id, starts_at, ends_at,
             duration_minutes, policy_accepted_at)
           VALUES ($1, $2, $3, '2030-01-10 09:00+00', '2030-01-10 12:00+00', 180, now())`,
          [client, other, service],
        ),
      ).resolves.toBeTruthy();
    });
  });
});

describe('autres garde-fous du schéma', () => {
  it('interdit deux plages d’ouverture qui se chevauchent le même jour', async () => {
    await sandbox(async (c) => {
      const { staff } = await fixtures(c);
      const insert = (/** @type {string} */ from, /** @type {string} */ to) =>
        c.query(
          `INSERT INTO opening_hours (staff_id, weekday, opens_at, closes_at)
           VALUES ($1, 7, $2, $3)`,
          [staff, from, to],
        );
      await insert('09:00', '12:00');
      await c.query('SAVEPOINT s');
      await expect(insert('11:00', '14:00')).rejects.toMatchObject({ code: '23P01' });
      await c.query('ROLLBACK TO s');
      await expect(insert('14:00', '18:00')).resolves.toBeTruthy();
    });
  });

  it('audit_log est en ajout seul', async () => {
    await sandbox(async (c) => {
      const { rows } = await c.query(`INSERT INTO audit_log (action) VALUES ('test') RETURNING id`);
      await expect(
        c.query(`UPDATE audit_log SET action = 'x' WHERE id = $1`, [rows[0].id]),
      ).rejects.toThrow(/ajout seul/);
    });
  });

  it('refuse un avis publié sans consentement et un avis vérifié sans rendez-vous', async () => {
    await sandbox(async (c) => {
      await c.query('SAVEPOINT s');
      await expect(
        c.query(
          `INSERT INTO reviews (author_name, rating, body, status)
           VALUES ('A. B.', 5, 'ok', 'approved')`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await c.query('ROLLBACK TO s');
      await expect(
        c.query(
          `INSERT INTO reviews (author_name, rating, body, verified)
           VALUES ('A. B.', 5, 'ok', true)`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('marque toutes les prestations, options et avis seedés comme exemples', async () => {
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM services WHERE NOT is_placeholder) AS services,
              (SELECT count(*) FROM service_options WHERE NOT is_placeholder) AS options,
              (SELECT count(*) FROM reviews WHERE NOT is_placeholder) AS reviews`,
    );
    expect(rows[0]).toEqual({ services: '0', options: '0', reviews: '0' });
  });

  it('sème les horaires 9h-18h du lundi au samedi, sans écraser une modification', async () => {
    const { rows } = await pool.query(
      `SELECT weekday, opens_at::text AS o, closes_at::text AS c FROM opening_hours ORDER BY weekday`,
    );
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ weekday: 1, o: '09:00:00', c: '18:00:00' });
    expect(rows.at(-1)?.weekday).toBe(6);
  });

  it('le seed est idempotent (deux exécutions, mêmes effectifs)', async () => {
    const { runSeeds } = await import('./seed.js');
    const count = async () =>
      (
        await pool.query(
          `SELECT (SELECT count(*) FROM services) AS s, (SELECT count(*) FROM reviews) AS r,
                  (SELECT count(*) FROM faq_items) AS f, (SELECT count(*) FROM staff) AS st`,
        )
      ).rows[0];
    const before = await count();
    await runSeeds(pool);
    expect(await count()).toEqual(before);
  });
});
