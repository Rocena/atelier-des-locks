// @ts-check
/**
 * Accès aux données des notifications. Seul fichier du module qui contient du SQL.
 * Requêtes paramétrées uniquement.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 */

/**
 * RDV, prestation et cliente tels qu'ils sont MAINTENANT (les jobs ne portent aucune donnée
 * personnelle : tout est relu ici à l'exécution).
 * @param {Db} db
 * @param {string} appointmentId
 * @returns {Promise<(import('./messages.js').MessageContext & { clientId: string }) | null>}
 */
export async function findContext(db, appointmentId) {
  const { rows } = await db.query(
    `SELECT a.id, a.status, a.starts_at, a.duration_minutes, a.price_cents, a.price_from,
            a.hair_state, a.client_notes, (a.hair_photo_path IS NOT NULL) AS has_photo, a.updated_at,
            s.name AS service_name,
            c.id AS client_id, c.first_name, c.last_name, c.email, c.phone, c.sms_reminders,
            (c.anonymized_at IS NOT NULL) AS anonymized,
            EXISTS (SELECT 1 FROM reviews r WHERE r.appointment_id = a.id) AS has_review,
            (SELECT array_agg(o.label ORDER BY o.id) FROM appointment_options o
              WHERE o.appointment_id = a.id) AS options
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN clients c ON c.id = a.client_id
      WHERE a.id = $1`,
    [appointmentId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    appointmentId: r.id,
    clientId: r.client_id,
    status: r.status,
    startsAt: r.starts_at,
    durationMinutes: r.duration_minutes,
    serviceName: r.service_name,
    options: r.options ?? [],
    price: r.price_cents == null ? null : r.price_cents / 100,
    priceFrom: r.price_from,
    hairState: r.hair_state,
    clientNotes: r.client_notes,
    hasPhoto: r.has_photo,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.anonymized ? '' : r.email,
    phone: r.anonymized ? null : r.phone,
    smsReminders: r.sms_reminders,
    anonymized: r.anonymized,
    hasReview: r.has_review,
    updatedAt: r.updated_at,
  };
}

/**
 * @typedef {object} LogEntry
 * @property {string} appointmentId
 * @property {string|null} clientId
 * @property {'email'|'sms'} channel
 * @property {string} template
 * @property {string} recipient
 * @property {string} dedupeKey
 */

/**
 * Réserve l'envoi : crée la ligne de journal (ou la reprend si un essai précédent a échoué).
 * Renvoie null si ce message est déjà parti (ou écarté) : on ne l'envoie pas deux fois.
 * @param {Db} db
 * @param {LogEntry} e
 * @returns {Promise<string|null>} identifiant de la ligne de journal
 */
export async function claimLog(db, e) {
  const { rows } = await db.query(
    `INSERT INTO notifications_log (appointment_id, client_id, channel, template, recipient,
                                    status, attempts, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, 'queued', 1, $6)
     ON CONFLICT (dedupe_key, channel) WHERE dedupe_key IS NOT NULL
     DO UPDATE SET attempts = notifications_log.attempts + 1, status = 'queued', error = NULL
        WHERE notifications_log.status IN ('queued', 'failed')
     RETURNING id`,
    [e.appointmentId, e.clientId, e.channel, e.template, e.recipient, e.dedupeKey],
  );
  return rows[0]?.id ?? null;
}

/** @param {Db} db @param {string} id @param {string} providerMessageId @param {Date} now */
export async function markSent(db, id, providerMessageId, now) {
  await db.query(
    `UPDATE notifications_log SET status = 'sent', provider_message_id = $2, sent_at = $3, error = NULL
      WHERE id = $1`,
    [id, providerMessageId || null, now],
  );
}

/** @param {Db} db @param {string} id @param {string} error */
export async function markFailed(db, id, error) {
  await db.query(`UPDATE notifications_log SET status = 'failed', error = $2 WHERE id = $1`, [
    id,
    error.slice(0, 500),
  ]);
}

/**
 * Message volontairement non envoyé (opposition SMS, RDV annulé entre-temps…), avec la raison.
 * @param {Db} db
 * @param {LogEntry & { reason: string }} e
 */
export async function logSkipped(db, e) {
  await db.query(
    `INSERT INTO notifications_log (appointment_id, client_id, channel, template, recipient,
                                    status, error, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, 'skipped', $6, $7)
     ON CONFLICT (dedupe_key, channel) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [e.appointmentId, e.clientId, e.channel, e.template, e.recipient, e.reason, e.dedupeKey],
  );
}

/**
 * Ce message est-il déjà parti ? (évite d'émettre un nouveau lien d'avis pour rien)
 * @param {Db} db
 * @param {string} dedupeKey
 * @param {'email'|'sms'} channel
 */
export async function wasSent(db, dedupeKey, channel) {
  const { rows } = await db.query(
    `SELECT 1 FROM notifications_log
      WHERE dedupe_key = $1 AND channel = $2 AND status IN ('sent', 'skipped') LIMIT 1`,
    [dedupeKey, channel],
  );
  return rows.length > 0;
}

/**
 * Journal récent (écran admin de la phase 6) : aucune donnée personnelle complète.
 * @param {Db} db
 * @param {number} [limit]
 */
export async function findRecentLog(db, limit = 100) {
  const { rows } = await db.query(
    `SELECT id, appointment_id, channel, template, status, error, attempts, scheduled_at, sent_at
       FROM notifications_log ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
