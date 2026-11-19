// @ts-check
/**
 * Résout les URLs des CSS / JS d'une page.
 * - dev : fichiers sources servis par Vite (HMR) ;
 * - prod : fichiers hashés lus dans le manifest Vite (dist/client/.vite/manifest.json).
 */
import { readFileSync, existsSync } from 'node:fs';
import { entries } from '../../client/entries.js';

/** Polices préchargées (BRAND.md : Bodoni 500 et Manrope 400, sous-ensemble latin). */
const PRELOAD_FONTS = [/bodoni-moda-latin-opsz-normal/, /manrope-latin-wght-normal/];

/**
 * @typedef {object} PageAssets
 * @property {string[]} styles
 * @property {string[]} scripts
 * @property {string[]} fonts  polices à précharger
 */

/**
 * @typedef {object} ManifestChunk
 * @property {string} file
 * @property {string[]} [css]
 * @property {string[]} [assets]
 */

/**
 * @param {{ dev: boolean, manifestPath?: string }} options
 * @returns {(name: import('../../client/entries.js').EntryName) => PageAssets}
 */
export function createAssetResolver({ dev, manifestPath = 'dist/client/.vite/manifest.json' }) {
  if (dev) {
    return (name) => {
      const entry = entries[name];
      return {
        styles: [`/${entry.css}`],
        scripts: ['/@vite/client', `/${entry.js}`],
        fonts: [],
      };
    };
  }

  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest Vite introuvable (${manifestPath}). Lancez d'abord : npm run build`);
  }
  /** @type {Record<string, ManifestChunk>} */
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  return (name) => {
    const entry = entries[name];
    const cssChunk = manifest[entry.css];
    const jsChunk = manifest[entry.js];
    const styles = [cssChunk?.file, ...(jsChunk?.css ?? [])].filter(Boolean).map((f) => `/${f}`);
    const fonts = (cssChunk?.assets ?? [])
      .filter((file) => PRELOAD_FONTS.some((re) => re.test(file)))
      .map((f) => `/${f}`);
    return { styles, scripts: jsChunk ? [`/${jsChunk.file}`] : [], fonts };
  };
}
