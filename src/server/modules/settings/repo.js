// @ts-check
/**
 * Réglages éditables (table settings), horaires hebdomadaires, fermetures et congés.
 * Seul fichier SQL du module. Requêtes paramétrées uniquement.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 */

/** Valeurs d'une série de clés (JSON). @param {Db} db @param {string[]} keys */
export async function getSettings(db, keys) {
  const { rows } = await db.query('SELECT key, value FROM settings WHERE key = ANY($1::text[])', [
    keys,
  ]);
  return /** @type {Record<string, any>} */ (Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

/** @param {Db} db @param {string} key @param {unknown} value */
export async function upsertSetting(db, key, value) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

/** Praticiennes actives (les horaires s'appliquent à chacune). @param {Db} db */
export async function findActiveStaffIds(db) {
  const { rows } = await db.query('SELECT id FROM staff WHERE active ORDER BY position, id');
  return rows.map((r) => Number(r.id));
}

/**
 * Horaires hebdomadaires de la première praticienne (référence d'affichage).
 * @param {Db} db
 * @returns {Promise<{ weekday: number, opens: string, closes: string }[]>}
 */
export async function findWeeklyHours(db) {
  const { rows } = await db.query(
    `SELECT weekday, to_char(opens_at, 'HH24:MI') AS opens, to_char(closes_at, 'HH24:MI') AS closes
       FROM opening_hours
      WHERE staff_id = (SELECT id FROM staff WHERE active ORDER BY position, id LIMIT 1)
      ORDER BY weekday, opens_at`,
  );
  return rows.map((r) => ({ weekday: r.weekday, opens: r.opens, closes: r.closes }));
}

/**
 * Remplace les horaires de chaque praticienne active. À appeler dans une transaction.
 * @param {Db} db
 * @param {number[]} staffIds
 * @param {{ weekday: number, opens: string, closes: string }[]} ranges
 */
export async function replaceWeeklyHours(db, staffIds, ranges) {
  await db.query('DELETE FROM opening_hours WHERE staff_id = ANY($1::bigint[])', [staffIds]);
  for (const staffId of staffIds) {
    for (const r of ranges) {
      await db.query(
        `INSERT INTO opening_hours (staff_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4)`,
        [staffId, r.weekday, r.opens, r.closes],
      );
    }
  }
}

/** Fermetures et horaires spéciaux à venir ou en cours. @param {Db} db */
export async function findClosures(db) {
  const { rows } = await db.query(
    `SELECT id, kind, to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
            to_char(opens_at, 'HH24:MI') AS opens, to_char(closes_at, 'HH24:MI') AS closes, reason
       FROM closures WHERE ends_on >= (now() AT TIME ZONE 'Europe/Paris')::date
      ORDER BY starts_on, id`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: /** @type {string} */ (r.kind),
    startsOn: /** @type {string} */ (r.starts_on),
    endsOn: /** @type {string} */ (r.ends_on),
    opens: /** @type {string|null} */ (r.opens),
    closes: /** @type {string|null} */ (r.closes),
    reason: /** @type {string|null} */ (r.reason),
  }));
}

/**
 * @param {Db} db
 * @param {{ kind: 'closed'|'special_hours', startsOn: string, endsOn: string, opens?: string|null, closes?: string|null, reason?: string|null }} c
 */
export async function insertClosure(db, c) {
  const { rows } = await db.query(
    `INSERT INTO closures (staff_id, kind, starts_on, ends_on, opens_at, closes_at, reason)
     VALUES (NULL, $1, $2, $3, $4, $5, $6) RETURNING id`,
    [c.kind, c.startsOn, c.endsOn, c.opens ?? null, c.closes ?? null, c.reason ?? null],
  );
  return Number(rows[0].id);
}

/** @param {Db} db @param {number} id */
export async function deleteClosure(db, id) {
  const { rowCount } = await db.query('DELETE FROM closures WHERE id = $1', [id]);
  return rowCount === 1;
}

/** Rendez-vous actifs déjà posés sur une période (avertissement avant fermeture). @param {Db} db @param {string} from @param {string} to */
export async function countAppointmentsBetween(db, from, to) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM appointments
      WHERE status IN ('pending', 'confirmed')
        AND (starts_at AT TIME ZONE 'Europe/Paris')::date BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  return /** @type {number} */ (rows[0].n);
}
