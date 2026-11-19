// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { testConfig, testPool } from '../../test-helpers.js';
import { findCatalog, findMethods } from './repo.js';

const pool = testPool();
afterAll(() => pool.end());

describe('repo services (base de test)', () => {
  it('rend les prix en euros et marque les valeurs d’exemple', async () => {
    const { services } = await findCatalog(pool);
    const creation = services.find((s) => s.slug === 'creation-locks');
    expect(creation).toMatchObject({ price: 150, priceFrom: true, isPlaceholder: true });
    expect(creation?.options[0]).toEqual({ label: 'Cheveux au-delà des épaules', price: 30 });
    expect(services.every((s) => s.isPlaceholder)).toBe(true);
  });

  it('garde « sur devis » sans prix et les méthodes dans l’ordre', async () => {
    const { services } = await findCatalog(pool);
    expect(services.find((s) => s.slug === 'depart-de-locks')).toMatchObject({
      onQuote: true,
      price: null,
    });
    expect(services.find((s) => s.slug === 'creation-locks')?.methods).toEqual([
      'comb-coils',
      'two-strand-twists',
      'braid-locks',
      'backcombing',
    ]);
  });

  it('charge les méthodes et les étapes (bloc de contenu)', async () => {
    const { methods, stages } = await findMethods(pool);
    expect(methods).toHaveLength(10);
    expect(stages[0]).toMatchObject({ name: 'Bébé locks' });
  });
});

describe('API de lecture /api/services', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  beforeAll(async () => {
    app = await buildApp({ config: testConfig(), logger: false });
  });
  afterAll(() => app.close());

  it('liste les prestations actives sans champ interne', async () => {
    const res = await app.inject({ url: '/api/services?categorie=detox' });
    const { services } = res.json();
    expect(services.map((/** @type {{ slug: string }} */ s) => s.slug)).toContain('bain-detox');
    expect(services.every((/** @type {object} */ s) => !('isPlaceholder' in s))).toBe(true);
  });

  it('renvoie 404 JSON pour un slug inconnu ou invalide', async () => {
    for (const url of ['/api/services/inconnue', '/api/services/%27%3B--']) {
      const res = await app.inject({ url });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Not Found' });
    }
  });

  it('ignore un filtre invalide ou malveillant (requêtes paramétrées)', async () => {
    const res = await app.inject({ url: '/api/services?categorie=x%27%20OR%201=1--' });
    expect(res.statusCode).toBe(200);
    expect(res.json().services.length).toBeGreaterThan(0);
  });
});
