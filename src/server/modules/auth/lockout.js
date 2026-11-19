// @ts-check
/**
 * Verrouillage progressif (§13) : après 5 échecs consécutifs, le compte se verrouille
 * 1 min, puis 5, 15 et 60 min aux échecs suivants. Un succès remet le compteur à zéro.
 * Mots de passe et codes 2FA comptent ensemble.
 */
export const FREE_ATTEMPTS = 5;
const STEPS_SECONDS = [60, 300, 900, 3600];

/**
 * Durée de verrouillage après `failedCount` échecs consécutifs.
 * @param {number} failedCount
 * @returns {number} secondes (0 = pas de verrouillage)
 */
export function lockoutSeconds(failedCount) {
  if (failedCount < FREE_ATTEMPTS) return 0;
  return STEPS_SECONDS[Math.min(failedCount - FREE_ATTEMPTS, STEPS_SECONDS.length - 1)];
}

/**
 * @param {Date|null} lockedUntil
 * @param {Date} now
 */
export const isLocked = (lockedUntil, now) => lockedUntil != null && lockedUntil > now;
