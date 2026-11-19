// @ts-check
/**
 * Photo des cheveux jointe à une réservation (§7.2, §13).
 * 1. type réel vérifié par les magic bytes (on ignore le nom et le type annoncés) ;
 * 2. taille max (aussi limitée en amont par @fastify/multipart) ;
 * 3. ré-encodage complet par sharp en WebP : neutralise un fichier piégé (polyglotte, script),
 *    supprime les métadonnées EXIF (géolocalisation), redresse selon l'orientation ;
 * 4. nom aléatoire, stockage hors du webroot (UPLOAD_DIR), jamais servi publiquement.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
/** Garde-fou contre les « bombes de décompression » (image minuscule en octets, énorme en pixels). */
const MAX_PIXELS = 50_000_000;
const MAX_SIDE = 2000;

export class UploadError extends Error {
  /** @param {'too_large'|'bad_type'|'unreadable'} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * Type réel d'après les premiers octets.
 * @param {Buffer} buffer
 * @returns {'jpeg'|'png'|'webp'|null}
 */
export function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Vérifie et ré-encode une photo. Renvoie le WebP propre.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
export async function sanitizePhoto(buffer) {
  if (buffer.length > MAX_PHOTO_BYTES) throw new UploadError('too_large');
  if (!detectImageType(buffer)) throw new UploadError('bad_type');
  try {
    return await sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new UploadError('unreadable');
  }
}

/**
 * Enregistre une photo nettoyée sous un nom aléatoire. Renvoie le chemin relatif stocké en base.
 * @param {string} uploadDir  dossier racine (hors webroot)
 * @param {Buffer} webp
 */
export async function storePhoto(uploadDir, webp) {
  const relative = `hair/${randomUUID()}.webp`;
  const target = path.join(uploadDir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, webp, { mode: 0o600, flag: 'wx' });
  return relative;
}

/**
 * Supprime une photo (réservation échouée après l'enregistrement).
 * @param {string} uploadDir
 * @param {string} relative
 */
export async function removePhoto(uploadDir, relative) {
  if (!/^hair\/[0-9a-f-]{36}\.webp$/.test(relative)) return;
  await rm(path.join(uploadDir, relative), { force: true });
}
