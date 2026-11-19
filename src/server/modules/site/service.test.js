// @ts-check
import { describe, expect, it } from 'vitest';
import { faqJsonLd, hairSalonJsonLd, sitemapXml } from './service.js';

const site = {
  name: 'L’Atelier des Locks',
  phone: '',
  instagram: '',
  address: { street: '', postalCode: '31000', city: 'Toulouse' },
  openingHours: [{ days: [2, 3], opens: '09:30', closes: '19:00' }],
};

describe('site', () => {
  it('produit un JSON-LD HairSalon sans champ vide', () => {
    const data = hairSalonJsonLd(site, 'https://exemple.fr', { average: 4.875, count: 8 });
    expect(data['@type']).toBe('HairSalon');
    expect(data.telephone).toBeUndefined();
    expect(data.aggregateRating).toMatchObject({ ratingValue: 4.9, reviewCount: 8 });
    expect(data.openingHoursSpecification).toEqual([
      expect.objectContaining({ dayOfWeek: ['Tuesday', 'Wednesday'], opens: '09:30' }),
    ]);
  });

  it('omet la note sans avis', () => {
    expect(hairSalonJsonLd(site, 'https://x.fr', { average: 0, count: 0 }).aggregateRating).toBe(
      undefined,
    );
  });

  it('liste chaque question de la FAQ', () => {
    const data = faqJsonLd([{ items: [{ q: 'Q1', a: 'R1' }] }, { items: [{ q: 'Q2', a: 'R2' }] }]);
    expect(data.mainEntity).toHaveLength(2);
  });

  it('génère un sitemap échappé', () => {
    const xml = sitemapXml('https://x.fr', ['/', '/a&b']);
    expect(xml).toContain('<loc>https://x.fr/</loc>');
    expect(xml).toContain('/a&amp;b');
  });
});
