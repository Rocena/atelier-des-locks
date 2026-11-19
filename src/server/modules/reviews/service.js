// @ts-check
/**
 * Synthèse des avis (fonctions pures).
 * @typedef {import('./repo.js').Review} Review
 */

/**
 * Note moyenne (non arrondie), nombre d'avis et répartition par étoile (5 → 1).
 * @param {Review[]} reviews
 */
export function summarizeReviews(reviews) {
  const count = reviews.length;
  const average = count ? reviews.reduce((sum, r) => sum + r.rating, 0) / count : 0;
  const distribution = [5, 4, 3, 2, 1].map((stars) => {
    const n = reviews.filter((r) => r.rating === stars).length;
    return { stars, count: n, share: count ? n / count : 0 };
  });
  return { count, average, distribution };
}

/**
 * Avis mis en avant (accueil), les plus récents d'abord.
 * @param {Review[]} reviews
 * @param {number} [limit]
 */
export function featuredReviews(reviews, limit = 6) {
  return sortByDate(reviews.filter((r) => r.featured)).slice(0, limit);
}

/** @param {Review[]} reviews */
export function sortByDate(reviews) {
  return [...reviews].sort((a, b) => b.date.localeCompare(a.date));
}
