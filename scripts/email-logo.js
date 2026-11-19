// @ts-check
/**
 * Génère le logo des emails en PNG (public/brand/logo-email.png).
 * Gmail, Outlook et plusieurs clients mobiles n'affichent pas les SVG : les emails utilisent ce PNG
 * (2x, affiché à 280 px de large). Source : brand/logo-horizontal-sombre.svg (fond ébène).
 * Usage : npm run email-logo
 */
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = new URL('../public/brand/logo-horizontal-sombre.svg', import.meta.url);
const target = new URL('../public/brand/logo-email.png', import.meta.url);

const info = await sharp(fileURLToPath(source), { density: 300 })
  .resize({ width: 560 })
  .png({ compressionLevel: 9, palette: true })
  .toFile(target.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
console.info(`logo-email.png : ${info.width}×${info.height}, ${info.size} octets`);
