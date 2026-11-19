// @ts-check
import { describe, expect, it } from 'vitest';
import { featuredReviews, summarizeReviews } from './service.js';

/** @param {Partial<import('./repo.js').Review>} r */
const review = (r) => ({
  id: 'x',
  author: 'A. B.',
  rating: 5,
  date: '2026-01-01',
  service: 'bain-detox',
  featured: false,
  verified: true,
  text: '…',
  ...r,
});

describe('avis', () => {
  it('calcule la moyenne et la répartition', () => {
    const summary = summarizeReviews([review({ rating: 5 }), review({ rating: 4 })]);
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(4.5);
    expect(summary.distribution[0]).toEqual({ stars: 5, count: 1, share: 0.5 });
    expect(summary.distribution[4]).toEqual({ stars: 1, count: 0, share: 0 });
  });

  it('ne divise pas par zéro sans avis', () => {
    expect(summarizeReviews([]).average).toBe(0);
  });

  it('met en avant les avis choisis, du plus récent au plus ancien', () => {
    const list = featuredReviews([
      review({ id: 'a', featured: true, date: '2026-01-01' }),
      review({ id: 'b', featured: false, date: '2026-03-01' }),
      review({ id: 'c', featured: true, date: '2026-02-01' }),
    ]);
    expect(list.map((r) => r.id)).toEqual(['c', 'a']);
  });
});
