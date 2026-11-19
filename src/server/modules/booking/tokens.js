// @ts-check
/**
 * Jetons des liens « Gérer mon RDV » (§13) : 32 octets aléatoires, transmis en base64url,
 * seule l'empreinte SHA-256 est stockée. Une fuite de la base ne donne donc aucun lien utilisable.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_BYTES = 32;
/** Format d'un jeton dans une URL : 43 caractères base64url (32 octets). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Nouveau jeton (à envoyer à la cliente) et son empreinte (à stocker). */
export function generateToken() {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** @param {string} token */
export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Comparaison à temps constant de deux secrets de longueurs quelconques.
 * @param {string} a
 * @param {string} b
 */
export function safeEqual(a, b) {
  return timingSafeEqual(hashToken(a), hashToken(b));
}
