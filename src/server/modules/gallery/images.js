// @ts-check
/**
 * Photos de la galerie (§9, §13) : type réel par magic bytes, ré-encodage sharp (neutralise les
 * fichiers piégés, supprime l'EXIF), deux tailles (1600 px et 600 px), noms aléatoires,
 * stockage hors webroot. Servies publiquement par /media/galerie/:fichier (noms UUID seulement).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MAX_PHOTO_BYTES, UploadError, detectImageType } from '../booking/upload.js';

const MAX_PIXELS = 60_000_000;
const FULL_SIDE = 1600;
const THUMB_WIDTH = 600;

/** Nom d'un fichier de galerie servi publiquement (jamais autre chose que ce motif). */
export const GALLERY_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-600)?\.webp$/;

/**
 * Orientation d'après les dimensions : l'utilisatrice ne peut pas la falsifier.
 * @param {number} width @param {number} height
 * @returns {'portrait'|'landscape'|'square'}
 */
export function ratioOf(width, height) {
  const r = width / height;
  if (r < 0.9) return 'portrait';
  if (r > 1.1) return 'landscape';
  return 'square';
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ full: Buffer, thumb: Buffer, ratio: 'portrait'|'landscape'|'square' }>}
 */
export async function processGalleryImage(buffer) {
  if (buffer.length > MAX_PHOTO_BYTES) throw new UploadError('too_large');
  if (!detectImageType(buffer)) throw new UploadError('bad_type');
  try {
    const base = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate();
    const full = await base
      .clone()
      .resize(FULL_SIDE, FULL_SIDE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(full.data)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return {
      full: full.data,
      thumb,
      ratio: ratioOf(full.info.width, full.info.height),
    };
  } catch {
    throw new UploadError('unreadable');
  }
}

/**
 * Enregistre les deux tailles. Renvoie le chemin relatif stocké en base (`gallery/<uuid>.webp`).
 * @param {string} uploadDir
 * @param {{ full: Buffer, thumb: Buffer }} images
 */
export async function storeGalleryImage(uploadDir, { full, thumb }) {
  const id = randomUUID();
  const dir = path.join(uploadDir, 'gallery');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}.webp`), full, { mode: 0o644, flag: 'wx' });
  await writeFile(path.join(dir, `${id}-600.webp`), thumb, { mode: 0o644, flag: 'wx' });
  return `gallery/${id}.webp`;
}

/** Supprime les deux tailles d'une photo. @param {string} uploadDir @param {string|null} relative */
export async function removeGalleryImage(uploadDir, relative) {
  if (!relative || !/^gallery\/[0-9a-f-]{36}\.webp$/.test(relative)) return;
  await rm(path.join(uploadDir, relative), { force: true });
  await rm(path.join(uploadDir, relative.replace(/\.webp$/, '-600.webp')), { force: true });
}

/**
 * Suggestion de texte alternatif à partir des étiquettes choisies (la propriétaire la corrige).
 * @param {{ category?: string|null, method?: string|null, size?: string|null }} tags
 */
export function suggestAlt({ category, method, size }) {
  const parts = [
    category,
    method ? `méthode ${method}` : null,
    size ? `locks ${size}` : null,
  ].filter(Boolean);
  return parts.length ? `Réalisation du salon : ${parts.join(', ')}.` : '';
}
