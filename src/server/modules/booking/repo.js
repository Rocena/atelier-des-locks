// @ts-check
/**
 * Accès aux données de la réservation. Seul fichier du module qui contient du SQL.
 * Requêtes paramétrées uniquement. Instants en Date (UTC), heures locales en « HH:MM ».
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 */

/** Statuts qui occupent le planning (identiques à la contrainte appointments_no_overlap). */
export const BUSY_STATUSES = ['pending', 'confirmed', 'completed', 'no_show'];

/**
 * @typedef {object} BookingSettings
 * @property {number} minNoticeHours
 * @property {number} horizonDays
 * @property {number} cancellationHours
 * @property {boolean} manualValidation
 * @property {number} stepMinutes
 * @property {number} longServiceMinutes
 * @property {string} policyText
 * @property {string} timeZone
 */

/** @param {Db} db @returns {Promise<BookingSettings>} */
export async function findBookingSettings(db) {
  const { rows } = await db.query(
    `SELECT key, value FROM settings WHERE key LIKE 'booking.%' OR key = 'salon.timezone'`,
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  /** @param {string} key @param {any} fallback */
  const get = (key, fallback) => map.get(key) ?? fallback;
  return {
    minNoticeHours: Number(get('booking.min_notice_hours', 24)),
    horizonDays: Number(get('booking.horizon_days', 60)),
    cancellationHours: Number(get('booking.cancellation_hours', 48)),
    manualValidation: get('booking.manual_validation', false) === true,
    stepMinutes: Number(get('booking.slot_step_minutes', 30)),
    longServiceMinutes: Number(get('booking.long_service_minutes', 240)),
    policyText: String(get('booking.policy_text', '')),
    timeZone: String(get('salon.timezone', 'Europe/Paris')),
  };
}

/**
 * @typedef {object} BookableOption
 * @property {number} id
 * @property {string} label
 * @property {number} price        euros
 * @property {number} extraMinutes
 *
 * @typedef {object} BookableService
 * @property {number} id
 * @property {string} slug
 * @property {string} name
 * @property {string|null} category
 * @property {string} summary
 * @property {number} durationMin
 * @property {number} durationMax
 * @property {number} bufferAfter
 * @property {number|null} price
 * @property {boolean} priceFrom
 * @property {boolean} onQuote
 * @property {boolean} bookableOnline
 * @property {boolean} allergyTest
 * @property {BookableOption[]} options
 */

/**
 * Prestations actives (réservables en ligne ou non) avec leurs options identifiées.
 * @param {Db} db
 * @returns {Promise<BookableService[]>}
 */
export async function findServicesForBooking(db) {
  const [services, options] = await Promise.all([
    db.query(
      `SELECT s.id, s.slug, s.name, c.slug AS category, s.summary,
              s.duration_min_minutes, s.duration_max_minutes, s.buffer_after_minutes,
              s.price_cents, s.price_from, s.on_quote, s.bookable_online, s.allergy_test_required
         FROM services s LEFT JOIN categories c ON c.id = s.category_id
        WHERE s.active
        ORDER BY c.position NULLS LAST, s.position, s.id`,
    ),
    db.query(
      `SELECT o.id, o.service_id, o.label, o.price_cents, o.extra_minutes
         FROM service_options o JOIN services s ON s.id = o.service_id
        WHERE o.active AND s.active
        ORDER BY o.position, o.id`,
    ),
  ]);
  return services.rows.map((s) => ({
    id: Number(s.id),
    slug: s.slug,
    name: s.name,
    category: s.category,
    summary: s.summary,
    durationMin: s.duration_min_minutes,
    durationMax: s.duration_max_minutes,
    bufferAfter: s.buffer_after_minutes,
    price: s.price_cents == null ? null : s.price_cents / 100,
    priceFrom: s.price_from,
    onQuote: s.on_quote,
    bookableOnline: s.bookable_online,
    allergyTest: s.allergy_test_required,
    options: options.rows
      .filter((o) => String(o.service_id) === String(s.id))
      .map((o) => ({
        id: Number(o.id),
        label: o.label,
        price: o.price_cents / 100,
        extraMinutes: o.extra_minutes,
      })),
  }));
}

/**
 * Praticiennes actives qui réalisent une prestation.
 * @param {Db} db
 * @param {number} serviceId
 * @returns {Promise<number[]>}
 */
export async function findStaffForService(db, serviceId) {
  const { rows } = await db.query(
    `SELECT st.id FROM staff st JOIN staff_services ss ON ss.staff_id = st.id
      WHERE ss.service_id = $1 AND st.active ORDER BY st.position, st.id`,
    [serviceId],
  );
  return rows.map((r) => Number(r.id));
}

/**
 * Données de planning nécessaires au moteur, sur une période.
 * @param {Db} db
 * @param {{ staffIds: number[], fromDate: string, toDate: string, fromInstant: Date, toInstant: Date, excludeAppointmentId?: string }} q
 */
export async function findPlanning(db, q) {
  // Requêtes en série : la fonction peut recevoir une connexion de transaction (PoolClient),
  // sur laquelle des requêtes parallèles sont interdites.
  const hours = await db.query(
    `SELECT staff_id, weekday, to_char(opens_at, 'HH24:MI') AS opens,
              to_char(closes_at, 'HH24:MI') AS closes
         FROM opening_hours WHERE staff_id = ANY($1::bigint[])`,
    [q.staffIds],
  );
  const closures = await db.query(
    `SELECT staff_id, kind, to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
              to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
              to_char(opens_at, 'HH24:MI') AS opens, to_char(closes_at, 'HH24:MI') AS closes
         FROM closures
        WHERE (staff_id IS NULL OR staff_id = ANY($1::bigint[]))
          AND starts_on <= $3::date AND ends_on >= $2::date`,
    [q.staffIds, q.fromDate, q.toDate],
  );
  const appointments = await db.query(
    `SELECT staff_id, starts_at, ends_at FROM appointments
        WHERE staff_id = ANY($1::bigint[]) AND status = ANY($4::text[])
          AND starts_at < $3 AND ends_at > $2
          AND ($5::uuid IS NULL OR id <> $5::uuid)`,
    [q.staffIds, q.fromInstant, q.toInstant, BUSY_STATUSES, q.excludeAppointmentId ?? null],
  );
  const blocks = await db.query(
    `SELECT staff_id, starts_at, ends_at FROM blocks
        WHERE staff_id = ANY($1::bigint[]) AND starts_at < $3 AND ends_at > $2`,
    [q.staffIds, q.fromInstant, q.toInstant],
  );
  return {
    weeklyHours: hours.rows.map((h) => ({
      staffId: Number(h.staff_id),
      weekday: h.weekday,
      opens: h.opens,
      // Une plage qui finit à minuit est stockée 24:00:00 (to_char donne « 24:00 »).
      closes: h.closes,
    })),
    closures: closures.rows.map((c) => ({
      staffId: c.staff_id == null ? null : Number(c.staff_id),
      kind: c.kind,
      startsOn: c.starts_on,
      endsOn: c.ends_on,
      opens: c.opens ?? undefined,
      closes: c.closes ?? undefined,
    })),
    busy: [...appointments.rows, ...blocks.rows].map((b) => ({
      staffId: Number(b.staff_id),
      startsAt: b.starts_at,
      endsAt: b.ends_at,
    })),
  };
}

/**
 * Crée ou met à jour la fiche cliente (clé : email). La newsletter n'est jamais décochée ici :
 * seule une inscription explicite l'active, avec sa date (preuve du consentement).
 * @param {Db} db
 * @param {{ firstName: string, lastName: string, email: string, phone: string, smsReminders: boolean, newsletter: boolean }} c
 * @returns {Promise<string>} identifiant de la cliente
 */
export async function upsertClient(db, c) {
  const { rows } = await db.query(
    `INSERT INTO clients (first_name, last_name, email, phone, sms_reminders,
                          newsletter_opt_in, newsletter_opt_in_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 THEN now() END)
     ON CONFLICT (email) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       phone = EXCLUDED.phone,
       sms_reminders = EXCLUDED.sms_reminders,
       newsletter_opt_in = clients.newsletter_opt_in OR EXCLUDED.newsletter_opt_in,
       newsletter_opt_in_at = COALESCE(clients.newsletter_opt_in_at, EXCLUDED.newsletter_opt_in_at),
       anonymized_at = NULL
     RETURNING id`,
    [c.firstName, c.lastName, c.email, c.phone, c.smsReminders, c.newsletter],
  );
  return rows[0].id;
}

/**
 * Insère un rendez-vous et ses options. Lève l'erreur PostgreSQL 23P01 si le créneau est pris
 * (contrainte d'exclusion) : l'appelant la traite dans une transaction (SAVEPOINT).
 * @param {Db} db
 * @param {object} a
 * @param {string} a.clientId
 * @param {number} a.staffId
 * @param {number} a.serviceId
 * @param {'pending'|'confirmed'} a.status
 * @param {Date} a.startsAt
 * @param {Date} a.endsAt
 * @param {number} a.durationMinutes
 * @param {number} a.bufferMinutes
 * @param {number|null} a.price   euros
 * @param {boolean} a.priceFrom
 * @param {string} a.hairState
 * @param {string} a.notes
 * @param {string|null} a.photoPath
 * @param {Buffer} a.tokenHash
 * @param {Date} a.tokenExpiresAt
 * @param {{ id: number, label: string, price: number, extraMinutes: number }[]} a.options
 * @returns {Promise<string>} identifiant du rendez-vous
 */
export async function insertAppointment(db, a) {
  const { rows } = await db.query(
    `INSERT INTO appointments (client_id, staff_id, service_id, status, starts_at, ends_at,
        duration_minutes, buffer_minutes, price_cents, price_from, hair_state, client_notes,
        hair_photo_path, policy_accepted_at, manage_token_hash, manage_token_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14, $15)
     RETURNING id`,
    [
      a.clientId,
      a.staffId,
      a.serviceId,
      a.status,
      a.startsAt,
      a.endsAt,
      a.durationMinutes,
      a.bufferMinutes,
      a.price == null ? null : Math.round(a.price * 100),
      a.priceFrom,
      a.hairState,
      a.notes || null,
      a.photoPath,
      a.tokenHash,
      a.tokenExpiresAt,
    ],
  );
  const id = rows[0].id;
  for (const o of a.options) {
    await db.query(
      `INSERT INTO appointment_options (appointment_id, option_id, label, price_cents, extra_minutes)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, o.id, o.label, Math.round(o.price * 100), o.extraMinutes],
    );
  }
  return id;
}

/**
 * @typedef {object} ManagedAppointment
 * @property {string} id
 * @property {string} status
 * @property {Date} startsAt
 * @property {Date} endsAt
 * @property {number} durationMinutes
 * @property {number} bufferMinutes
 * @property {number|null} price
 * @property {boolean} priceFrom
 * @property {number} staffId
 * @property {string} staffName
 * @property {number} serviceId
 * @property {string} serviceSlug
 * @property {string} serviceName
 * @property {string} firstName
 * @property {string[]} options
 * @property {Date} updatedAt
 */

/** @param {any} r @returns {ManagedAppointment} */
const toManaged = (r) => ({
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
  serviceSlug: r.service_slug,
  serviceName: r.service_name,
  firstName: r.first_name,
  options: r.options ?? [],
  updatedAt: r.updated_at,
});

const MANAGED_SELECT = `
  SELECT a.id, a.status, a.starts_at, a.ends_at, a.duration_minutes, a.buffer_minutes,
         a.price_cents, a.price_from, a.staff_id, st.display_name AS staff_name,
         a.service_id, s.slug AS service_slug, s.name AS service_name, c.first_name, a.updated_at,
         (SELECT array_agg(o.label ORDER BY o.id) FROM appointment_options o
           WHERE o.appointment_id = a.id) AS options
    FROM appointments a
    JOIN services s ON s.id = a.service_id
    JOIN staff st ON st.id = a.staff_id
    JOIN clients c ON c.id = a.client_id`;

/**
 * Rendez-vous désigné par l'empreinte d'un jeton encore valide.
 * @param {Db} db
 * @param {Buffer} tokenHash
 * @param {{ forUpdate?: boolean }} [options]  verrouille la ligne (dans une transaction)
 * @returns {Promise<ManagedAppointment|null>}
 */
export async function findAppointmentByToken(db, tokenHash, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `${MANAGED_SELECT}
      WHERE a.manage_token_hash = $1 AND a.manage_token_expires_at > now()
      ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
    [tokenHash],
  );
  return rows[0] ? toManaged(rows[0]) : null;
}

/** @param {Db} db @param {string} id */
export async function findAppointmentById(db, id) {
  const { rows } = await db.query(`${MANAGED_SELECT} WHERE a.id = $1`, [id]);
  return rows[0] ? toManaged(rows[0]) : null;
}

/**
 * Déplace un rendez-vous (même durée). 23P01 si le nouveau créneau est pris entre-temps.
 * Le lien « Gérer mon RDV » est prolongé en conséquence.
 * @param {Db} db
 * @param {{ id: string, staffId: number, startsAt: Date, endsAt: Date, tokenExpiresAt: Date }} m
 */
export async function moveAppointment(db, m) {
  await db.query(
    `UPDATE appointments SET staff_id = $2, starts_at = $3, ends_at = $4, manage_token_expires_at = $5
      WHERE id = $1 AND status IN ('pending', 'confirmed')`,
    [m.id, m.staffId, m.startsAt, m.endsAt, m.tokenExpiresAt],
  );
}

/**
 * Annulation par la cliente : libère le créneau (la contrainte ignore les RDV annulés).
 * @param {Db} db
 * @param {{ id: string, reason: string }} c
 */
export async function cancelAppointment(db, c) {
  await db.query(
    `UPDATE appointments
        SET status = 'cancelled_by_client', cancelled_at = now(), cancellation_reason = $2
      WHERE id = $1 AND status IN ('pending', 'confirmed')`,
    [c.id, c.reason || null],
  );
}

/**
 * Rendez-vous du flux iCal privé : 30 jours en arrière, tout l'avenir. Données minimales.
 * @param {Db} db
 * @param {Date} since
 */
export async function findFeedAppointments(db, since) {
  const { rows } = await db.query(
    `SELECT a.id, a.status, a.starts_at, a.ends_at, a.buffer_minutes, a.updated_at,
            s.name AS service_name, c.first_name, left(c.last_name, 1) AS last_initial,
            st.display_name AS staff_name,
            (SELECT array_agg(o.label ORDER BY o.id) FROM appointment_options o
              WHERE o.appointment_id = a.id) AS options
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN clients c ON c.id = a.client_id
       JOIN staff st ON st.id = a.staff_id
      WHERE a.starts_at >= $1 AND a.status IN ('pending', 'confirmed', 'completed')
      ORDER BY a.starts_at`,
    [since],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    bufferMinutes: r.buffer_minutes,
    updatedAt: r.updated_at,
    serviceName: r.service_name,
    clientLabel: `${r.first_name} ${r.last_initial}.`,
    staffName: r.staff_name,
    options: /** @type {string[]} */ (r.options ?? []),
  }));
}

/** Nombre de praticiennes actives (pour masquer le choix quand il n'y en a qu'une). @param {Db} db */
export async function countActiveStaff(db) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM staff WHERE active');
  return rows[0].n;
}
