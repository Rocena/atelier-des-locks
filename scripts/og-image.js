// @ts-check
/**
 * Génère l'image Open Graph de marque (1200 × 630) : public/og-image.png.
 * Fond karité, soleil terre cuite, logo vertical (texte vectorisé, aucune police requise).
 * Usage : node scripts/og-image.js
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const logo = readFileSync('public/brand/logo-vertical.svg', 'utf8');
const html = `<!doctype html><html><head><style>
  html, body { margin: 0; }
  body { width: 1200px; height: 630px; background: #F4ECE2; position: relative; overflow: hidden; }
  .sun { position: absolute; width: 300px; height: 300px; border-radius: 50%; background: #A9472E; right: -110px; bottom: -150px; opacity: .9; }
  .rule { position: absolute; left: 80px; right: 80px; bottom: 64px; height: 1px; background: #B8914A; opacity: .8; }
  .logo { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -54%); width: 520px; }
  .logo svg { width: 100%; height: auto; display: block; }
</style></head><body><div class="sun"></div><div class="logo">${logo}</div><div class="rule"></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: 'public/og-image.png' });
await browser.close();
console.info('✓ public/og-image.png');
