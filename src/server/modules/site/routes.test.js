// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

const config = loadConfig({
  NODE_ENV: 'test',
  SESSION_SECRET: 'x'.repeat(48),
  PUBLIC_URL: 'https://exemple.fr',
});

/** Toutes les pages publiques de la phase 2 (§5, hors réservation fonctionnelle et pages à jeton). */
const PAGES = [
  '/',
  '/le-salon',
  '/prestations',
  '/prestations/creation-locks',
  '/prestations/depart-de-locks',
  '/methodes',
  '/galerie',
  '/tarifs',
  '/avis',
  '/reserver',
  '/conseils',
  '/conseils/laver-ses-locks',
  '/contact',
  '/faq',
  '/mentions-legales',
  '/confidentialite',
  '/cgv-politique-rdv',
];

describe('pages publiques', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  beforeAll(async () => {
    app = await buildApp({ config, logger: false });
  });
  afterAll(() => app.close());

  it.each(PAGES)(
    '%s répond 200 avec un titre, une meta description et un h1 uniques',
    async (url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatch(/<title>[^<]{10,}<\/title>/);
      expect(res.body).toMatch(/<meta name="description" content="[^"]{30,}"/);
      expect(res.body.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(res.body).toContain(`<link rel="canonical" href="https://exemple.fr${url}"`);
      expect(res.body.toLowerCase()).not.toContain('lorem');
    },
  );

  it('les titres de page sont tous différents', async () => {
    const titles = await Promise.all(
      PAGES.map(async (url) => (await app.inject({ url })).body.match(/<title>([^<]+)/)?.[1]),
    );
    expect(new Set(titles).size).toBe(PAGES.length);
  });

  it('renvoie 404 pour une prestation ou un article inconnus, ou un slug invalide', async () => {
    for (const url of ['/prestations/inconnue', '/conseils/inconnu', '/prestations/%3Cscript%3E']) {
      const res = await app.inject({ url, headers: { accept: 'text/html' } });
      expect(res.statusCode).toBe(404);
    }
  });

  it('filtre la galerie côté serveur et ignore un filtre invalide', async () => {
    const res = await app.inject({ url: '/galerie?categorie=coiffure&taille=<x>' });
    expect(res.statusCode).toBe(200);
    // Les vignettes hors filtre sont rendues masquées (le filtrage JS peut les réafficher)
    expect(res.body).toMatch(/data-category="installation"[^>]*hidden/);
    expect(res.body).not.toMatch(/data-category="coiffure"[^>]*hidden/);
  });

  it('expose un JSON-LD HairSalon sûr (aucun « < » brut dans le script)', async () => {
    const res = await app.inject({ url: '/' });
    const json = res.body.match(/<script type="application\/ld\+json"[^>]*>([^]*?)<\/script>/)?.[1];
    expect(json).toBeTruthy();
    expect(json).not.toContain('<');
    expect(JSON.parse(String(json))['@type']).toBe('HairSalon');
  });

  it('expose le fil d’Ariane sur les pages profondes', async () => {
    const res = await app.inject({ url: '/prestations/bain-detox' });
    expect(res.body).toContain('aria-label="Fil d’Ariane"');
    expect(res.body).toContain('itemtype="https://schema.org/BreadcrumbList"');
  });

  it('sert sitemap.xml avec toutes les pages et robots.txt qui l’annonce', async () => {
    const sitemap = await app.inject({ url: '/sitemap.xml' });
    expect(sitemap.headers['content-type']).toContain('application/xml');
    for (const url of PAGES) expect(sitemap.body).toContain(`<loc>https://exemple.fr${url}</loc>`);
    const robots = await app.inject({ url: '/robots.txt' });
    expect(robots.body).toContain('Sitemap: https://exemple.fr/sitemap.xml');
    expect(robots.body).toContain('Disallow: /admin');
  });

  it('compresse les réponses HTML', async () => {
    const res = await app.inject({ url: '/', headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('ne publie jamais le terme Sisterlocks sans la mention de marque', async () => {
    for (const url of ['/methodes', '/prestations/micro-locks']) {
      const { body } = await app.inject({ url });
      expect(body.match(/Sisterlocks(?!™)/g)).toBeNull();
    }
  });
});
