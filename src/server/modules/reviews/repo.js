// @ts-check
/**
 * Avis clientes. Phase 2 : seed JSON (avis d'exemple, TODO-PROPRIO) ; phase 3 : table `reviews`
 * alimentée par le formulaire post-rendez-vous (avis vérifiés, §8).
 * @typedef {object} Review
 * @property {string} id
 * @property {string} author   prénom + initiale
 * @property {number} rating   1 à 5
 * @property {string} date     AAAA-MM-JJ
 * @property {string} service  slug de la prestation
 * @property {boolean} featured
 * @property {boolean} verified  laissé après un rendez-vous réel
 * @property {string} text
 */
import { readSeed } from '../../db/json-store.js';

/** @returns {Promise<Review[]>} */
export async function findPublishedReviews() {
  return /** @type {{ reviews: Review[] }} */ (readSeed('reviews')).reviews;
}
