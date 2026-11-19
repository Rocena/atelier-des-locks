// @ts-check
/**
 * Points d'entrée Vite (multi-pages).
 * Une entrée = une feuille de style + un module JS, référencés par le serveur
 * (src/server/lib/assets.js) et par vite.config.js. Plusieurs pages proches partagent une entrée.
 * Ajouter une page : créer les deux fichiers (ou réutiliser une entrée) puis la déclarer ici.
 */
export const entries = /** @type {const} */ ({
  home: {
    css: 'src/client/styles/pages/home.css',
    js: 'src/client/scripts/pages/home.js',
  },
  /** /prestations, /prestations/:slug, /tarifs */
  services: {
    css: 'src/client/styles/pages/services.css',
    js: 'src/client/scripts/pages/services.js',
  },
  methods: {
    css: 'src/client/styles/pages/methods.css',
    js: 'src/client/scripts/pages/methods.js',
  },
  gallery: {
    css: 'src/client/styles/pages/gallery.css',
    js: 'src/client/scripts/pages/gallery.js',
  },
  /** Le salon, avis, conseils, FAQ, contact, réserver, pages légales, 404 */
  editorial: {
    css: 'src/client/styles/pages/editorial.css',
    js: 'src/client/scripts/pages/editorial.js',
  },
  /** /reserver (tunnel en 4 étapes), /rdv/:token (gérer mon RDV) */
  booking: {
    css: 'src/client/styles/pages/booking.css',
    js: 'src/client/scripts/pages/booking.js',
  },
  styleguide: {
    css: 'src/client/styles/pages/styleguide.css',
    js: 'src/client/scripts/pages/styleguide.js',
  },
});

/** @typedef {keyof typeof entries} EntryName */
