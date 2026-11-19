// @ts-check
/**
 * Accès admin au catalogue : catégories, prestations, options, méthodes, ordre.
 * Seul fichier SQL de cette partie du module. Requêtes paramétrées uniquement.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 */

/** Tables dont l'ordre est modifiable (liste blanche : jamais de nom venant de l'extérieur). */
const ORDERED_TABLES = /** @type {const} */ ({
  services: 'services',
  categories: 'categories',
  options: 'service_options',
  methods: 'methods',
  gallery: 'gallery_items',
});
/** @typedef {keyof typeof ORDERED_TABLES} OrderedTable */

/**
 * Applique un ordre : la position de chaque identifiant devient son rang dans la liste.
 * @param {Db} db
 * @param {OrderedTable} table
 * @param {number[]} ids
 */
export async function reorder(db, table, ids) {
  const name = ORDERED_TABLES[table];
  await db.query(
    `UPDATE ${name} t SET position = v.rank::integer
       FROM unnest($1::bigint[]) WITH ORDINALITY AS v(id, rank)
      WHERE t.id = v.id`,
    [ids],
  );
}

/**
 * Identifiants d'un groupe dans l'ordre d'affichage (pour monter / descendre un élément).
 * @param {Db} db
 * @param {OrderedTable} table
 * @param {{ scopeColumn?: 'category_id'|'service_id', scopeValue?: number|null }} [scope]
 * @returns {Promise<number[]>}
 */
export async function orderedIds(db, table, { scopeColumn, scopeValue } = {}) {
  const name = ORDERED_TABLES[table];
  const where =
    scopeColumn === 'category_id'
      ? 'WHERE category_id IS NOT DISTINCT FROM $1::bigint'
      : scopeColumn === 'service_id'
        ? 'WHERE service_id = $1::bigint'
        : 'WHERE $1::bigint IS NULL OR true';
  const { rows } = await db.query(`SELECT id FROM ${name} ${where} ORDER BY position, id`, [
    scopeValue ?? null,
  ]);
  return rows.map((r) => Number(r.id));
}

/** Catégorie et service d'un élément (portée du tri). @param {Db} db @param {number} id */
export async function findServiceScope(db, id) {
  const { rows } = await db.query('SELECT category_id FROM services WHERE id = $1', [id]);
  return rows[0]
    ? { categoryId: rows[0].category_id == null ? null : Number(rows[0].category_id) }
    : null;
}

/** @param {Db} db @param {number} id */
export async function findOptionScope(db, id) {
  const { rows } = await db.query('SELECT service_id FROM service_options WHERE id = $1', [id]);
  return rows[0] ? { serviceId: Number(rows[0].service_id) } : null;
}

// ─── Catégories ──────────────────────────────────────────────────────────────

/** @param {Db} db */
export async function findAdminCatalog(db) {
  const [categories, services] = await Promise.all([
    db.query(`SELECT id, slug, name, active, position FROM categories ORDER BY position, id`),
    db.query(
      `SELECT s.id, s.slug, s.name, s.category_id, s.active, s.bookable_online, s.on_quote,
              s.price_cents, s.price_from, s.duration_min_minutes, s.duration_max_minutes,
              s.is_placeholder, s.position,
              (SELECT count(*)::int FROM service_options o WHERE o.service_id = s.id) AS option_count
         FROM services s ORDER BY s.position, s.id`,
    ),
  ]);
  return {
    categories: categories.rows.map((c) => ({
      id: Number(c.id),
      slug: /** @type {string} */ (c.slug),
      name: /** @type {string} */ (c.name),
      active: /** @type {boolean} */ (c.active),
    })),
    services: services.rows.map((s) => ({
      id: Number(s.id),
      slug: /** @type {string} */ (s.slug),
      name: /** @type {string} */ (s.name),
      categoryId: s.category_id == null ? null : Number(s.category_id),
      active: /** @type {boolean} */ (s.active),
      bookableOnline: /** @type {boolean} */ (s.bookable_online),
      onQuote: /** @type {boolean} */ (s.on_quote),
      price: s.price_cents == null ? null : s.price_cents / 100,
      priceFrom: /** @type {boolean} */ (s.price_from),
      durationMin: /** @type {number} */ (s.duration_min_minutes),
      durationMax: /** @type {number} */ (s.duration_max_minutes),
      isPlaceholder: /** @type {boolean} */ (s.is_placeholder),
      optionCount: /** @type {number} */ (s.option_count),
    })),
  };
}

/** @param {Db} db @param {number} id */
export async function findCategory(db, id) {
  const { rows } = await db.query(
    `SELECT id, slug, name, headline, summary, intro, media_label, active FROM categories WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  return r
    ? {
        id: Number(r.id),
        slug: /** @type {string} */ (r.slug),
        name: /** @type {string} */ (r.name),
        headline: /** @type {string} */ (r.headline),
        summary: /** @type {string} */ (r.summary),
        intro: /** @type {string} */ (r.intro),
        mediaLabel: /** @type {string} */ (r.media_label),
        active: /** @type {boolean} */ (r.active),
      }
    : null;
}

/**
 * @typedef {object} CategoryInput
 * @property {string} slug @property {string} name @property {string} headline
 * @property {string} summary @property {string} intro @property {string} mediaLabel @property {boolean} active
 */

/** @param {Db} db @param {CategoryInput} c */
export async function insertCategory(db, c) {
  const { rows } = await db.query(
    `INSERT INTO categories (slug, name, headline, summary, intro, media_label, active, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(max(position), 0) + 1 FROM categories))
     RETURNING id`,
    [c.slug, c.name, c.headline, c.summary, c.intro, c.mediaLabel, c.active],
  );
  return Number(rows[0].id);
}

/** @param {Db} db @param {number} id @param {CategoryInput} c */
export async function updateCategory(db, id, c) {
  await db.query(
    `UPDATE categories SET slug = $2, name = $3, headline = $4, summary = $5, intro = $6,
            media_label = $7, active = $8 WHERE id = $1`,
    [id, c.slug, c.name, c.headline, c.summary, c.intro, c.mediaLabel, c.active],
  );
}

/** @param {Db} db @param {string} slug @param {number|null} [exceptId] */
export async function categorySlugTaken(db, slug, exceptId = null) {
  const { rows } = await db.query(
    'SELECT 1 FROM categories WHERE slug = $1 AND ($2::bigint IS NULL OR id <> $2) LIMIT 1',
    [slug, exceptId],
  );
  return rows.length > 0;
}

// ─── Prestations ─────────────────────────────────────────────────────────────

/** @param {Db} db @param {number} id */
export async function findService(db, id) {
  const { rows } = await db.query(
    `SELECT id, slug, category_id, name, summary, body, duration_min_minutes,
            duration_max_minutes, buffer_after_minutes, price_cents, price_from, on_quote,
            deposit_cents, active, bookable_online, allergy_test_required, featured, is_placeholder
       FROM services WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  const options = await db.query(
    `SELECT id, label, price_cents, extra_minutes, active FROM service_options
      WHERE service_id = $1 ORDER BY position, id`,
    [id],
  );
  return {
    id: Number(r.id),
    slug: /** @type {string} */ (r.slug),
    categoryId: r.category_id == null ? null : Number(r.category_id),
    name: /** @type {string} */ (r.name),
    summary: /** @type {string} */ (r.summary),
    body: /** @type {{ title: string|null, paragraphs: string[] }[]} */ (r.body),
    durationMin: /** @type {number} */ (r.duration_min_minutes),
    durationMax: /** @type {number} */ (r.duration_max_minutes),
    bufferAfter: /** @type {number} */ (r.buffer_after_minutes),
    price: r.price_cents == null ? null : r.price_cents / 100,
    priceFrom: /** @type {boolean} */ (r.price_from),
    onQuote: /** @type {boolean} */ (r.on_quote),
    deposit: r.deposit_cents == null ? null : r.deposit_cents / 100,
    active: /** @type {boolean} */ (r.active),
    bookableOnline: /** @type {boolean} */ (r.bookable_online),
    allergyTest: /** @type {boolean} */ (r.allergy_test_required),
    featured: /** @type {boolean} */ (r.featured),
    isPlaceholder: /** @type {boolean} */ (r.is_placeholder),
    options: options.rows.map((o) => ({
      id: Number(o.id),
      label: /** @type {string} */ (o.label),
      price: o.price_cents / 100,
      extraMinutes: /** @type {number} */ (o.extra_minutes),
      active: /** @type {boolean} */ (o.active),
    })),
  };
}

/**
 * @typedef {object} ServiceInput
 * @property {string} slug @property {number|null} categoryId @property {string} name @property {string} summary
 * @property {object[]} body @property {number} durationMin @property {number} durationMax @property {number} bufferAfter
 * @property {number|null} priceCents @property {boolean} priceFrom @property {boolean} onQuote
 * @property {boolean} active @property {boolean} bookableOnline @property {boolean} allergyTest
 * @property {boolean} featured @property {boolean} isPlaceholder
 */

/** @param {Db} db @param {ServiceInput} s */
export async function insertService(db, s) {
  const { rows } = await db.query(
    `INSERT INTO services (slug, category_id, name, summary, body, duration_min_minutes,
        duration_max_minutes, buffer_after_minutes, price_cents, price_from, on_quote, active,
        bookable_online, allergy_test_required, featured, is_placeholder, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             (SELECT COALESCE(max(position), 0) + 1 FROM services))
     RETURNING id`,
    [
      s.slug,
      s.categoryId,
      s.name,
      s.summary,
      JSON.stringify(s.body),
      s.durationMin,
      s.durationMax,
      s.bufferAfter,
      s.priceCents,
      s.priceFrom,
      s.onQuote,
      s.active,
      s.bookableOnline,
      s.allergyTest,
      s.featured,
      s.isPlaceholder,
    ],
  );
  return Number(rows[0].id);
}

/** @param {Db} db @param {number} id @param {ServiceInput} s */
export async function updateService(db, id, s) {
  await db.query(
    `UPDATE services SET slug = $2, category_id = $3, name = $4, summary = $5, body = $6,
            duration_min_minutes = $7, duration_max_minutes = $8, buffer_after_minutes = $9,
            price_cents = $10, price_from = $11, on_quote = $12, active = $13,
            bookable_online = $14, allergy_test_required = $15, featured = $16, is_placeholder = $17
      WHERE id = $1`,
    [
      id,
      s.slug,
      s.categoryId,
      s.name,
      s.summary,
      JSON.stringify(s.body),
      s.durationMin,
      s.durationMax,
      s.bufferAfter,
      s.priceCents,
      s.priceFrom,
      s.onQuote,
      s.active,
      s.bookableOnline,
      s.allergyTest,
      s.featured,
      s.isPlaceholder,
    ],
  );
}

/** Activer / désactiver rapidement. @param {Db} db @param {number} id @param {boolean} active */
export async function setServiceActive(db, id, active) {
  const { rowCount } = await db.query('UPDATE services SET active = $2 WHERE id = $1', [
    id,
    active,
  ]);
  return rowCount === 1;
}

/** @param {Db} db @param {string} slug @param {number|null} [exceptId] */
export async function serviceSlugTaken(db, slug, exceptId = null) {
  const { rows } = await db.query(
    'SELECT 1 FROM services WHERE slug = $1 AND ($2::bigint IS NULL OR id <> $2) LIMIT 1',
    [slug, exceptId],
  );
  return rows.length > 0;
}

// ─── Options ─────────────────────────────────────────────────────────────────

/** @param {Db} db @param {number} serviceId @param {{ label: string, priceCents: number, extraMinutes: number }} o */
export async function insertOption(db, serviceId, o) {
  const { rows } = await db.query(
    `INSERT INTO service_options (service_id, label, price_cents, extra_minutes, is_placeholder, position)
     VALUES ($1, $2, $3, $4, false,
             (SELECT COALESCE(max(position), 0) + 1 FROM service_options WHERE service_id = $1))
     RETURNING id`,
    [serviceId, o.label, o.priceCents, o.extraMinutes],
  );
  return Number(rows[0].id);
}

/** @param {Db} db @param {number} id @param {{ label: string, priceCents: number, extraMinutes: number, active: boolean }} o */
export async function updateOption(db, id, o) {
  await db.query(
    `UPDATE service_options SET label = $2, price_cents = $3, extra_minutes = $4, active = $5,
            is_placeholder = false WHERE id = $1`,
    [id, o.label, o.priceCents, o.extraMinutes, o.active],
  );
}

/** Une option déjà réservée est conservée dans les RDV (libellé figé) : suppression sûre. @param {Db} db @param {number} id */
export async function deleteOption(db, id) {
  const { rows } = await db.query(
    'DELETE FROM service_options WHERE id = $1 RETURNING service_id',
    [id],
  );
  return rows[0] ? Number(rows[0].service_id) : null;
}

// ─── Méthodes ────────────────────────────────────────────────────────────────

/** @param {Db} db */
export async function findAdminMethods(db) {
  const { rows } = await db.query(
    `SELECT id, slug, name, family, featured FROM methods ORDER BY position, id`,
  );
  return rows.map((m) => ({
    id: Number(m.id),
    slug: /** @type {string} */ (m.slug),
    name: /** @type {string} */ (m.name),
    family: /** @type {string} */ (m.family),
    featured: /** @type {boolean} */ (m.featured),
  }));
}

/** @param {Db} db @param {number} id */
export async function findMethod(db, id) {
  const { rows } = await db.query(
    `SELECT id, slug, name, aka, family, featured, summary, principle, ideal_for,
            duration_label, maturation, maintenance, pros, watchouts
       FROM methods WHERE id = $1`,
    [id],
  );
  const m = rows[0];
  return m
    ? {
        id: Number(m.id),
        slug: /** @type {string} */ (m.slug),
        name: /** @type {string} */ (m.name),
        aka: /** @type {string} */ (m.aka),
        family: /** @type {string} */ (m.family),
        featured: /** @type {boolean} */ (m.featured),
        summary: /** @type {string} */ (m.summary),
        principle: /** @type {string} */ (m.principle),
        idealFor: /** @type {string} */ (m.ideal_for),
        durationLabel: /** @type {string} */ (m.duration_label),
        maturation: /** @type {string} */ (m.maturation),
        maintenance: /** @type {string} */ (m.maintenance),
        pros: /** @type {string[]} */ (m.pros),
        watchouts: /** @type {string[]} */ (m.watchouts),
      }
    : null;
}

/**
 * @typedef {object} MethodInput
 * @property {string} slug @property {string} name @property {string} aka @property {string} family
 * @property {boolean} featured @property {string} summary @property {string} principle
 * @property {string} idealFor @property {string} durationLabel @property {string} maturation
 * @property {string} maintenance @property {string[]} pros @property {string[]} watchouts
 */

/** @param {Db} db @param {MethodInput} m */
export async function insertMethod(db, m) {
  const { rows } = await db.query(
    `INSERT INTO methods (slug, name, aka, family, featured, summary, principle, ideal_for,
        duration_label, maturation, maintenance, pros, watchouts, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             (SELECT COALESCE(max(position), 0) + 1 FROM methods))
     RETURNING id`,
    [
      m.slug,
      m.name,
      m.aka,
      m.family,
      m.featured,
      m.summary,
      m.principle,
      m.idealFor,
      m.durationLabel,
      m.maturation,
      m.maintenance,
      m.pros,
      m.watchouts,
    ],
  );
  return Number(rows[0].id);
}

/** @param {Db} db @param {number} id @param {MethodInput} m */
export async function updateMethod(db, id, m) {
  await db.query(
    `UPDATE methods SET slug = $2, name = $3, aka = $4, family = $5, featured = $6, summary = $7,
            principle = $8, ideal_for = $9, duration_label = $10, maturation = $11,
            maintenance = $12, pros = $13, watchouts = $14
      WHERE id = $1`,
    [
      id,
      m.slug,
      m.name,
      m.aka,
      m.family,
      m.featured,
      m.summary,
      m.principle,
      m.idealFor,
      m.durationLabel,
      m.maturation,
      m.maintenance,
      m.pros,
      m.watchouts,
    ],
  );
}

/** @param {Db} db @param {string} slug @param {number|null} [exceptId] */
export async function methodSlugTaken(db, slug, exceptId = null) {
  const { rows } = await db.query(
    'SELECT 1 FROM methods WHERE slug = $1 AND ($2::bigint IS NULL OR id <> $2) LIMIT 1',
    [slug, exceptId],
  );
  return rows.length > 0;
}
