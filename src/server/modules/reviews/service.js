// @ts-check
/**
 * Synthèse des avis (fonctions pures) et dépôt d'un avis par lien à jeton.
 * @typedef {import('./repo.js').Review} Review
 */
import * as repo from './repo.js';
import { authorName } from './schemas.js';
import { generateToken, hashToken } from '../booking/tokens.js';

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

// ─── Dépôt d'un avis par lien à jeton (§8) ───────────────────────────────────

/** Le lien « laisser un avis » est valable 30 jours (§8). */
export const REVIEW_LINK_DAYS = 30;
const DAY = 86_400_000;

export class ReviewError extends Error {
  /** @param {'not_found'|'used'|'expired'|'not_completed'|'already_reviewed'} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * Émet un jeton à usage unique. Le jeton en clair part dans l'email ; seule son empreinte est
 * stockée. Une relance réutilise l'échéance du premier lien (`expiresAt`) : elle ne prolonge pas.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} appointmentId
 * @param {Date} now
 * @param {{ expiresAt?: Date }} [options]
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function issueReviewToken(db, appointmentId, now, { expiresAt } = {}) {
  const { token, hash } = generateToken();
  const expiry = expiresAt ?? new Date(now.getTime() + REVIEW_LINK_DAYS * DAY);
  await repo.insertReviewToken(db, { appointmentId, tokenHash: hash, expiresAt: expiry });
  return { token, expiresAt: expiry };
}

/**
 * État d'un lien pour afficher le formulaire. Les cas d'échec sont distingués pour un message
 * clair à la cliente (« déjà utilisé » ≠ « expiré »).
 * @param {import('pg').Pool} db
 * @param {string} token
 * @param {Date} now
 * @returns {Promise<{ state: 'open', view: repo.ReviewTokenView } | { state: 'used'|'expired'|'invalid' }>}
 */
export async function getReviewForm(db, token, now) {
  const view = await repo.findByToken(db, hashToken(token));
  if (!view) return { state: 'invalid' };
  if (view.used || view.alreadyReviewed) return { state: 'used' };
  if (view.expiresAt <= now) return { state: 'expired' };
  if (view.appointmentStatus !== 'completed') return { state: 'invalid' };
  return { state: 'open', view };
}

/**
 * Dépose l'avis dans une transaction : le jeton est verrouillé, vérifié, puis consommé en même
 * temps que l'avis est créé (deux envois simultanés ne produisent qu'un avis).
 * L'avis arrive « à modérer » : il n'est jamais publié sans validation de la propriétaire.
 * @param {import('pg').Pool} pool
 * @param {{ token: string, form: { rating: number, body: string, firstName: string, lastInitial: string }, photoPath: string|null, now: Date }} q
 * @returns {Promise<{ reviewId: string }>}
 */
export async function submitReview(pool, { token, form, photoPath, now }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const view = await repo.findByToken(client, hashToken(token), { forUpdate: true });
    if (!view) throw new ReviewError('not_found');
    if (view.used || view.alreadyReviewed) throw new ReviewError('used');
    if (view.expiresAt <= now) throw new ReviewError('expired');
    if (view.appointmentStatus !== 'completed') throw new ReviewError('not_completed');
    const reviewId = await repo.insertReview(client, {
      appointmentId: view.appointmentId,
      serviceId: view.serviceId,
      author: authorName(form),
      rating: form.rating,
      body: form.body,
      photoPath,
    });
    await repo.consumeToken(client, view.tokenId, now);
    await client.query('COMMIT');
    return { reviewId };
  } catch (error) {
    await client.query('ROLLBACK');
    // Unicité (appointment_id) : un autre envoi a gagné la course.
    if (/** @type {any} */ (error)?.code === '23505') throw new ReviewError('used');
    throw error;
  } finally {
    client.release();
  }
}
