// @ts-check
/**
 * Avis clientes (table reviews), lecture publique : seuls les avis approuvés sont renvoyés.
 * Seul fichier du module qui contient du SQL.
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
 */

/**
 * @param {Db} db
 * @returns {Promise<Review[]>}
 */
export async function findPublishedReviews(db) {
  const { rows } = await db.query(
    `SELECT r.id, r.author_name AS author, r.rating,
            to_char(r.submitted_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS date,
            s.slug AS service, r.featured, r.verified, r.body AS text
       FROM reviews r LEFT JOIN services s ON s.id = r.service_id
      WHERE r.status = 'approved' AND r.consent_publication
      ORDER BY r.submitted_at DESC, r.id`,
  );
  return rows;
}
