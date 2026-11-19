// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { testConfig, testPool } from '../../test-helpers.js';
import { findContentBlock, findFaq, findPublishedArticles, findSettings } from './repo.js';
import { findGallery } from '../gallery/repo.js';
import { findPublishedReviews } from '../reviews/repo.js';

const pool = testPool();
afterAll(() => pool.end());

/**
 * Exécute `fn` dans une transaction annulée ensuite.
 * @param {(c: import('pg').PoolClient) => Promise<void>} fn
 */
async function rolledBack(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('repos content, gallery et reviews (base de test)', () => {
  it('lit les articles publiés avec leur thème', async () => {
    const articles = await findPublishedArticles(pool);
    expect(articles).toHaveLength(3);
    expect(articles.map((a) => a.topic).sort()).toEqual(['Débuter', 'Entretien', 'Méthodes']);
    expect(articles[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('masque les brouillons', async () => {
    await rolledBack(async (c) => {
      await c.query(
        `INSERT INTO articles (slug, title, plain_title, excerpt, reading_minutes)
         VALUES ('brouillon', 'B', 'B', 'x', 1)`,
      );
      const slugs = (await findPublishedArticles(c)).map((a) => a.slug);
      expect(slugs).not.toContain('brouillon');
    });
  });

  it('lit réglages, FAQ et blocs de contenu', async () => {
    expect((await findSettings(pool)).announcement.id).toBe('ouverture-2026');
    const faq = await findFaq(pool);
    expect(faq.length).toBeGreaterThan(0);
    expect(faq[0].items[0]).toHaveProperty('q');
    expect(await findContentBlock(pool, 'inexistant')).toBeNull();
  });

  it('lit la galerie avec ses tailles', async () => {
    const { items, sizes } = await findGallery(pool);
    expect(items).toHaveLength(14);
    expect(sizes.map((s) => s.slug)).toEqual(['micro', 'fines', 'moyennes', 'epaisses']);
    expect(items[0]).toMatchObject({ id: 'g01', size: 'moyennes', ratio: 'portrait' });
  });

  it('ne renvoie que les avis approuvés avec consentement', async () => {
    await rolledBack(async (c) => {
      await c.query(
        `INSERT INTO reviews (author_name, rating, body, status)
         VALUES ('En attente', 5, 'x', 'pending')`,
      );
      const reviews = await findPublishedReviews(c);
      expect(reviews).toHaveLength(8);
      expect(reviews.some((r) => r.author === 'En attente')).toBe(false);
    });
  });
});

describe('API de lecture', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  beforeAll(async () => {
    app = await buildApp({ config: testConfig(), logger: false });
  });
  afterAll(() => app.close());

  it('GET /api/gallery filtre par catégorie', async () => {
    const { items } = (await app.inject({ url: '/api/gallery?categorie=coiffure' })).json();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((/** @type {{ category: string }} */ i) => i.category === 'coiffure')).toBe(
      true,
    );
  });

  it('GET /api/reviews renvoie la note moyenne', async () => {
    const body = (await app.inject({ url: '/api/reviews' })).json();
    expect(body.reviews).toHaveLength(8);
    expect(body.summary.count).toBe(8);
  });

  it('GET /api/content/:key renvoie le bloc, 404 sinon, clé invalide refusée', async () => {
    const ok = (await app.inject({ url: '/api/content/methods.stages' })).json();
    expect(ok.block.key).toBe('methods.stages');
    expect((await app.inject({ url: '/api/content/nope' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/content/A%27B' })).statusCode).toBe(404);
  });
});
