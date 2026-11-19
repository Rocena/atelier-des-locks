// @ts-check
/**
 * Vérification anti-bot respectueuse de la vie privée (§13), sur le principe d'ALTCHA :
 * une preuve de travail. Le serveur choisit un nombre secret n et publie SHA-256(sel + n) ;
 * le navigateur retrouve n par force brute (≈ 0,1 à 0,5 s), ce qui coûte cher à un robot qui
 * soumet en masse. Aucun service tiers, aucun cookie, aucune donnée personnelle, aucune image.
 *
 * Le défi est signé (HMAC) et expire : le serveur ne garde rien en mémoire, sauf la liste
 * des défis déjà utilisés jusqu'à leur expiration (une solution ne sert qu'une fois).
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const sha256 = (/** @type {string} */ value) => createHash('sha256').update(value).digest('hex');

/**
 * @typedef {object} Challenge
 * @property {'SHA-256'} algorithm
 * @property {string} challenge  SHA-256(salt + number), en hexadécimal
 * @property {string} salt       aléa + date d'expiration
 * @property {number} maxNumber
 * @property {string} signature  HMAC du défi
 */

/**
 * @param {{ key: string, now: Date, maxNumber?: number, ttlSeconds?: number }} options
 * @returns {Challenge}
 */
export function createChallenge({ key, now, maxNumber = 50_000, ttlSeconds = 1200 }) {
  const expires = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const salt = `${randomBytes(12).toString('hex')}?expires=${expires}`;
  const challenge = sha256(salt + randomInt(0, maxNumber + 1));
  const signature = createHmac('sha256', key).update(challenge).digest('hex');
  return { algorithm: 'SHA-256', challenge, salt, maxNumber, signature };
}

/**
 * Résout un défi (utilisé par les tests ; le navigateur fait la même chose en JS).
 * @param {Pick<Challenge, 'challenge' | 'salt' | 'maxNumber'>} c
 */
export function solveChallenge(c) {
  for (let n = 0; n <= c.maxNumber; n++) if (sha256(c.salt + n) === c.challenge) return n;
  return null;
}

/** Charge utile envoyée par le formulaire (JSON en base64). */
export function encodeSolution(/** @type {Challenge} */ c, /** @type {number} */ number) {
  const { algorithm, challenge, salt, signature } = c;
  return Buffer.from(JSON.stringify({ algorithm, challenge, salt, signature, number })).toString(
    'base64',
  );
}

/**
 * Vérificateur avec mémoire des défis déjà consommés.
 * @param {{ key: string }} options
 */
export function createVerifier({ key }) {
  /** @type {Map<string, number>} défi → expiration (s) */
  const used = new Map();

  /**
   * @param {unknown} payload  chaîne base64 du formulaire
   * @param {Date} now
   * @returns {boolean}
   */
  return function verify(payload, now) {
    if (typeof payload !== 'string' || payload.length > 1024) return false;
    let data;
    try {
      data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    } catch {
      return false;
    }
    const { challenge, salt, signature, number } = data ?? {};
    if (
      typeof challenge !== 'string' ||
      typeof salt !== 'string' ||
      typeof signature !== 'string' ||
      !Number.isInteger(number)
    ) {
      return false;
    }
    const expected = createHmac('sha256', key).update(challenge).digest();
    const given = Buffer.from(signature, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    const expires = Number(/[?&]expires=(\d+)/.exec(salt)?.[1]);
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (!expires || expires < nowSeconds) return false;
    if (sha256(salt + number) !== challenge) return false;
    // Purge des défis expirés, puis usage unique.
    for (const [c, exp] of used) if (exp < nowSeconds) used.delete(c);
    if (used.has(challenge)) return false;
    used.set(challenge, expires);
    return true;
  };
}
