// @ts-check
/**
 * Points d'entrée Vite (multi-pages).
 * Une page = une feuille de style + un module JS, référencés par le serveur
 * (src/server/lib/assets.js) et par vite.config.js.
 * Ajouter une page : créer les deux fichiers puis l'ajouter ici.
 */
export const entries = /** @type {const} */ ({
  home: {
    css: 'src/client/styles/pages/home.css',
    js: 'src/client/scripts/pages/home.js',
  },
  styleguide: {
    css: 'src/client/styles/pages/styleguide.css',
    js: 'src/client/scripts/pages/styleguide.js',
  },
});

/** @typedef {keyof typeof entries} EntryName */
