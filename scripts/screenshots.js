// @ts-check
/**
 * Captures du styleguide (desktop 1440 et mobile 390, clair et sombre) pour la revue visuelle.
 * Prérequis : serveur lancé (npm run dev). Usage : npm run screenshots [-- url]
 * Sortie : docs/screenshots/ (pleine page).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const outDir = 'docs/screenshots';
mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 },
];
const pages = [{ name: 'styleguide', path: '/styleguide' }];

const browser = await chromium.launch();
for (const vp of viewports) {
  for (const theme of /** @type {const} */ (['light', 'dark'])) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      colorScheme: theme,
      reducedMotion: 'reduce', // tout est révélé : capture fidèle de l'état final
    });
    const page = await context.newPage();
    const errors = /** @type {string[]} */ ([]);
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    page.on('pageerror', (err) => errors.push(err.message));
    for (const p of pages) {
      await page.goto(base + p.path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const file = `${outDir}/${p.name}-${vp.name}-${theme}.png`;
      await page.screenshot({ path: file, fullPage: true });
      // Vue au-dessus de la ligne de flottaison, pour juger la première impression
      await page.screenshot({ path: file.replace('.png', '-top.png') });
      console.info(
        `✓ ${file}${errors.length ? `  (erreurs console : ${errors.join(' | ')})` : ''}`,
      );
    }
    await context.close();
  }
}
await browser.close();
