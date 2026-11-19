// @ts-check
import { describe, expect, it } from 'vitest';
import { filterGallery, galleryFacets } from './service.js';
import { galleryQuery } from './schemas.js';

/** @type {import('./repo.js').GalleryItem[]} */
const items = [
  {
    id: 'a',
    title: 'A',
    category: 'installation',
    method: 'comb-coils',
    size: 'moyennes',
    ratio: 'portrait',
    featured: true,
  },
  {
    id: 'b',
    title: 'B',
    category: 'coiffure',
    method: null,
    size: 'fines',
    ratio: 'square',
    featured: false,
  },
  {
    id: 'c',
    title: 'C',
    category: 'installation',
    method: 'crochet',
    size: 'fines',
    ratio: 'landscape',
    featured: false,
  },
];

describe('galerie', () => {
  it('combine les filtres', () => {
    expect(filterGallery(items, {}).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    const filtered = filterGallery(items, { categorie: 'installation', taille: 'fines' });
    expect(filtered.map((i) => i.id)).toEqual(['c']);
  });

  it('ne propose que les filtres présents dans la galerie', () => {
    const facets = galleryFacets(
      items,
      [
        { slug: 'installation', name: 'Installation' },
        { slug: 'detox', name: 'Détox' },
      ],
      [
        { slug: 'crochet', name: 'Crochet' },
        { slug: 'palm-rolling', name: 'Palm rolling' },
      ],
      [
        { slug: 'fines', label: 'Fines' },
        { slug: 'epaisses', label: 'Épaisses' },
      ],
    );
    expect(facets.categories.map((c) => c.value)).toEqual(['installation']);
    expect(facets.methods.map((m) => m.value)).toEqual(['crochet']);
    expect(facets.sizes.map((s) => s.value)).toEqual(['fines']);
  });

  it('ignore un filtre invalide au lieu de planter', () => {
    expect(galleryQuery.parse({ categorie: '<script>', taille: 'fines' })).toEqual({
      categorie: undefined,
      methode: undefined,
      taille: 'fines',
    });
  });
});
