// @ts-check
/**
 * Accès aux fiches clientes (admin). Seul fichier SQL du module. Requêtes paramétrées.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 */

export const PAGE_SIZE = 30;

/**
 * Chiffres à chercher dans les téléphones (stockés en +33…) : « 06 12 34 » devient « 3361234 ».
 * Seule une saisie qui ressemble à un numéro (chiffres et séparateurs, 3 chiffres au moins) est
 * cherchée : « E2E mobile » ne doit pas trouver tous les numéros qui contiennent un 2.
 * @param {string} text
 * @returns {string}  chiffres à chercher, ou chaîne vide
 */
export function phoneNeedle(text) {
  if (!/^[\d\s+().-]+$/.test(text)) return '';
  const digits = text.replace(/\D/g, '');
  if (digits.length < 3) return '';
  return digits.startsWith('0') ? `33${digits.slice(1)}` : digits;
}

/** Échappe % et _ pour un ILIKE littéral. @param {string} text */
const likeEscape = (text) => text.replace(/[\\%_]/g, '\\$&');

/**
 * Recherche (nom, email, téléphone). Les fiches anonymisées sont exclues.
 * @param {Db} db
 * @param {{ q?: string, page: number }} q
 */
export async function searchClients(db, q) {
  const pattern = q.q ? `%${likeEscape(q.q.trim())}%` : null;
  const digits = phoneNeedle(q.q ?? '');
  const { rows } = await db.query(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
            (SELECT count(*)::int FROM appointments a WHERE a.client_id = c.id
               AND a.status IN ('confirmed', 'completed')) AS visits,
            (SELECT max(a.starts_at) FROM appointments a WHERE a.client_id = c.id
               AND a.status IN ('confirmed', 'completed')) AS last_visit
       FROM clients c
      WHERE c.anonymized_at IS NULL
        AND ($1::text IS NULL
             OR (c.first_name || ' ' || c.last_name) ILIKE $1
             OR (c.last_name || ' ' || c.first_name) ILIKE $1
             OR c.email::text ILIKE $1
             OR ($2::text <> '' AND regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE '%' || $2 || '%'))
      ORDER BY lower(c.last_name), lower(c.first_name)
      LIMIT $3 OFFSET $4`,
    [pattern, digits, PAGE_SIZE + 1, (q.page - 1) * PAGE_SIZE],
  );
  return {
    hasNext: rows.length > PAGE_SIZE,
    rows: rows.slice(0, PAGE_SIZE).map((r) => ({
      id: /** @type {string} */ (r.id),
      firstName: /** @type {string} */ (r.first_name),
      lastName: /** @type {string} */ (r.last_name),
      email: /** @type {string} */ (r.email),
      phone: /** @type {string|null} */ (r.phone),
      visits: /** @type {number} */ (r.visits),
      lastVisit: /** @type {Date|null} */ (r.last_visit),
    })),
  };
}

/**
 * @typedef {object} ClientRecord
 * @property {string} id
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} email
 * @property {string|null} phone
 * @property {boolean} smsReminders
 * @property {boolean} newsletter
 * @property {Date|null} newsletterAt
 * @property {string|null} notes
 * @property {Date|null} anonymizedAt
 * @property {Date} createdAt
 */

/** @param {Db} db @param {string} id @returns {Promise<ClientRecord|null>} */
export async function findClient(db, id) {
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, email, phone, sms_reminders, newsletter_opt_in,
            newsletter_opt_in_at, internal_notes, anonymized_at, created_at
       FROM clients WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone,
    smsReminders: r.sms_reminders,
    newsletter: r.newsletter_opt_in,
    newsletterAt: r.newsletter_opt_in_at,
    notes: r.internal_notes,
    anonymizedAt: r.anonymized_at,
    createdAt: r.created_at,
  };
}

/**
 * @param {Db} db
 * @param {{ id: string, firstName: string, lastName: string, phone: string|null, smsReminders: boolean, notes: string|null }} c
 */
export async function updateClient(db, c) {
  await db.query(
    `UPDATE clients SET first_name = $2, last_name = $3, phone = $4, sms_reminders = $5,
            internal_notes = $6
      WHERE id = $1 AND anonymized_at IS NULL`,
    [c.id, c.firstName, c.lastName, c.phone, c.smsReminders, c.notes],
  );
}

/** Lignes de l'export CSV (fiches non anonymisées). @param {Db} db */
export async function findExportRows(db) {
  const { rows } = await db.query(
    `SELECT c.first_name, c.last_name, c.email, c.phone, c.sms_reminders, c.newsletter_opt_in,
            c.newsletter_opt_in_at, c.created_at,
            (SELECT count(*)::int FROM appointments a WHERE a.client_id = c.id
               AND a.status IN ('confirmed', 'completed')) AS visits,
            (SELECT max(a.starts_at) FROM appointments a WHERE a.client_id = c.id
               AND a.status IN ('confirmed', 'completed')) AS last_visit
       FROM clients c WHERE c.anonymized_at IS NULL
      ORDER BY lower(c.last_name), lower(c.first_name)`,
  );
  return rows.map((r) => ({
    firstName: /** @type {string} */ (r.first_name),
    lastName: /** @type {string} */ (r.last_name),
    email: /** @type {string} */ (r.email),
    phone: /** @type {string|null} */ (r.phone),
    smsReminders: /** @type {boolean} */ (r.sms_reminders),
    newsletter: /** @type {boolean} */ (r.newsletter_opt_in),
    newsletterAt: /** @type {Date|null} */ (r.newsletter_opt_in_at),
    createdAt: /** @type {Date} */ (r.created_at),
    visits: /** @type {number} */ (r.visits),
    lastVisit: /** @type {Date|null} */ (r.last_visit),
  }));
}

/**
 * Suppression RGPD : on efface les données personnelles et on garde l'historique chiffré
 * (statistiques, comptabilité). Renvoie les fichiers photo à supprimer du disque.
 * À appeler dans une transaction.
 * @param {Db} db
 * @param {string} id
 * @returns {Promise<string[]>}
 */
export async function anonymizeClient(db, id) {
  await db.query(
    `UPDATE clients
        SET first_name = 'Cliente', last_name = 'supprimée',
            email = 'supprime-' || id || '@sans-email.invalid',
            phone = NULL, sms_reminders = false, newsletter_opt_in = false,
            newsletter_opt_in_at = NULL, internal_notes = NULL, anonymized_at = now()
      WHERE id = $1`,
    [id],
  );
  // Rendez-vous à venir : annulés (la cliente n'existe plus, aucun message ne doit partir).
  await db.query(
    `UPDATE appointments
        SET status = 'cancelled_by_salon', cancelled_at = now(),
            cancellation_reason = 'Suppression des données de la cliente'
      WHERE client_id = $1 AND status IN ('pending', 'confirmed') AND starts_at > now()`,
    [id],
  );
  const photos = await db.query(
    `SELECT hair_photo_path FROM appointments WHERE client_id = $1 AND hair_photo_path IS NOT NULL
     UNION SELECT r.photo_path FROM reviews r JOIN appointments a ON a.id = r.appointment_id
      WHERE a.client_id = $1 AND r.photo_path IS NOT NULL`,
    [id],
  );
  await db.query(
    `UPDATE appointments
        SET client_notes = NULL, hair_state = NULL, hair_photo_path = NULL, internal_notes = NULL,
            manage_token_hash = NULL, manage_token_expires_at = NULL
      WHERE client_id = $1`,
    [id],
  );
  await db.query(
    `UPDATE reviews SET author_name = 'Cliente', photo_path = NULL
      WHERE appointment_id IN (SELECT id FROM appointments WHERE client_id = $1)`,
    [id],
  );
  await db.query(`UPDATE notifications_log SET recipient = '' WHERE client_id = $1`, [id]);
  return photos.rows.map((r) => /** @type {string} */ (r.hair_photo_path ?? r.photo_path));
}
