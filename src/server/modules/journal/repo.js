// @ts-check
/**
 * Articles du journal « Conseils ». Phase 2 : seed JSON ; phase 3 : table `articles`.
 * @typedef {object} Article
 * @property {string} slug
 * @property {string} title       avec un *mot* en accent
 * @property {string} plainTitle
 * @property {string} excerpt
 * @property {string} date
 * @property {number} readingMinutes
 * @property {string} topic
 * @property {{ title: string|null, paragraphs: string[] }[]} sections
 */
import { readSeed } from '../../db/json-store.js';

/** @returns {Promise<Article[]>} */
export async function findPublishedArticles() {
  return /** @type {{ articles: Article[] }} */ (readSeed('articles')).articles;
}
