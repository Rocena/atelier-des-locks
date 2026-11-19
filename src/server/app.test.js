// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, redactUrl } from './app.js';
import { testConfig } from './test-helpers.js';

const config = testConfig();

describe('application (mode test, sans Vite)', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  beforeAll(async () => {
    app = await buildApp({ config, logger: false });
  });
  afterAll(() => app.close());

  it('répond sur /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('/health : 503 sans détail si la base est injoignable', async () => {
    const local = await buildApp({ config, logger: false });
    // La base « tombe » après le démarrage.
    local.db.query = /** @type {any} */ (
      async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret');
      }
    );
    const res = await local.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error' });
    expect(res.body).not.toContain('secret');
    await local.close();
  });

  it('Permissions-Policy fermée', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['permissions-policy']).toContain('camera=()');
  });

  it('erreur interne : message générique, jamais le détail', async () => {
    const local = await buildApp({ config, logger: false });
    local.get('/boom', async () => {
      throw new Error('relation "clients" violates constraint secret');
    });
    const res = await local.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('clients');
    const html = await local.inject({
      method: 'GET',
      url: '/boom',
      headers: { accept: 'text/html' },
    });
    expect(html.statusCode).toBe(500);
    expect(html.body).toContain('Erreur 500');
    await local.close();
  });

  it('journaux : jetons et paramètres retirés des URL', () => {
    expect(redactUrl('/rdv/abcDEF123/annuler?x=1')).toBe('/rdv/[jeton]/annuler');
    expect(redactUrl('/avis/laisser/tok_en')).toBe('/avis/laisser/[jeton]');
    expect(redactUrl('/agenda/secret.ics')).toBe('/agenda/[jeton]');
    expect(redactUrl('/admin/galerie/1/photo?_csrf=abc')).toBe('/admin/galerie/1/photo');
    expect(redactUrl('/prestations/locks')).toBe('/prestations/locks');
  });

  it('pose une CSP stricte à nonces et les en-têtes de sécurité', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toMatch(/script-src 'self' 'nonce-[a-f0-9]+'/);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it("utilise le même nonce dans l'en-tête et dans le script inline", async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    const nonce = String(res.headers['content-security-policy']).match(/nonce-([a-f0-9]+)/)?.[1];
    expect(nonce).toBeTruthy();
    expect(res.body).toContain(`<script nonce="${nonce}">`);
  });

  it("rend l'accueil en français, sans lorem ipsum", async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<html lang="fr"');
    expect(res.body).toContain('L’art de la <em>loc</em>');
    expect(res.body.toLowerCase()).not.toContain('lorem');
  });

  it('sert le styleguide hors production, marqué noindex', async () => {
    const res = await app.inject({ method: 'GET', url: '/styleguide' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.body).toContain('Le style de <em>l’atelier</em>');
  });

  it('échappe les données injectées dans les templates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/introuvable?<script>',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('<script>alert');
    expect(res.body).toContain('Cette page s’est <em>détachée</em>');
  });

  it('répond 404 en JSON hors navigateur', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/inexistant' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not Found' });
  });
});

describe('styleguide désactivé', () => {
  it('renvoie 404 quand STYLEGUIDE_ENABLED=false', async () => {
    const app = await buildApp({
      config: testConfig({ STYLEGUIDE_ENABLED: 'false' }),
      logger: false,
    });
    const res = await app.inject({ method: 'GET', url: '/styleguide' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
