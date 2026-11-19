// @ts-check
/**
 * Lecture des données seed JSON de la phase 2 (src/server/db/seeds/*.json).
 * Phase 3 : ces données migrent en base ; seuls les repo.js qui appellent ce module changent.
 * Les fichiers sont lus une fois puis gardés en mémoire (lecture seule).
 */
import { readFileSync } from 'node:fs';

/** @type {Map<string, unknown>} */
const cache = new Map();

/**
 * @template T
 * @param {'services'|'methods'|'gallery'|'reviews'|'articles'|'faq'|'settings'} name
 * @returns {T}
 */
export function readSeed(name) {
  if (!cache.has(name)) {
    const url = new URL(`./seeds/${name}.json`, import.meta.url);
    cache.set(name, Object.freeze(JSON.parse(readFileSync(url, 'utf8'))));
  }
  return /** @type {T} */ (cache.get(name));
}
