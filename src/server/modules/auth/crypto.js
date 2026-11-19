// @ts-check
/**
 * Secrets de l'authentification : chiffrement du secret TOTP au repos (AES-256-GCM), codes de
 * secours (aléatoires, hachés avec une clé du serveur) et jetons de session (SHA-256).
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { base32Encode } from './totp.js';

/** @param {string} secret @param {string} purpose */
const deriveKey = (secret, purpose) =>
  Buffer.from(hkdfSync('sha256', secret, 'atelier-des-locks', purpose, 32));

/**
 * Chiffre le secret TOTP : une fuite de la base seule ne permet pas de générer de codes.
 * @param {string} plain
 * @param {string} secret  SESSION_SECRET
 */
export function encryptTotpSecret(plain, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, 'totp-secret'), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/**
 * @param {string|null} sealed
 * @param {string} secret
 * @returns {string|null}
 */
export function decryptTotpSecret(sealed, secret) {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(secret, 'totp-secret'),
      raw.subarray(0, 12),
    );
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const RECOVERY_CODE_COUNT = 10;

/** Dix codes de secours : 12 caractères base32 (60 bits), affichés « xxxx-xxxx-xxxx ». */
export function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(8)).slice(0, 12).toLowerCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

/** Normalise la saisie d'un code de secours (casse, tirets, espaces). @param {string} input */
export const normalizeRecoveryCode = (input) => input.toLowerCase().replace(/[^a-z2-7]/g, '');

/**
 * Empreinte d'un code de secours (HMAC avec une clé du serveur : inutilisable sans elle).
 * @param {string} code
 * @param {string} secret
 */
export function hashRecoveryCode(code, secret) {
  return createHmac('sha256', deriveKey(secret, 'recovery-code'))
    .update(normalizeRecoveryCode(code))
    .digest('hex');
}

/** Jeton de session : 32 octets aléatoires (cookie) et empreinte (base). */
export function generateSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashSessionToken(token) };
}

/** @param {string} token */
export const hashSessionToken = (token) => createHash('sha256').update(token, 'utf8').digest();
