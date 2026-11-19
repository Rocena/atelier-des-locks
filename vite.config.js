// @ts-check
import { defineConfig } from 'vite';
import { entries } from './src/client/entries.js';

/** Chaque page déclare un CSS et un JS : les deux deviennent des entrées de build. */
const input = Object.fromEntries(
  Object.entries(entries).flatMap(([name, files]) => [
    [`${name}-css`, files.css],
    [`${name}-js`, files.js],
  ]),
);

export default defineConfig({
  root: '.',
  publicDir: 'public',
  appType: 'custom',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    manifest: true,
    assetsInlineLimit: 0,
    rollupOptions: { input },
  },
  css: { devSourcemap: true },
  // Dépendances chargées à la demande (première interaction) : pré-optimisées au démarrage.
  // Sinon Vite les découvre en cours de route et recharge toutes les pages ouvertes
  // (un tunnel de réservation à moitié rempli repartirait à l'étape 1 en développement).
  optimizeDeps: { include: ['gsap', 'gsap/ScrollTrigger', 'gsap/SplitText', 'lenis'] },
});
