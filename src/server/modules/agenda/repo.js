// @ts-check
/**
 * Accès aux rendez-vous et blocages pour l'agenda de l'admin. Seul fichier SQL du module.
 * Requêtes paramétrées uniquement. Instants en Date (UTC).
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 *
 * @typedef {object} AgendaAppointment
 * @property {string} id
 * @property {string} status
 * @property {Date} startsAt
 * @property {Date} endsAt         fin d'occupation (tampon compris)
 * @property {number} durationMinutes
 * @property {number} bufferMinutes
 * @property {number|null} price
 * @property {boolean} priceFrom
 * @property {number} staffId
 * @property {string} staffName
 * @property {number} serviceId
 * @property {string} serviceName
 * @property {string} clientId
 * @property {string} firstName
 * @property {string} lastName
 * @property {string|null} phone
 * @property {string} email
 * @property {string} source
 * @property {string|null} internalNotes
 * @property {string|null} clientNotes
 * @property {string|null} hairState
 * @property {boolean} hasPhoto
 * @property {string[]} options
 */

/** @param {any} r @returns {AgendaAppointment} */
const toAppointment = (r) => ({
  id: r.id,
  status: r.status,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  durationMinutes: r.duration_minutes,
  bufferMinutes: r.buffer_minutes,
  price: r.price_cents == null ? null : r.price_cents / 100,
  priceFrom: r.price_from,
  staffId: Number(r.staff_id),
  staffName: r.staff_name,
  serviceId: Number(r.service_id),
  serviceName: r.service_name,
  clientId: r.client_id,
  firstName: r.first_name,
  lastName: r.last_name,
  phone: r.phone,
  email: r.email,
  source: r.source,
  internalNotes: r.internal_notes,
  clientNotes: r.client_notes,
  hairState: r.hair_state,
  hasPhoto: r.has_photo,
  options: r.options ?? [],
});

const SELECT = `
  SELECT a.id, a.status, a.starts_at, a.ends_at, a.duration_minutes, a.buffer_minutes,
         a.price_cents, a.price_from, a.staff_id, st.display_name AS staff_name,
         a.service_id, s.name AS service_name, c.id AS client_id, c.first_name, c.last_name,
         c.phone, c.email, a.source, a.internal_notes, a.client_notes, a.hair_state,
         (a.hair_photo_path IS NOT NULL) AS has_photo,
         (SELECT array_agg(o.label ORDER BY o.id) FROM appointment_options o
           WHERE o.appointment_id = a.id) AS options
    FROM appointments a
    JOIN services s ON s.id = a.service_id
    JOIN staff st ON st.id = a.staff_id
    JOIN clients c ON c.id = a.client_id`;

/**
 * Rendez-vous dont le début est dans [from, to[.
 * @param {Db} db
 * @param {{ from: Date, to: Date, statuses?: string[]|null, clientId?: string|null, limit?: number }} q
 * @returns {Promise<AgendaAppointment[]>}
 */
export async function findAppointments(db, q) {
  const { rows } = await db.query(
    `${SELECT}
      WHERE a.starts_at >= $1 AND a.starts_at < $2
        AND ($3::text[] IS NULL OR a.status = ANY($3::text[]))
        AND ($4::uuid IS NULL OR a.client_id = $4::uuid)
      ORDER BY a.starts_at, a.id
      LIMIT $5`,
    [q.from, q.to, q.statuses ?? null, q.clientId ?? null, q.limit ?? 500],
  );
  return rows.map(toAppointment);
}

/** @param {Db} db @param {string} id @param {{ forUpdate?: boolean }} [options] */
export async function findAppointment(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `${SELECT} WHERE a.id = $1 ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
    [id],
  );
  return rows[0] ? toAppointment(rows[0]) : null;
}

/** Chemin de la photo des cheveux (servie derrière l'authentification). @param {Db} db @param {string} id */
export async function findHairPhotoPath(db, id) {
  const { rows } = await db.query('SELECT hair_photo_path FROM appointments WHERE id = $1', [id]);
  return /** @type {string|null} */ (rows[0]?.hair_photo_path ?? null);
}

/**
 * @typedef {object} BlockRow
 * @property {number} id
 * @property {number} staffId
 * @property {Date} startsAt
 * @property {Date} endsAt
 * @property {string|null} reason
 */

/** Blocages qui touchent la période. @param {Db} db @param {Date} from @param {Date} to @returns {Promise<BlockRow[]>} */
export async function findBlocks(db, from, to) {
  const { rows } = await db.query(
    `SELECT id, staff_id, starts_at, ends_at, reason FROM blocks
      WHERE starts_at < $2 AND ends_at > $1 ORDER BY starts_at`,
    [from, to],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    staffId: Number(r.staff_id),
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    reason: r.reason,
  }));
}

/** Un blocage chevauche-t-il [from, to[ pour cette praticienne ? @param {Db} db @param {number} staffId @param {Date} from @param {Date} to */
export async function blockOverlaps(db, staffId, from, to) {
  const { rows } = await db.query(
    `SELECT 1 FROM blocks WHERE staff_id = $1 AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
    [staffId, from, to],
  );
  return rows.length > 0;
}

/** Un rendez-vous actif chevauche-t-il [from, to[ ? (pour refuser un blocage) @param {Db} db @param {number} staffId @param {Date} from @param {Date} to */
export async function appointmentOverlaps(db, staffId, from, to) {
  const { rows } = await db.query(
    `SELECT 1 FROM appointments
      WHERE staff_id = $1 AND status IN ('pending', 'confirmed') AND starts_at < $3 AND ends_at > $2
      LIMIT 1`,
    [staffId, from, to],
  );
  return rows.length > 0;
}

/**
 * @param {Db} db
 * @param {{ staffId: number, startsAt: Date, endsAt: Date, reason: string|null, userId: string }} b
 */
export async function insertBlock(db, b) {
  const { rows } = await db.query(
    `INSERT INTO blocks (staff_id, starts_at, ends_at, reason, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [b.staffId, b.startsAt, b.endsAt, b.reason, b.userId],
  );
  return Number(rows[0].id);
}

/** @param {Db} db @param {number} id */
export async function deleteBlock(db, id) {
  const { rowCount } = await db.query('DELETE FROM blocks WHERE id = $1', [id]);
  return rowCount === 1;
}

/** Praticiennes actives. @param {Db} db */
export async function findActiveStaff(db) {
  const { rows } = await db.query(
    'SELECT id, display_name FROM staff WHERE active ORDER BY position, id',
  );
  return rows.map((r) => ({ id: Number(r.id), name: /** @type {string} */ (r.display_name) }));
}

/**
 * Statut : applique la transition, et annule proprement (date, motif).
 * @param {Db} db
 * @param {{ id: string, status: string, reason?: string|null }} s
 */
export async function updateStatus(db, s) {
  const cancelled = s.status.startsWith('cancelled');
  await db.query(
    `UPDATE appointments
        SET status = $2,
            cancelled_at = CASE WHEN $3 THEN now() ELSE NULL END,
            cancellation_reason = CASE WHEN $3 THEN $4 ELSE NULL END
      WHERE id = $1`,
    [s.id, s.status, cancelled, s.reason ?? null],
  );
}

/** @param {Db} db @param {string} id @param {string|null} notes */
export async function updateInternalNotes(db, id, notes) {
  await db.query('UPDATE appointments SET internal_notes = $2 WHERE id = $1', [id, notes]);
}

/**
 * Déplace un RDV (nouvelle heure, même durée) et renouvelle le jeton « Gérer mon RDV »
 * (le jeton en clair n'est pas conservé : on en émet un nouveau pour la notification).
 * 23P01 si le créneau est pris.
 * @param {Db} db
 * @param {{ id: string, staffId: number, startsAt: Date, endsAt: Date, tokenHash: Buffer, tokenExpiresAt: Date }} m
 */
export async function moveAppointment(db, m) {
  await db.query(
    `UPDATE appointments
        SET staff_id = $2, starts_at = $3, ends_at = $4,
            manage_token_hash = $5, manage_token_expires_at = $6
      WHERE id = $1 AND status IN ('pending', 'confirmed')`,
    [m.id, m.staffId, m.startsAt, m.endsAt, m.tokenHash, m.tokenExpiresAt],
  );
}

/** Rotation du jeton sans déplacement (RDV saisi par le salon, notification de confirmation). @param {Db} db @param {string} id @param {Buffer} hash @param {Date} expiresAt */
export async function setManageToken(db, id, hash, expiresAt) {
  await db.query(
    'UPDATE appointments SET manage_token_hash = $2, manage_token_expires_at = $3 WHERE id = $1',
    [id, hash, expiresAt],
  );
}

/** Marque le RDV comme saisi par le salon. @param {Db} db @param {string} id */
export async function markAdminSource(db, id) {
  await db.query(`UPDATE appointments SET source = 'admin' WHERE id = $1`, [id]);
}

/**
 * Statistiques du tableau de bord.
 * @param {Db} db
 * @param {{ weekFrom: Date, weekTo: Date, monthFrom: Date, monthTo: Date, noShowSince: Date }} q
 */
export async function findDashboardStats(db, q) {
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*)::int FROM appointments
         WHERE status IN ('pending', 'confirmed', 'completed') AND starts_at >= $1 AND starts_at < $2) AS week_count,
       (SELECT COALESCE(sum(price_cents), 0)::bigint FROM appointments
         WHERE status IN ('confirmed', 'completed') AND starts_at >= $3 AND starts_at < $4) AS month_cents,
       (SELECT count(*)::int FROM appointments
         WHERE status IN ('confirmed', 'completed') AND starts_at >= $3 AND starts_at < $4 AND price_cents IS NULL) AS month_unpriced,
       (SELECT count(*)::int FROM appointments WHERE status = 'no_show' AND starts_at >= $5) AS no_show,
       (SELECT count(*)::int FROM appointments
         WHERE status IN ('completed', 'no_show') AND starts_at >= $5) AS finished,
       (SELECT count(*)::int FROM reviews WHERE status = 'pending') AS reviews_pending,
       (SELECT count(*)::int FROM appointments WHERE status = 'pending' AND starts_at >= now()) AS to_validate`,
    [q.weekFrom, q.weekTo, q.monthFrom, q.monthTo, q.noShowSince],
  );
  const r = rows[0];
  return {
    weekCount: /** @type {number} */ (r.week_count),
    monthRevenue: Number(r.month_cents) / 100,
    monthUnpriced: /** @type {number} */ (r.month_unpriced),
    noShow: /** @type {number} */ (r.no_show),
    finished: /** @type {number} */ (r.finished),
    reviewsPending: /** @type {number} */ (r.reviews_pending),
    toValidate: /** @type {number} */ (r.to_validate),
  };
}
