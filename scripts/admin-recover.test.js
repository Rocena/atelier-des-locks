// @ts-check
import { afterAll, describe, expect, it } from 'vitest';
import {
  cleanupAdminUsers,
  createTestUser,
  openTestSession,
} from '../src/server/modules/admin/test-helpers.js';
import { testPool } from '../src/server/test-helpers.js';
import { findUserByEmail } from '../src/server/modules/auth/repo.js';
import { parseArgs, run } from './admin-recover.js';

const pool = testPool();
afterAll(async () => {
  await cleanupAdminUsers(pool);
  await pool.end();
});

describe('admin-recover : arguments', () => {
  it('exige un e-mail et une action, refuse les deux actions ensemble', () => {
    expect(parseArgs(['--email', 'A@B.fr', '--unlock'])).toEqual({
      email: 'a@b.fr',
      action: 'unlock',
      help: false,
    });
    expect(parseArgs(['--email', 'a@b.fr']).error).toMatch(/--unlock/);
    expect(parseArgs(['--unlock']).error).toMatch(/--email/);
    expect(parseArgs(['--email', 'a@b.fr', '--unlock', '--reset-2fa']).error).toMatch(
      /pas les deux/,
    );
    expect(parseArgs(['--mot-de-passe', 'x']).error).toMatch(/inconnue/);
  });
});

describe('admin-recover : dépannage', () => {
  it('--unlock lève le verrouillage sans toucher à la 2FA ni au mot de passe', async () => {
    const user = await createTestUser(pool);
    await pool.query(
      `UPDATE users SET failed_login_count = 7, locked_until = now() + interval '1 hour' WHERE id = $1`,
      [user.id],
    );
    const before = await findUserByEmail(pool, user.email);
    const out = await run({ email: user.email, action: 'unlock' }, { db: pool });
    expect(out.ok).toBe(true);
    const after = await findUserByEmail(pool, user.email);
    expect(after?.failedLoginCount).toBe(0);
    expect(after?.lockedUntil).toBeNull();
    expect(after?.totpConfirmedAt).not.toBeNull();
    expect(after?.passwordHash).toBe(before?.passwordHash);
  });

  it('--reset-2fa efface la 2FA, les codes de secours et ferme les sessions', async () => {
    const user = await createTestUser(pool);
    await pool.query(`UPDATE users SET recovery_code_hashes = ARRAY['a','b'] WHERE id = $1`, [
      user.id,
    ]);
    await openTestSession(pool, user.id);
    const out = await run({ email: user.email, action: 'reset-2fa' }, { db: pool });
    expect(out.ok).toBe(true);
    const after = await findUserByEmail(pool, user.email);
    expect(after?.totpConfirmedAt).toBeNull();
    expect(after?.totpSecretEncrypted).toBeNull();
    expect(after?.recoveryCodesLeft).toBe(0);
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM sessions WHERE user_id = $1',
      [user.id],
    );
    expect(rows[0].n).toBe(0);
    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'auth.reset_2fa_cli' AND entity_id = $1`,
      [user.id],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('compte inconnu : message clair, rien n’est écrit', async () => {
    const out = await run({ email: 'personne@admin.test.invalid', action: 'unlock' }, { db: pool });
    expect(out).toEqual({ ok: false, message: 'Aucun compte pour personne@admin.test.invalid.' });
  });
});
