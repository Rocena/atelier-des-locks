// @ts-check
/**
 * Captures pour la revue visuelle : pages publiques à 390, 768 et 1440 px (+ styleguide clair
 * et sombre). Mouvement réduit : tout est révélé, la capture montre l'état final.
 * Prérequis : serveur lancé (npm run dev, ou npm run build && npm start).
 * Usage : npm run screenshots [-- url]
 * Sortie : docs/screenshots/<page>-<largeur>-<thème>.png (pleine page) et -top.png (premier écran,
 * seules ces dernières sont suivies par git).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const outDir = 'docs/screenshots';
mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];
/** @type {{ name: string, path: string, themes: ('light'|'dark')[] }[]} */
const pages = [
  { name: 'accueil', path: '/', themes: ['light', 'dark'] },
  { name: 'prestations', path: '/prestations', themes: ['light'] },
  { name: 'prestation', path: '/prestations/creation-locks', themes: ['light'] },
  { name: 'methodes', path: '/methodes', themes: ['light'] },
  { name: 'galerie', path: '/galerie', themes: ['light'] },
  { name: 'le-salon', path: '/le-salon', themes: ['light'] },
  { name: 'contact', path: '/contact', themes: ['light'] },
  { name: 'styleguide', path: '/styleguide', themes: ['light', 'dark'] },
];

const browser = await chromium.launch();
for (const vp of viewports) {
  for (const theme of /** @type {const} */ (['light', 'dark'])) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      colorScheme: theme,
      reducedMotion: 'reduce',
      hasTouch: vp.width < 1024,
    });
    const page = await context.newPage();
    const errors = /** @type {string[]} */ ([]);
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    page.on('pageerror', (err) => errors.push(err.message));
    for (const p of pages.filter((pg) => pg.themes.includes(theme))) {
      errors.length = 0;
      const res = await page.goto(base + p.path, { waitUntil: 'networkidle' });
      if (!res?.ok()) {
        console.info(`- ${p.path} ignoré (${res?.status()})`);
        continue;
      }
      await page.evaluate(() => document.fonts.ready);
      const file = `${outDir}/${p.name}-${vp.name}-${theme}.png`;
      await page.screenshot({ path: file, fullPage: true });
      await page.screenshot({ path: file.replace('.png', '-top.png') });
      console.info(
        `✓ ${file}${errors.length ? `  (erreurs console : ${errors.join(' | ')})` : ''}`,
      );
    }
    await context.close();
  }
}
await browser.close();
