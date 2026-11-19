// @ts-check
/**
 * Scellement du jeton « Gérer mon RDV » dans la charge utile des jobs (§13).
 *
 * Le jeton n'existe en clair qu'à la création du RDV (la base ne garde que son empreinte). Les
 * rappels programmés des jours plus tard doivent pourtant contenir le lien : on le chiffre
 * (AES-256-GCM, clé dérivée du secret de session) avant de le déposer dans la table des jobs.
 * Une fuite de la base ne donne donc pas de lien utilisable ; une charge modifiée est refusée.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** @param {string} secret */
const keyOf = (secret) =>
  Buffer.from(hkdfSync('sha256', secret, 'atelier-des-locks', 'notification-token-seal', 32));

/**
 * @param {string} token
 * @param {string} secret
 * @returns {string} base64url(iv ‖ tag ‖ chiffré)
 */
export function sealToken(token, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/**
 * @param {string|undefined} sealed
 * @param {string} secret
 * @returns {string|null} le jeton, ou null (absent, altéré ou clé différente)
 */
export function openToken(sealed, secret) {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length < 12 + 16 + 1) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
