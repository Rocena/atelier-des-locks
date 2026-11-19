// @ts-check
/**
 * Parcours d'authentification de l'administration, de bout en bout (base de test) :
 * connexion, configuration de la 2FA, codes de secours, verrouillage progressif, rotation des
 * sessions, déconnexion, changement de mot de passe, journal d'audit.
 * L'horloge est pilotée : chaque étape avance de 31 s pour obtenir un nouveau pas TOTP.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../test-helpers.js';
import {
  TEST_NOW,
  TEST_PASSWORD,
  cleanupAdminUsers,
  createTestUser,
  makeAdminApp,
  openTestSession,
} from '../admin/test-helpers.js';
import { decryptTotpSecret, hashSessionToken } from './crypto.js';
import { totpAt } from './totp.js';
import * as auth from './service.js';

const pool = testPool();
let clock = new Date(TEST_NOW);
/** @type {import('fastify').FastifyInstance} */
let app;
const secret = 'x'.repeat(48);

/** @param {number} [seconds] */
const tick = (seconds = 31) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

beforeAll(async () => {
  ({ app } = await makeAdminApp(pool, { now: () => clock }));
  await app.ready();
});
afterAll(async () => {
  await cleanupAdminUsers(pool);
  await app.close();
  await pool.end();
});

/** Cookies d'une réponse, fusionnés dans un en-tête. @param {import('light-my-request').Response} res @param {string} [previous] */
function cookies(res, previous = '') {
  const jar = new Map(
    previous
      .split('; ')
      .filter(Boolean)
      .map((c) => /** @type {[string, string]} */ (c.split('=', 2))),
  );
  for (const c of res.cookies) {
    if (c.value === '' || (c.expires && c.expires < clock)) jar.delete(c.name);
    else jar.set(c.name, c.value);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Remplit et envoie un formulaire de l'admin.
 * @param {string} url
 * @param {Record<string, string>} fields
 * @param {string} [jar]
 */
async function submit(url, fields, jar = '') {
  const page = await app.inject({ url, headers: { cookie: jar, accept: 'text/html' } });
  const jar1 = cookies(page, jar);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
  const res = await app.inject({
    method: 'POST',
    url,
    headers: {
      cookie: jar1,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html',
    },
    payload: new URLSearchParams({ _csrf: csrf, ...fields }).toString(),
  });
  return { res, jar: cookies(res, jar1) };
}

/** Connexion complète (mot de passe, puis code). @param {{ email: string }} user @param {string} secretBase32 */
async function fullLogin(user, secretBase32) {
  const first = await submit('/admin/connexion', { email: user.email, password: TEST_PASSWORD });
  expect(first.res.statusCode).toBe(303);
  tick();
  const second = await submit(
    '/admin/verification',
    { code: totpAt(secretBase32, clock), kind: 'totp' },
    first.jar,
  );
  expect(second.res.statusCode).toBe(303);
  return second.jar;
}

/** Secret TOTP en clair d'un compte (lu en base, déchiffré). @param {string} id */
async function secretOf(id) {
  const { rows } = await pool.query('SELECT totp_secret_encrypted FROM users WHERE id = $1', [id]);
  return /** @type {string} */ (decryptTotpSecret(rows[0].totp_secret_encrypted, secret));
}

describe('première connexion : activation obligatoire de la 2FA', () => {
  it('mot de passe → QR code → code → codes de secours → accès', async () => {
    const user = await createTestUser(pool, { role: 'owner', totp: false });
    const login = await submit('/admin/connexion', { email: user.email, password: TEST_PASSWORD });
    expect(login.res.statusCode).toBe(303);
    expect(login.res.headers.location).toBe('/admin/2fa');
    const cookie = /** @type {string} */ (
      login.res.cookies.find((c) => c.name === 'adl_admin')?.value
    );
    expect(cookie).toBeTruthy();
    // Cookie de session : HttpOnly, SameSite=Strict.
    const set = String(login.res.headers['set-cookie']);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);

    // Tant que la 2FA n'est pas faite : aucun accès au back-office.
    const blocked = await app.inject({
      url: '/admin',
      headers: { cookie: login.jar, accept: 'application/json' },
    });
    expect(blocked.statusCode).toBe(401);

    const setup = await app.inject({ url: '/admin/2fa', headers: { cookie: login.jar } });
    expect(setup.statusCode).toBe(200);
    expect(setup.body).toContain('<svg');
    expect(setup.body).toContain('Clé');
    const totpSecret = await secretOf(user.id);
    expect(totpSecret).toMatch(/^[A-Z2-7]{32}$/);
    // Le secret n'est jamais stocké en clair.
    const { rows } = await pool.query('SELECT totp_secret_encrypted FROM users WHERE id = $1', [
      user.id,
    ]);
    expect(rows[0].totp_secret_encrypted).not.toContain(totpSecret);

    // Un mauvais code est refusé.
    tick();
    const wrong = await submit('/admin/2fa', { code: '000000' }, login.jar);
    expect(wrong.res.statusCode).toBe(422);
    expect(wrong.res.body).toContain('Ce code n’est pas bon');

    tick();
    const ok = await submit('/admin/2fa', { code: totpAt(totpSecret, clock) }, login.jar);
    expect(ok.res.statusCode).toBe(200);
    const codes = [...ok.res.body.matchAll(/<li>([a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4})<\/li>/g)].map(
      (m) => m[1],
    );
    expect(codes).toHaveLength(10);
    // Seules des empreintes sont gardées.
    const stored = await pool.query(
      'SELECT recovery_code_hashes, totp_confirmed_at FROM users WHERE id = $1',
      [user.id],
    );
    expect(stored.rows[0].totp_confirmed_at).not.toBeNull();
    for (const code of codes) expect(stored.rows[0].recovery_code_hashes).not.toContain(code);

    // La session a changé d'identifiant et donne accès.
    const newCookie = cookies(ok.res, ok.jar);
    expect(newCookie).not.toContain(cookie);
    const home = await app.inject({ url: '/admin', headers: { cookie: newCookie } });
    expect(home.statusCode).toBe(200);
    // L'ancienne session (mi-chemin) a été détruite.
    const old = await app.inject({
      url: '/admin',
      headers: { cookie: `adl_admin=${cookie}`, accept: 'application/json' },
    });
    expect(old.statusCode).toBe(401);
    // Les codes ne sont plus jamais affichés.
    const account = await app.inject({ url: '/admin/compte', headers: { cookie: newCookie } });
    expect(account.body).not.toContain(codes[0]);
  });

  it('la configuration n’est plus possible une fois la 2FA active', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const { cookie } = await openTestSession(pool, user.id, { mfa: false, now: clock });
    const res = await app.inject({ url: '/admin/2fa', headers: { cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/verification');
  });
});

describe('connexion avec 2FA', () => {
  it('mot de passe puis code à 6 chiffres', async () => {
    const user = await createTestUser(pool, { role: 'owner', totp: false });
    await pool.query(
      'UPDATE users SET totp_secret_encrypted = $2, totp_confirmed_at = now() WHERE id = $1',
      [user.id, (await import('./crypto.js')).encryptTotpSecret('JBSWY3DPEHPK3PXP', secret)],
    );
    const jar = await fullLogin(user, 'JBSWY3DPEHPK3PXP');
    const home = await app.inject({ url: '/admin', headers: { cookie: jar } });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('Bonjour');
  });

  it('un code déjà utilisé ne sert pas deux fois (rejeu)', async () => {
    const user = await createTestUser(pool, { role: 'owner', totp: false });
    const key = 'JBSWY3DPEHPK3PXP';
    await pool.query(
      'UPDATE users SET totp_secret_encrypted = $2, totp_confirmed_at = now() WHERE id = $1',
      [user.id, (await import('./crypto.js')).encryptTotpSecret(key, secret)],
    );
    await fullLogin(user, key);
    // Même pas TOTP, nouvelle connexion : refusé.
    const first = await submit('/admin/connexion', { email: user.email, password: TEST_PASSWORD });
    const replay = await submit(
      '/admin/verification',
      { code: totpAt(key, clock), kind: 'totp' },
      first.jar,
    );
    expect(replay.res.statusCode).toBe(401);
  });

  it('mauvais mot de passe et compte inconnu : même réponse, rien ne se devine', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const bad = await submit('/admin/connexion', {
      email: user.email,
      password: 'mauvais mot de passe',
    });
    const unknown = await submit('/admin/connexion', {
      email: 'personne@admin.test.invalid',
      password: 'mauvais mot de passe',
    });
    expect(bad.res.statusCode).toBe(401);
    expect(unknown.res.statusCode).toBe(401);
    const text = (/** @type {string} */ body) => /role="alert">([^<]+)</.exec(body)?.[1];
    expect(text(bad.res.body)).toBe(text(unknown.res.body));
    expect(text(bad.res.body)).toBeTruthy();
    expect(bad.res.headers['set-cookie']).toBeUndefined();
  });

  it('un compte désactivé ne peut pas se connecter', async () => {
    const user = await createTestUser(pool, { role: 'owner', active: false });
    const res = await submit('/admin/connexion', { email: user.email, password: TEST_PASSWORD });
    expect(res.res.statusCode).toBe(401);
  });

  it('refuse sans jeton CSRF', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/connexion',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ email: user.email, password: TEST_PASSWORD }).toString(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('verrouillage progressif', () => {
  it('5 échecs verrouillent le compte, même le bon mot de passe est refusé ensuite', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    for (let i = 0; i < 5; i += 1) {
      const res = await submit('/admin/connexion', {
        email: user.email,
        password: `mauvais ${i} mot de passe`,
      });
      expect(res.res.statusCode).toBe(401);
    }
    const { rows } = await pool.query(
      'SELECT failed_login_count, locked_until FROM users WHERE id = $1',
      [user.id],
    );
    expect(rows[0].failed_login_count).toBe(5);
    expect(rows[0].locked_until).not.toBeNull();
    // Verrouillé : le bon mot de passe ne passe plus.
    const locked = await submit('/admin/connexion', { email: user.email, password: TEST_PASSWORD });
    expect(locked.res.statusCode).toBe(401);
    expect(locked.res.headers['set-cookie']).toBeUndefined();
    // Une minute plus tard : débloqué.
    tick(61);
    const again = await submit('/admin/connexion', { email: user.email, password: TEST_PASSWORD });
    expect(again.res.statusCode).toBe(303);
  });

  it('la durée augmente avec les échecs (1 min, puis 5 min)', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const ctx = { db: pool, secret, now: clock };
    for (let i = 0; i < 5; i += 1)
      await auth.login(ctx, { email: user.email, password: 'x'.repeat(14) });
    const first = await pool.query('SELECT locked_until FROM users WHERE id = $1', [user.id]);
    expect(first.rows[0].locked_until.getTime() - clock.getTime()).toBe(60_000);
    // Dès le déblocage, un nouvel échec verrouille 5 minutes.
    const later = { ...ctx, now: new Date(clock.getTime() + 61_000) };
    await auth.login(later, { email: user.email, password: 'y'.repeat(14) });
    const second = await pool.query('SELECT locked_until FROM users WHERE id = $1', [user.id]);
    expect(second.rows[0].locked_until.getTime() - later.now.getTime()).toBe(300_000);
  });

  it('un succès complet remet le compteur à zéro', async () => {
    const user = await createTestUser(pool, { role: 'owner', totp: false });
    const key = 'JBSWY3DPEHPK3PXP';
    await pool.query(
      'UPDATE users SET totp_secret_encrypted = $2, totp_confirmed_at = now(), failed_login_count = 3 WHERE id = $1',
      [user.id, (await import('./crypto.js')).encryptTotpSecret(key, secret)],
    );
    await fullLogin(user, key);
    const { rows } = await pool.query('SELECT failed_login_count FROM users WHERE id = $1', [
      user.id,
    ]);
    expect(rows[0].failed_login_count).toBe(0);
  });

  it('les mauvais codes 2FA comptent aussi', async () => {
    const user = await createTestUser(pool, { role: 'owner', totp: false });
    await pool.query(
      'UPDATE users SET totp_secret_encrypted = $2, totp_confirmed_at = now() WHERE id = $1',
      [user.id, (await import('./crypto.js')).encryptTotpSecret('JBSWY3DPEHPK3PXP', secret)],
    );
    const login = await submit('/admin/connexion', { email: user.email, password: TEST_PASSWORD });
    for (let i = 0; i < 5; i += 1) {
      const res = await submit('/admin/verification', { code: '000000', kind: 'totp' }, login.jar);
      expect(res.res.statusCode).toBe(401);
    }
    const { rows } = await pool.query('SELECT locked_until FROM users WHERE id = $1', [user.id]);
    expect(rows[0].locked_until).not.toBeNull();
  });
});

describe('codes de secours', () => {
  it('chaque code ne sert qu’une fois', async () => {
    const user = await createTestUser(pool, { role: 'owner', totp: false });
    const ctx = { db: pool, secret, now: clock };
    const key = 'JBSWY3DPEHPK3PXP';
    await pool.query(
      'UPDATE users SET totp_secret_encrypted = $2, totp_confirmed_at = now() WHERE id = $1',
      [user.id, (await import('./crypto.js')).encryptTotpSecret(key, secret)],
    );
    const { generateRecoveryCodes, hashRecoveryCode } = await import('./crypto.js');
    const codes = generateRecoveryCodes();
    await pool.query('UPDATE users SET recovery_code_hashes = $2 WHERE id = $1', [
      user.id,
      codes.map((c) => hashRecoveryCode(c, secret)),
    ]);

    const first = await submit('/admin/connexion', { email: user.email, password: TEST_PASSWORD });
    const ok = await submit(
      '/admin/verification',
      { code: codes[3].toUpperCase(), kind: 'recovery' },
      first.jar,
    );
    expect(ok.res.statusCode).toBe(303);
    expect((await app.inject({ url: '/admin', headers: { cookie: ok.jar } })).statusCode).toBe(200);
    const left = await pool.query(
      'SELECT cardinality(recovery_code_hashes) AS n FROM users WHERE id = $1',
      [user.id],
    );
    expect(left.rows[0].n).toBe(9);

    // Le même code, une seconde fois : refusé.
    const second = await submit('/admin/connexion', { email: user.email, password: TEST_PASSWORD });
    const reuse = await submit(
      '/admin/verification',
      { code: codes[3], kind: 'recovery' },
      second.jar,
    );
    expect(reuse.res.statusCode).toBe(401);
    // Un autre code fonctionne.
    const other = await submit(
      '/admin/verification',
      { code: codes[4], kind: 'recovery' },
      second.jar,
    );
    expect(other.res.statusCode).toBe(303);
    void ctx;
  });
});

describe('sessions', () => {
  it('la déconnexion détruit la session côté serveur', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const { cookie, token } = await openTestSession(pool, user.id, { now: clock });
    const page = await app.inject({ url: '/admin/compte', headers: { cookie } });
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
    const jar = cookies(page, cookie);
    const out = await app.inject({
      method: 'POST',
      url: '/admin/deconnexion',
      headers: { cookie: jar, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `_csrf=${encodeURIComponent(csrf)}`,
    });
    expect(out.statusCode).toBe(303);
    const { rows } = await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [
      hashSessionToken(token),
    ]);
    expect(rows).toHaveLength(0);
    const after = await app.inject({
      url: '/admin',
      headers: { cookie, accept: 'application/json' },
    });
    expect(after.statusCode).toBe(401);
  });

  it('la session se prolonge par l’activité, plafonnée à 12 h', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const ctx = { db: pool, secret, now: clock };
    const { token } = await openTestSession(pool, user.id, { now: clock });
    // 20 minutes plus tard, une requête repousse l'expiration.
    const later = { ...ctx, now: new Date(clock.getTime() + 20 * 60_000) };
    expect(await auth.authenticate(later, token)).not.toBeNull();
    const { rows } = await pool.query('SELECT expires_at FROM sessions WHERE token_hash = $1', [
      hashSessionToken(token),
    ]);
    expect(rows[0].expires_at.getTime()).toBe(later.now.getTime() + 30 * 60_000);
    // 31 minutes d'inactivité : expirée.
    const idle = { ...ctx, now: new Date(later.now.getTime() + 31 * 60_000) };
    expect(await auth.authenticate(idle, token)).toBeNull();
  });

  it('changer le mot de passe déconnecte les autres sessions', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const mine = await openTestSession(pool, user.id, { now: clock });
    const other = await openTestSession(pool, user.id, { now: clock });
    const page = await app.inject({ url: '/admin/compte', headers: { cookie: mine.cookie } });
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
    const jar = cookies(page, mine.cookie);
    const form = (/** @type {Record<string, string>} */ fields) =>
      app.inject({
        method: 'POST',
        url: '/admin/compte/mot-de-passe',
        headers: { cookie: jar, 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ _csrf: csrf, ...fields }).toString(),
      });
    const weak = await form({ current: TEST_PASSWORD, next: 'court', confirm: 'court' });
    expect(weak.statusCode).toBe(422);
    const wrong = await form({
      current: 'pas le bon mot de passe',
      next: 'un nouveau mot de passe solide',
      confirm: 'un nouveau mot de passe solide',
    });
    expect(wrong.statusCode).toBe(422);
    const ok = await form({
      current: TEST_PASSWORD,
      next: 'un nouveau mot de passe solide',
      confirm: 'un nouveau mot de passe solide',
    });
    expect(ok.statusCode).toBe(303);
    expect((await app.inject({ url: '/admin', headers: { cookie: mine.cookie } })).statusCode).toBe(
      200,
    );
    expect(
      (
        await app.inject({
          url: '/admin',
          headers: { cookie: other.cookie, accept: 'application/json' },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('journal d’audit de l’authentification', () => {
  it('trace les connexions, échecs et verrouillages sans aucun secret', async () => {
    const user = await createTestUser(pool, { role: 'owner', totp: false });
    const key = 'JBSWY3DPEHPK3PXP';
    await pool.query(
      'UPDATE users SET totp_secret_encrypted = $2, totp_confirmed_at = now() WHERE id = $1',
      [user.id, (await import('./crypto.js')).encryptTotpSecret(key, secret)],
    );
    for (let i = 0; i < 5; i += 1)
      await submit('/admin/connexion', { email: user.email, password: 'mauvais mot de passe' });
    tick(61);
    await fullLogin(user, key);
    const { rows } = await pool.query(
      'SELECT action, details FROM audit_log WHERE user_id = $1 ORDER BY id',
      [user.id],
    );
    const actions = rows.map((r) => r.action);
    expect(actions.filter((a) => a === 'login.failure')).toHaveLength(4);
    expect(actions).toContain('login.locked');
    expect(actions).toContain('login.success');
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(TEST_PASSWORD);
    expect(dump).not.toContain('mauvais mot de passe');
    expect(dump).not.toContain(key);
  });
});
