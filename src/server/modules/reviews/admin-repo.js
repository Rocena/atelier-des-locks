// @ts-check
/**
 * Accès admin aux avis : liste par statut, modération, réponse, mise en avant.
 * Seul fichier SQL de cette partie du module. Requêtes paramétrées uniquement.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 */

export const REVIEW_STATUSES = /** @type {const} */ (['pending', 'approved', 'rejected']);

/**
 * @param {Db} db
 * @param {{ status: 'pending'|'approved'|'rejected' }} q
 */
export async function findReviews(db, q) {
  const { rows } = await db.query(
    `SELECT r.id, r.author_name, r.rating, r.body, r.status, r.featured, r.verified,
            r.owner_reply, r.replied_at, r.submitted_at, r.is_placeholder,
            (r.photo_path IS NOT NULL) AS has_photo, s.name AS service_name
       FROM reviews r LEFT JOIN services s ON s.id = r.service_id
      WHERE r.status = $1
      ORDER BY r.submitted_at DESC, r.id LIMIT 200`,
    [q.status],
  );
  return rows.map((r) => ({
    id: /** @type {string} */ (r.id),
    author: /** @type {string} */ (r.author_name),
    rating: /** @type {number} */ (r.rating),
    body: /** @type {string} */ (r.body),
    status: /** @type {string} */ (r.status),
    featured: /** @type {boolean} */ (r.featured),
    verified: /** @type {boolean} */ (r.verified),
    ownerReply: /** @type {string|null} */ (r.owner_reply),
    repliedAt: /** @type {Date|null} */ (r.replied_at),
    submittedAt: /** @type {Date} */ (r.submitted_at),
    isPlaceholder: /** @type {boolean} */ (r.is_placeholder),
    hasPhoto: /** @type {boolean} */ (r.has_photo),
    serviceName: /** @type {string|null} */ (r.service_name),
  }));
}

/** Effectifs par statut (onglets). @param {Db} db */
export async function countByStatus(db) {
  const { rows } = await db.query('SELECT status, count(*)::int AS n FROM reviews GROUP BY status');
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) counts[/** @type {'pending'|'approved'|'rejected'} */ (r.status)] = r.n;
  return counts;
}

/** @param {Db} db @param {string} id */
export async function findReview(db, id) {
  const { rows } = await db.query(
    `SELECT id, status, consent_publication, featured, photo_path FROM reviews WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  return r
    ? {
        id: /** @type {string} */ (r.id),
        status: /** @type {string} */ (r.status),
        consent: /** @type {boolean} */ (r.consent_publication),
        featured: /** @type {boolean} */ (r.featured),
      }
    : null;
}

/**
 * Approuver ou refuser. Un avis refusé n'est jamais mis en avant. La contrainte de la base
 * (publication = consentement) protège aussi : on ne publie pas sans accord de la cliente.
 * @param {Db} db @param {string} id @param {'approved'|'rejected'} status
 */
export async function setReviewStatus(db, id, status) {
  const { rowCount } = await db.query(
    `UPDATE reviews SET status = $2, featured = CASE WHEN $2 = 'approved' THEN featured ELSE false END
      WHERE id = $1`,
    [id, status],
  );
  return rowCount === 1;
}

/** @param {Db} db @param {string} id @param {boolean} featured */
export async function setFeatured(db, id, featured) {
  const { rowCount } = await db.query(
    `UPDATE reviews SET featured = $2 WHERE id = $1 AND status = 'approved'`,
    [id, featured],
  );
  return rowCount === 1;
}

/** Réponse publique de la propriétaire (vide = supprimée). @param {Db} db @param {string} id @param {string|null} reply */
export async function setReply(db, id, reply) {
  const { rowCount } = await db.query(
    `UPDATE reviews SET owner_reply = $2, replied_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
      WHERE id = $1`,
    [id, reply],
  );
  return rowCount === 1;
}

/** Chemin de la photo d'un avis, quel que soit son statut (admin connectée uniquement). @param {Db} db @param {string} id */
export async function findPhotoPath(db, id) {
  const { rows } = await db.query('SELECT photo_path FROM reviews WHERE id = $1', [id]);
  return /** @type {string|null} */ (rows[0]?.photo_path ?? null);
}
