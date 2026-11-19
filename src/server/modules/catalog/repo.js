// @ts-check
/**
 * Accès aux données du catalogue (catégories, prestations, méthodes).
 * Phase 2 : seeds JSON. Phase 3 : requêtes SQL paramétrées ici, et seulement ici.
 */
import { readSeed } from '../../db/json-store.js';

/**
 * @typedef {object} Category
 * @property {string} slug
 * @property {number} order
 * @property {string} name
 * @property {string} headline  titre avec un *mot* en accent
 * @property {string} summary
 * @property {string} intro
 * @property {string} media     libellé du visuel (placeholder)
 */

/**
 * @typedef {object} Service
 * @property {string} slug
 * @property {string} name
 * @property {string|null} category
 * @property {string[]} methods
 * @property {string} summary
 * @property {{ title: string, paragraphs: string[] }[]} body
 * @property {number} durationMin
 * @property {number} durationMax
 * @property {number} bufferAfter
 * @property {number|null} price
 * @property {boolean} priceFrom
 * @property {boolean} onQuote
 * @property {number|null} deposit
 * @property {string[]} photos
 * @property {{ q: string, a: string }[]} faq
 * @property {{ label: string, price: number }[]} options
 * @property {boolean} active
 * @property {boolean} bookableOnline
 * @property {number} order
 * @property {boolean} allergyTest
 * @property {boolean} featured
 * @property {boolean} isPlaceholder
 */

/**
 * @typedef {object} Method
 * @property {string} slug
 * @property {string} name
 * @property {string} aka
 * @property {'installation'|'maintenance'|'both'} family
 * @property {boolean} featured
 * @property {string} summary
 * @property {string} principle
 * @property {string} idealFor
 * @property {string} duration
 * @property {string} maturation
 * @property {string} maintenance
 * @property {string[]} pros
 * @property {string[]} watchouts
 * @property {string} service
 */

/** @typedef {{ name: string, period: string, text: string }} Stage */

/** @returns {Promise<{ categories: Category[], services: Service[] }>} */
export async function findCatalog() {
  const data = readSeed('services');
  return /** @type {{ categories: Category[], services: Service[] }} */ (data);
}

/** @returns {Promise<{ methods: Method[], stages: Stage[] }>} */
export async function findMethods() {
  return /** @type {{ methods: Method[], stages: Stage[] }} */ (readSeed('methods'));
}
