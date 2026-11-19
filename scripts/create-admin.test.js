// @ts-check
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupAdminUsers, ADMIN_EMAIL_DOMAIN } from '../src/server/modules/admin/test-helpers.js';
import { testPool } from '../src/server/test-helpers.js';
import { findUserByEmail } from '../src/server/modules/auth/repo.js';
import { verifyPassword } from '../src/server/modules/auth/password.js';
import { parseArgs, run } from './create-admin.js';

const pool = testPool();
afterAll(async () => {
  await cleanupAdminUsers(pool);
  await pool.end();
});

/** @param {string[]} answers */
const prompter = (answers) => {
  const queue = [...answers];
  return async () => queue.shift() ?? '';
};

describe('create-admin : arguments', () => {
  it('propriétaire par défaut, équipe sur demande, erreurs claires', () => {
    expect(parseArgs([])).toEqual({ role: 'owner', help: false });
    expect(parseArgs(['--role', 'staff'])).toEqual({ role: 'staff', help: false });
    expect(parseArgs(['--role', 'admin']).error).toMatch(/owner/);
    expect(parseArgs(['--password', 'x']).error).toMatch(/inconnue/);
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

describe('create-admin : création du compte', () => {
  it('crée le premier compte propriétaire, mot de passe haché en argon2id, 2FA à configurer', async () => {
    const email = `Premiere${ADMIN_EMAIL_DOMAIN}`;
    const outcome = await run(
      { role: 'owner' },
      {
        db: pool,
        log: () => {},
        prompt: prompter([
          email,
          'Awa',
          'un mot de passe solide 2026',
          'un mot de passe solide 2026',
        ]),
      },
    );
    expect(outcome.ok).toBe(true);
    const user = await findUserByEmail(pool, email);
    expect(user?.role).toBe('owner');
    expect(user?.totpConfirmedAt).toBeNull();
    expect(user?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(
      await verifyPassword(
        /** @type {string} */ (user?.passwordHash),
        'un mot de passe solide 2026',
      ),
    ).toBe(true);
    expect(outcome.message).not.toContain('un mot de passe solide');
  });

  it('crée un compte équipe', async () => {
    const email = `equipe${ADMIN_EMAIL_DOMAIN}`;
    const outcome = await run(
      { role: 'staff' },
      {
        db: pool,
        log: () => {},
        prompt: prompter([
          email,
          'Fanta',
          'un autre mot de passe solide',
          'un autre mot de passe solide',
        ]),
      },
    );
    expect(outcome.ok).toBe(true);
    expect((await findUserByEmail(pool, email))?.role).toBe('staff');
  });

  it('refuse : mots de passe différents, trop court, adresse invalide, compte existant', async () => {
    const email = `refus${ADMIN_EMAIL_DOMAIN}`;
    const base = { db: pool, log: () => {} };
    expect(
      (
        await run(
          { role: 'owner' },
          {
            ...base,
            prompt: prompter([email, 'A', 'un mot de passe solide', 'autre chose du tout']),
          },
        )
      ).message,
    ).toMatch(/pas identiques/);
    expect(
      (await run({ role: 'owner' }, { ...base, prompt: prompter([email, 'A', 'court', 'court']) }))
        .message,
    ).toMatch(/12 caractères/);
    expect(
      (
        await run(
          { role: 'owner' },
          {
            ...base,
            prompt: prompter([
              'pas-une-adresse',
              'A',
              'un mot de passe solide',
              'un mot de passe solide',
            ]),
          },
        )
      ).message,
    ).toMatch(/invalide/);
    expect(await findUserByEmail(pool, email)).toBeNull();
    const ok = {
      prompt: prompter([email, 'A', 'un mot de passe solide', 'un mot de passe solide']),
    };
    expect((await run({ role: 'owner' }, { ...base, ...ok })).ok).toBe(true);
    const twice = await run(
      { role: 'owner' },
      {
        ...base,
        prompt: prompter([email, 'A', 'un mot de passe solide', 'un mot de passe solide']),
      },
    );
    expect(twice.ok).toBe(false);
    expect(twice.message).toMatch(/existe déjà/);
  });
});
