// @ts-check
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { testPool } from '../../test-helpers.js';
import { retentionYears, runRetention, subtract } from './service.js';

describe('durées de conservation', () => {
  it('soustrait des années et des mois', () => {
    const now = new Date('2026-11-19T10:00:00Z');
    expect(subtract(now, { years: 3 }).toISOString()).toBe('2023-11-19T10:00:00.000Z');
    expect(subtract(now, { months: 12 }).toISOString()).toBe('2025-11-19T10:00:00.000Z');
  });

  it('réglage invalide : 3 ans par défaut', () => {
    expect(retentionYears(undefined)).toBe(3);
    expect(retentionYears(0)).toBe(3);
    expect(retentionYears('abc')).toBe(3);
    expect(retentionYears(5)).toBe(5);
  });
});

describe('purge en base', () => {
  const pool = testPool();
  const email = 'retention@retention.test.invalid';
  afterAll(async () => {
    await pool.query('DELETE FROM clients WHERE email = $1', [email]);
    await pool.end();
  });

  it('anonymise une cliente sans activité depuis plus de 3 ans, pas une récente', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'retention-'));
    const old = await pool.query(
      `INSERT INTO clients (first_name, last_name, email, phone, created_at)
       VALUES ('Ancienne', 'Cliente', $1, '0600000000', now() - interval '4 years') RETURNING id`,
      [email],
    );
    const recent = await pool.query(
      `INSERT INTO clients (first_name, last_name, email) VALUES ('Récente', 'Cliente', $1)
       RETURNING id`,
      ['recente@retention.test.invalid'],
    );
    try {
      const result = await runRetention(pool, { uploadDir: dir });
      expect(result.anonymized).toBeGreaterThanOrEqual(1);
      const { rows } = await pool.query(
        'SELECT id, anonymized_at, phone FROM clients WHERE id = ANY($1)',
        [[old.rows[0].id, recent.rows[0].id]],
      );
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[old.rows[0].id].anonymized_at).not.toBeNull();
      expect(byId[old.rows[0].id].phone).toBeNull();
      expect(byId[recent.rows[0].id].anonymized_at).toBeNull();
    } finally {
      await pool.query('DELETE FROM clients WHERE email = $1', ['recente@retention.test.invalid']);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
