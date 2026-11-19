// @ts-check
/**
 * Galerie des réalisations. Phase 2 : seed JSON ; phase 3 : table `gallery_items`.
 * @typedef {object} GalleryItem
 * @property {string} id
 * @property {string} title
 * @property {string} category
 * @property {string|null} method
 * @property {string} size
 * @property {'portrait'|'landscape'|'square'} ratio
 * @property {boolean} featured
 * @typedef {{ slug: string, label: string }} Size
 */
import { readSeed } from '../../db/json-store.js';

/** @returns {Promise<{ items: GalleryItem[], sizes: Size[] }>} */
export async function findGallery() {
  return /** @type {{ items: GalleryItem[], sizes: Size[] }} */ (readSeed('gallery'));
}
