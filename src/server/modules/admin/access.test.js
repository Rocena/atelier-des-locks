// @ts-check
/**
 * Contrôle d'accès de l'administration (§13) : la preuve, route par route.
 *
 * La liste des routes n'est pas écrite à la main : elle est lue dans l'application (hook onRoute).
 * Une route ajoutée demain est donc testée sans rien faire, et une route sans rôle déclaré
 * fait échouer ce fichier.
 *   - non connecté                → 401
 *   - mot de passe sans 2FA       → 401
 *   - session expirée, compte désactivé → 401
 *   - équipe sur route propriétaire → 403
 *   - équipe / propriétaire sur leurs routes → ni 401 ni 403
 *   - écriture sans jeton CSRF     → 403
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../test-helpers.js';
import {
  TEST_NOW,
  cleanupAdminUsers,
  createTestUser,
  csrfFor,
  makeAdminApp,
  openTestSession,
} from './test-helpers.js';

const pool = testPool();
/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {Array<{ method: string, url: string, access: string, roles: readonly string[]|null }>} */
let routes = [];

const UUID = '00000000-0000-4000-8000-000000000000';

/** Remplace les paramètres d'URL par des valeurs inexistantes (aucune ne correspond à une ligne). @param {string} url */
function concrete(url) {
  const usesUuid = /\/(rdv|clientes|avis)\/:id/.test(url);
  return url
    .replace(':id', usesUuid ? UUID : '999999')
    .replace(':table', 'inconnue')
    .replace(':file', 'x');
}

const isFull = (/** @type {{ access: string }} */ r) => r.access === 'full';
const ownerOnly = (/** @type {{ roles: readonly string[]|null }} */ r) =>
  r.roles !== null && r.roles.length === 1 && r.roles[0] === 'owner';

/**
 * @param {{ method: string, url: string }} route
 * @param {Record<string, string>} headers
 * @param {Record<string, unknown>} [body]
 */
const call = (route, headers, body) =>
  app.inject({
    method: /** @type {any} */ (route.method),
    url: concrete(route.url),
    headers: { accept: 'application/json', ...headers },
    ...(route.method === 'POST' ? { payload: body ?? {} } : {}),
  });

beforeAll(async () => {
  ({ app } = await makeAdminApp(pool));
  await app.ready();
  routes = app.adminRoutes.filter((r) => r.url.startsWith('/admin'));
});
afterAll(async () => {
  await cleanupAdminUsers(pool);
  await app.close();
  await pool.end();
});

describe('inventaire des routes', () => {
  it('connaît toutes les routes de l’admin (et en trouve beaucoup)', () => {
    expect(routes.length).toBeGreaterThan(60);
    // Jeu de contrôle : quelques routes sensibles doivent figurer dans l'inventaire.
    const keys = routes.map((r) => `${r.method} ${r.url}`);
    for (const expected of [
      'GET /admin',
      'GET /admin/agenda',
      'POST /admin/agenda/rdv/:id/deplacer',
      'GET /admin/clientes/export.csv',
      'POST /admin/clientes/:id/supprimer',
      'GET /admin/journal',
      'POST /admin/reglages/horaires',
      'POST /admin/galerie/photos',
    ]) {
      expect(keys).toContain(expected);
    }
  });

  it('aucune route n’oublie de déclarer ses rôles', () => {
    const undeclared = routes.filter((r) => isFull(r) && (!r.roles || r.roles.length === 0));
    expect(undeclared.map((r) => `${r.method} ${r.url}`)).toEqual([]);
  });

  it('seules les routes de connexion sont publiques ou à mi-chemin', () => {
    const open = routes.filter((r) => !isFull(r)).map((r) => `${r.method} ${r.url}`);
    expect(open.sort()).toEqual(
      [
        'GET /admin/connexion',
        'POST /admin/connexion',
        'GET /admin/verification',
        'POST /admin/verification',
        'GET /admin/2fa',
        'POST /admin/2fa',
        'POST /admin/deconnexion',
      ].sort(),
    );
  });

  it('les routes d’écriture, d’export et de suppression RGPD sont réservées à la propriétaire', () => {
    const owner = routes.filter(ownerOnly).map((r) => `${r.method} ${r.url}`);
    for (const expected of [
      'GET /admin/clientes/export.csv',
      'GET /admin/clientes/:id/supprimer',
      'POST /admin/clientes/:id/supprimer',
      'GET /admin/prestations',
      'POST /admin/prestations/:id',
      'GET /admin/contenus',
      'GET /admin/reglages',
      'POST /admin/reglages/horaires',
      'GET /admin/journal',
      'GET /admin/notifications',
      'POST /admin/galerie/:id/supprimer',
    ]) {
      expect(owner).toContain(expected);
    }
  });
});

describe('non connecté : 401 partout', () => {
  it('chaque route protégée répond 401', async () => {
    const failures = [];
    for (const route of routes.filter((r) => r.access !== 'public')) {
      const res = await call(route, {});
      if (res.statusCode !== 401) failures.push(`${route.method} ${route.url} → ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('une navigation (HTML) reçoit aussi un 401, avec un lien vers la connexion', async () => {
    const res = await app.inject({ url: '/admin/agenda', headers: { accept: 'text/html' } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('/admin/connexion');
  });

  it('une URL inconnue sous /admin ne fuit rien sans session (401)', async () => {
    const res = await app.inject({
      url: '/admin/inexistant',
      headers: { accept: 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('un cookie inventé ou mal formé ne donne rien', async () => {
    for (const cookie of [
      'adl_admin=abc',
      `adl_admin=${'x'.repeat(43)}`,
      `adl_admin=${'a'.repeat(500)}`,
    ]) {
      const res = await app.inject({
        url: '/admin',
        headers: { cookie, accept: 'application/json' },
      });
      expect(res.statusCode).toBe(401);
    }
  });
});

describe('session à mi-chemin (mot de passe sans 2FA) : 401 sur tout le back-office', () => {
  it('refuse chaque route complète', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const { cookie } = await openTestSession(pool, user.id, { mfa: false });
    const failures = [];
    for (const route of routes.filter(isFull)) {
      const res = await call(route, { cookie });
      if (res.statusCode !== 401) failures.push(`${route.method} ${route.url} → ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('refuse un compte pas encore passé par la 2FA, même avec un cookie valide', async () => {
    const user = await createTestUser(pool, { role: 'owner', totp: false });
    const { cookie } = await openTestSession(pool, user.id, { mfa: false });
    const res = await app.inject({
      url: '/admin/agenda',
      headers: { cookie, accept: 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('sessions invalides : 401', () => {
  it('session inactive depuis plus de 30 minutes', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const { cookie } = await openTestSession(pool, user.id, {
      expiresAt: new Date(TEST_NOW.getTime() - 1000),
    });
    const res = await app.inject({
      url: '/admin',
      headers: { cookie, accept: 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('session plus vieille que 12 heures, même active', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const { cookie } = await openTestSession(pool, user.id, {
      createdAt: new Date(TEST_NOW.getTime() - 13 * 3_600_000),
      expiresAt: new Date(TEST_NOW.getTime() + 20 * 60_000),
    });
    const res = await app.inject({
      url: '/admin',
      headers: { cookie, accept: 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('compte désactivé : sa session ne sert plus', async () => {
    const user = await createTestUser(pool, { role: 'owner', active: false });
    const { cookie } = await openTestSession(pool, user.id);
    const res = await app.inject({
      url: '/admin',
      headers: { cookie, accept: 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('équipe (staff) : 403 sur tout ce qui est réservé à la propriétaire', () => {
  it('chaque route propriétaire répond 403, chaque route partagée est accessible', async () => {
    const user = await createTestUser(pool, { role: 'staff' });
    const { cookie } = await openTestSession(pool, user.id);
    const { token, cookie: withCsrf } = await csrfFor(app, cookie);
    const forbidden = [];
    const blocked = [];
    for (const route of routes.filter(isFull)) {
      const res = await call(route, { cookie: withCsrf, 'x-csrf-token': token });
      if (ownerOnly(route) && res.statusCode !== 403)
        forbidden.push(`${route.method} ${route.url} → ${res.statusCode}`);
      if (!ownerOnly(route) && [401, 403].includes(res.statusCode)) {
        blocked.push(`${route.method} ${route.url} → ${res.statusCode}`);
      }
    }
    expect(forbidden).toEqual([]);
    expect(blocked).toEqual([]);
  });

  it('une page propriétaire demandée depuis un navigateur affiche « Accès réservé »', async () => {
    const user = await createTestUser(pool, { role: 'staff' });
    const { cookie } = await openTestSession(pool, user.id);
    const res = await app.inject({
      url: '/admin/reglages',
      headers: { cookie, accept: 'text/html' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('réservée à la propriétaire');
  });

  it('ne voit ni les rubriques réservées dans le menu, ni le chiffre d’affaires', async () => {
    const user = await createTestUser(pool, { role: 'staff' });
    const { cookie } = await openTestSession(pool, user.id);
    const res = await app.inject({ url: '/admin', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('/admin/reglages');
    expect(res.body).not.toContain('/admin/journal');
    expect(res.body).not.toContain('chiffre d’affaires');
  });

  it('l’export CSV et la suppression RGPD restent fermés, même en connaissant l’adresse', async () => {
    const user = await createTestUser(pool, { role: 'staff' });
    const { cookie } = await openTestSession(pool, user.id);
    const csv = await app.inject({ url: '/admin/clientes/export.csv', headers: { cookie } });
    expect(csv.statusCode).toBe(403);
    expect(csv.body).not.toContain('Prénom');
  });
});

describe('propriétaire : accès à toutes les routes', () => {
  it('aucune route ne répond 401 ni 403', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const { cookie } = await openTestSession(pool, user.id);
    const { token, cookie: withCsrf } = await csrfFor(app, cookie);
    const blocked = [];
    for (const route of routes.filter(isFull)) {
      const res = await call(route, { cookie: withCsrf, 'x-csrf-token': token });
      if ([401, 403].includes(res.statusCode))
        blocked.push(`${route.method} ${route.url} → ${res.statusCode}`);
      // Jamais d'erreur serveur : une entrée vide ou un identifiant inconnu se traite proprement.
      expect(
        res.statusCode,
        `${route.method} ${route.url} : ${res.body.slice(0, 400)}`,
      ).toBeLessThan(500);
    }
    expect(blocked).toEqual([]);
  });
});

describe('CSRF : toute écriture sans jeton est refusée', () => {
  it('chaque route POST répond 403 sans jeton CSRF', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const { cookie } = await openTestSession(pool, user.id);
    const missing = [];
    for (const route of routes.filter((r) => isFull(r) && r.method === 'POST')) {
      const res = await call(route, { cookie });
      if (res.statusCode !== 403) missing.push(`${route.method} ${route.url} → ${res.statusCode}`);
    }
    expect(missing).toEqual([]);
  });

  it('un jeton CSRF falsifié est refusé', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const { cookie } = await openTestSession(pool, user.id);
    const { cookie: withCsrf } = await csrfFor(app, cookie);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/agenda/blocages',
      headers: { cookie: withCsrf, 'x-csrf-token': 'faux-jeton', accept: 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('en-têtes des pages privées', () => {
  it('jamais en cache, jamais indexées', async () => {
    const user = await createTestUser(pool, { role: 'owner' });
    const { cookie } = await openTestSession(pool, user.id);
    const res = await app.inject({ url: '/admin', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.body).not.toMatch(/\sstyle="/);
    const nonce = /nonce-([A-Za-z0-9+/=_-]+)/.exec(
      String(res.headers['content-security-policy']),
    )?.[1];
    expect(nonce).toBeTruthy();
  });
});
