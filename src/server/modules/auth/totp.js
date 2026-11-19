// @ts-check
/**
 * TOTP (RFC 6238) avec node:crypto : SHA-1, 6 chiffres, pas de 30 s (compatible Google
 * Authenticator, Authy, 1Password, Apple Mots de passe). Fonctions pures, testées avec les
 * vecteurs de la RFC.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
export const DIGITS = 6;

/** @param {Buffer} buffer */
export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** @param {string} text */
export function base32Decode(text) {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  /** @type {number[]} */
  const bytes = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('base32 invalide');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secret de 160 bits, en base32 (20 octets, taille recommandée par la RFC 4226). */
export function generateSecret() {
  return base32Encode(randomBytes(20));
}

/**
 * @param {Buffer} key
 * @param {number} counter
 * @param {'sha1'|'sha256'|'sha512'} [algorithm]
 */
function hotp(key, counter, algorithm = 'sha1') {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(algorithm, key).update(message).digest();
  const offset = /** @type {number} */ (hmac.at(-1)) & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** @param {Date} at */
export const stepOf = (at) => Math.floor(at.getTime() / 1000 / STEP_SECONDS);

/**
 * Code attendu à un instant donné.
 * @param {string} secret  base32
 * @param {Date} at
 */
export function totpAt(secret, at) {
  return hotp(base32Decode(secret), stepOf(at));
}

/**
 * Code attendu pour un compteur donné (vecteurs de la RFC 4226/6238, tests).
 * @param {Buffer} key
 * @param {number} counter
 * @param {'sha1'|'sha256'|'sha512'} [algorithm]
 */
export const hotpAt = hotp;

/**
 * Vérifie un code avec une tolérance de ±1 pas (dérive d'horloge du téléphone).
 * Renvoie le pas validé (à mémoriser pour refuser le rejeu), ou null.
 * @param {string} secret  base32
 * @param {string} code
 * @param {Date} at
 * @param {{ lastStep?: number|null, window?: number }} [options]
 * @returns {number|null}
 */
export function verifyTotp(secret, code, at, { lastStep = null, window = 1 } = {}) {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const key = base32Decode(secret);
  const current = stepOf(at);
  const given = Buffer.from(clean);
  /** @type {number|null} */
  let found = null;
  // Toutes les fenêtres sont comparées (temps constant), même après une correspondance.
  for (let step = current - window; step <= current + window; step += 1) {
    const expected = Buffer.from(hotp(key, step));
    if (timingSafeEqual(expected, given) && found === null) found = step;
  }
  if (found === null) return null;
  if (lastStep != null && found <= Number(lastStep)) return null;
  return found;
}

/**
 * URI à encoder dans le QR code (format Key URI de Google Authenticator).
 * @param {{ secret: string, account: string, issuer: string }} p
 */
export function otpauthUri({ secret, account, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${query}`;
}

/** Secret affiché par groupes de 4 pour la saisie manuelle. @param {string} secret */
export const formatSecret = (secret) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;
