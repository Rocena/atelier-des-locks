// @ts-check
/**
 * Avis clientes (tables reviews et review_tokens). Seul fichier du module qui contient du SQL.
 * Lecture publique : seuls les avis approuvés (et publiables) sont renvoyés.
 * Les avis d'exemple (is_placeholder, TODO-PROPRIO) sont à remplacer avant la mise en ligne.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 * @typedef {object} Review
 * @property {string} id
 * @property {string} author   prénom + initiale
 * @property {number} rating   1 à 5
 * @property {string} date     AAAA-MM-JJ
 * @property {string} service  slug de la prestation
 * @property {boolean} featured
 * @property {boolean} verified  laissé après un rendez-vous réel
 * @property {string} text
 * @property {boolean} hasPhoto  photo du résultat (servie par /avis/photos/:id)
 * @property {string|null} ownerReply  réponse publique de la propriétaire
 */

/**
 * @param {Db} db
 * @returns {Promise<Review[]>}
 */
export async function findPublishedReviews(db) {
  const { rows } = await db.query(
    `SELECT r.id, r.author_name AS author, r.rating,
            to_char(r.submitted_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS date,
            s.slug AS service, r.featured, r.verified, r.body AS text,
            (r.photo_path IS NOT NULL) AS "hasPhoto", r.owner_reply AS "ownerReply"
       FROM reviews r LEFT JOIN services s ON s.id = r.service_id
      WHERE r.status = 'approved' AND r.consent_publication
      ORDER BY r.submitted_at DESC, r.id`,
  );
  return rows;
}

/**
 * Chemin de la photo d'un avis publié (null si l'avis n'est pas publié ou sans photo).
 * @param {Db} db
 * @param {string} id
 * @returns {Promise<string|null>}
 */
export async function findPublishedPhotoPath(db, id) {
  const { rows } = await db.query(
    `SELECT photo_path FROM reviews
      WHERE id = $1 AND status = 'approved' AND consent_publication AND photo_path IS NOT NULL`,
    [id],
  );
  return rows[0]?.photo_path ?? null;
}

// ─── Jetons de dépôt ─────────────────────────────────────────────────────────

/**
 * Enregistre l'empreinte d'un jeton « laisser un avis ».
 * @param {Db} db
 * @param {{ appointmentId: string, tokenHash: Buffer, expiresAt: Date }} t
 */
export async function insertReviewToken(db, t) {
  await db.query(
    `INSERT INTO review_tokens (appointment_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [t.appointmentId, t.tokenHash, t.expiresAt],
  );
}

/**
 * Jeton encore utilisable d'un RDV (le plus lointain), pour la relance : on reprend son échéance.
 * @param {Db} db
 * @param {string} appointmentId
 * @param {Date} now
 * @returns {Promise<{ expiresAt: Date }|null>}
 */
export async function findUsableToken(db, appointmentId, now) {
  const { rows } = await db.query(
    `SELECT max(expires_at) AS expires_at FROM review_tokens
      WHERE appointment_id = $1 AND used_at IS NULL AND expires_at > $2`,
    [appointmentId, now],
  );
  return rows[0]?.expires_at ? { expiresAt: rows[0].expires_at } : null;
}

/**
 * Note qu'une relance est partie (une seule relance par RDV, §7.6).
 * @param {Db} db
 * @param {string} appointmentId
 * @param {Date} now
 */
export async function markReminderSent(db, appointmentId, now) {
  await db.query(
    `UPDATE review_tokens SET reminder_sent_at = $2
      WHERE appointment_id = $1 AND reminder_sent_at IS NULL`,
    [appointmentId, now],
  );
}

/** La relance a-t-elle déjà été envoyée pour ce RDV ? @param {Db} db @param {string} appointmentId */
export async function reminderAlreadySent(db, appointmentId) {
  const { rows } = await db.query(
    `SELECT 1 FROM review_tokens WHERE appointment_id = $1 AND reminder_sent_at IS NOT NULL LIMIT 1`,
    [appointmentId],
  );
  return rows.length > 0;
}

/**
 * @typedef {object} ReviewTokenView
 * @property {number} tokenId
 * @property {string} appointmentId
 * @property {number|null} serviceId
 * @property {string} serviceName
 * @property {string} firstName
 * @property {string} lastInitial
 * @property {string} appointmentStatus
 * @property {Date} expiresAt
 * @property {boolean} used
 * @property {boolean} alreadyReviewed
 */

/**
 * Jeton, rendez-vous et prénom associés. Le jeton expiré ou utilisé est renvoyé (pour un message
 * précis) ; c'est le service qui décide.
 * @param {Db} db
 * @param {Buffer} tokenHash
 * @param {{ forUpdate?: boolean }} [options]  verrouille jeton et RDV (dans une transaction)
 * @returns {Promise<ReviewTokenView|null>}
 */
export async function findByToken(db, tokenHash, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT t.id AS token_id, t.appointment_id, t.expires_at, t.used_at,
            a.status, a.service_id, s.name AS service_name,
            c.first_name, left(c.last_name, 1) AS last_initial,
            EXISTS (SELECT 1 FROM reviews r WHERE r.appointment_id = a.id) AS reviewed
       FROM review_tokens t
       JOIN appointments a ON a.id = t.appointment_id
       JOIN services s ON s.id = a.service_id
       JOIN clients c ON c.id = a.client_id
      WHERE t.token_hash = $1
      ${forUpdate ? 'FOR UPDATE OF t' : ''}`,
    [tokenHash],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    tokenId: Number(r.token_id),
    appointmentId: r.appointment_id,
    serviceId: r.service_id == null ? null : Number(r.service_id),
    serviceName: r.service_name,
    firstName: r.first_name,
    lastInitial: r.last_initial,
    appointmentStatus: r.status,
    expiresAt: r.expires_at,
    used: r.used_at !== null,
    alreadyReviewed: r.reviewed,
  };
}

/**
 * Dépose l'avis : « à modérer », vérifié (rendez-vous réel), publication consentie.
 * Contrainte d'unicité sur appointment_id : un seul avis par rendez-vous.
 * @param {Db} db
 * @param {{ appointmentId: string, serviceId: number|null, author: string, rating: number, body: string, photoPath: string|null }} r
 * @returns {Promise<string>} identifiant de l'avis
 */
export async function insertReview(db, r) {
  const { rows } = await db.query(
    `INSERT INTO reviews (appointment_id, service_id, author_name, rating, body, photo_path,
                          consent_publication, status, verified)
     VALUES ($1, $2, $3, $4, $5, $6, true, 'pending', true)
     RETURNING id`,
    [r.appointmentId, r.serviceId, r.author, r.rating, r.body, r.photoPath],
  );
  return rows[0].id;
}

/** @param {Db} db @param {number} tokenId @param {Date} now */
export async function consumeToken(db, tokenId, now) {
  await db.query(`UPDATE review_tokens SET used_at = $2 WHERE id = $1`, [tokenId, now]);
}

/** Avis en attente de modération (compteur de l'admin, phase 6). @param {Db} db */
export async function countPending(db) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM reviews WHERE status = 'pending'`,
  );
  return rows[0].n;
}
