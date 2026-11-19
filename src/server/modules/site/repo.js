// @ts-check
/**
 * Réglages éditables (bandeau d'annonce, fondatrice, chiffres, Instagram) et FAQ.
 * Phase 2 : seeds JSON ; phase 3 : tables `settings` et `faq_items`.
 * @typedef {object} Settings
 * @property {{ enabled: boolean, id: string, text: string, linkLabel: string, href: string }} announcement
 * @property {{ firstName: string, displayName: string, role: string }} founder
 * @property {{ clients: number, yearsOfPractice: number, isPlaceholder: boolean }} stats
 * @property {{ handle: string, url: string, tiles: string[] }} instagram
 * @typedef {{ slug: string, title: string, items: { q: string, a: string }[] }} FaqGroup
 */
import { readSeed } from '../../db/json-store.js';

/** @returns {Promise<Settings>} */
export async function findSettings() {
  return /** @type {Settings} */ (readSeed('settings'));
}

/** @returns {Promise<FaqGroup[]>} */
export async function findFaq() {
  return /** @type {{ groups: FaqGroup[] }} */ (readSeed('faq')).groups;
}
