// @ts-check
/**
 * Articles du plus récent au plus ancien (fonction pure).
 * @param {import('./repo.js').Article[]} articles
 */
export function sortArticles(articles) {
  return [...articles].sort((a, b) => b.date.localeCompare(a.date));
}
