// @ts-check
/**
 * Filtres de la galerie (fonctions pures). Ils fonctionnent sans JavaScript via les paramètres
 * d'URL ; le script de la page filtre ensuite sans recharger.
 * @typedef {import('./repo.js').GalleryItem} GalleryItem
 * @typedef {{ categorie?: string, methode?: string, taille?: string }} GalleryFilters
 */

/**
 * @param {GalleryItem[]} items
 * @param {GalleryFilters} filters
 */
export function filterGallery(items, filters) {
  return items.filter(
    (item) =>
      (!filters.categorie || item.category === filters.categorie) &&
      (!filters.methode || item.method === filters.methode) &&
      (!filters.taille || item.size === filters.taille),
  );
}

/**
 * Options de filtre réellement présentes dans la galerie (jamais de filtre qui ne donne rien).
 * @param {GalleryItem[]} items
 * @param {{ slug: string, name: string }[]} categories
 * @param {{ slug: string, name: string }[]} methods
 * @param {{ slug: string, label: string }[]} sizes
 */
export function galleryFacets(items, categories, methods, sizes) {
  const cats = new Set(items.map((i) => i.category));
  const meths = new Set(items.map((i) => i.method).filter(Boolean));
  const sz = new Set(items.map((i) => i.size));
  return {
    categories: categories
      .filter((c) => cats.has(c.slug))
      .map((c) => ({ value: c.slug, label: c.name })),
    methods: methods
      .filter((m) => meths.has(m.slug))
      .map((m) => ({ value: m.slug, label: m.name })),
    sizes: sizes.filter((s) => sz.has(s.slug)).map((s) => ({ value: s.slug, label: s.label })),
  };
}
