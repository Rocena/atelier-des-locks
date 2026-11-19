// @ts-check
/**
 * Accès aux données du catalogue (catégories, prestations, méthodes, étapes de maturation).
 * Seul fichier du module qui contient du SQL. Requêtes paramétrées uniquement.
 * Les prix sortent en euros (nombre) : la base les stocke en centimes.
 */

/**
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 *
 * @typedef {object} Category
 * @property {string} slug
 * @property {number} order
 * @property {string} name
 * @property {string} headline  titre avec un *mot* en accent
 * @property {string} summary
 * @property {string} intro
 * @property {string} media     libellé du visuel (placeholder)
 */

/**
 * @typedef {object} Service
 * @property {string} slug
 * @property {string} name
 * @property {string|null} category
 * @property {string[]} methods
 * @property {string} summary
 * @property {{ title: string, paragraphs: string[] }[]} body
 * @property {number} durationMin
 * @property {number} durationMax
 * @property {number} bufferAfter
 * @property {number|null} price
 * @property {boolean} priceFrom
 * @property {boolean} onQuote
 * @property {number|null} deposit
 * @property {string[]} photos
 * @property {{ q: string, a: string }[]} faq
 * @property {{ label: string, price: number }[]} options
 * @property {boolean} active
 * @property {boolean} bookableOnline
 * @property {number} order
 * @property {boolean} allergyTest
 * @property {boolean} featured
 * @property {boolean} isPlaceholder
 */

/**
 * @typedef {object} Method
 * @property {string} slug
 * @property {string} name
 * @property {string} aka
 * @property {'installation'|'maintenance'|'both'} family
 * @property {boolean} featured
 * @property {string} summary
 * @property {string} principle
 * @property {string} idealFor
 * @property {string} duration
 * @property {string} maturation
 * @property {string} maintenance
 * @property {string[]} pros
 * @property {string[]} watchouts
 * @property {string} service
 */

/** @typedef {{ name: string, period: string, text: string }} Stage */

/** @param {number|null} cents */
const toEuros = (cents) => (cents == null ? null : cents / 100);

/**
 * Regroupe des lignes { owner_id, … } par propriétaire.
 * @template {{ owner_id: string|number }} R
 * @param {R[]} rows
 * @returns {Map<string, R[]>}
 */
function groupByOwner(rows) {
  /** @type {Map<string, R[]>} */
  const map = new Map();
  for (const row of rows) {
    const key = String(row.owner_id);
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return map;
}

/**
 * @param {Db} db
 * @returns {Promise<{ categories: Category[], services: Service[] }>}
 */
export async function findCatalog(db) {
  const [categories, services, methodLinks, options, photos, faq] = await Promise.all([
    db.query(
      `SELECT slug, position, name, headline, summary, intro, media_label
         FROM categories WHERE active ORDER BY position, id`,
    ),
    db.query(
      `SELECT s.id, s.slug, s.name, c.slug AS category, s.summary, s.body,
              s.duration_min_minutes, s.duration_max_minutes, s.buffer_after_minutes,
              s.price_cents, s.price_from, s.on_quote, s.deposit_cents, s.active,
              s.bookable_online, s.position, s.allergy_test_required, s.featured, s.is_placeholder
         FROM services s LEFT JOIN categories c ON c.id = s.category_id
        ORDER BY s.position, s.id`,
    ),
    db.query(
      `SELECT sm.service_id AS owner_id, m.slug
         FROM service_methods sm JOIN methods m ON m.id = sm.method_id
        ORDER BY sm.position`,
    ),
    db.query(
      `SELECT service_id AS owner_id, label, price_cents
         FROM service_options WHERE active ORDER BY position, id`,
    ),
    db.query('SELECT service_id AS owner_id, caption FROM service_photos ORDER BY position, id'),
    db.query(
      `SELECT service_id AS owner_id, question, answer
         FROM faq_items WHERE service_id IS NOT NULL ORDER BY position, id`,
    ),
  ]);

  const methodsBy = groupByOwner(methodLinks.rows);
  const optionsBy = groupByOwner(options.rows);
  const photosBy = groupByOwner(photos.rows);
  const faqBy = groupByOwner(faq.rows);

  return {
    categories: categories.rows.map((c) => ({
      slug: c.slug,
      order: c.position,
      name: c.name,
      headline: c.headline,
      summary: c.summary,
      intro: c.intro,
      media: c.media_label,
    })),
    services: services.rows.map((s) => {
      const key = String(s.id);
      return {
        slug: s.slug,
        name: s.name,
        category: s.category,
        methods: (methodsBy.get(key) ?? []).map((m) => m.slug),
        summary: s.summary,
        body: s.body,
        durationMin: s.duration_min_minutes,
        durationMax: s.duration_max_minutes,
        bufferAfter: s.buffer_after_minutes,
        price: toEuros(s.price_cents),
        priceFrom: s.price_from,
        onQuote: s.on_quote,
        deposit: toEuros(s.deposit_cents),
        photos: (photosBy.get(key) ?? []).map((p) => p.caption),
        faq: (faqBy.get(key) ?? []).map((f) => ({ q: f.question, a: f.answer })),
        options: (optionsBy.get(key) ?? []).map((o) => ({
          label: o.label,
          price: /** @type {number} */ (toEuros(o.price_cents)),
        })),
        active: s.active,
        bookableOnline: s.bookable_online,
        order: s.position,
        allergyTest: s.allergy_test_required,
        featured: s.featured,
        isPlaceholder: s.is_placeholder,
      };
    }),
  };
}

/**
 * @param {Db} db
 * @returns {Promise<{ methods: Method[], stages: Stage[] }>}
 */
export async function findMethods(db) {
  const [methods, stages] = await Promise.all([
    db.query(
      `SELECT m.slug, m.name, m.aka, m.family, m.featured, m.summary, m.principle, m.ideal_for,
              m.duration_label, m.maturation, m.maintenance, m.pros, m.watchouts,
              s.slug AS service
         FROM methods m LEFT JOIN services s ON s.id = m.service_id
        ORDER BY m.position, m.id`,
    ),
    db.query(`SELECT body FROM content_blocks WHERE key = $1`, ['methods.stages']),
  ]);
  return {
    methods: methods.rows.map((m) => ({
      slug: m.slug,
      name: m.name,
      aka: m.aka,
      family: m.family,
      featured: m.featured,
      summary: m.summary,
      principle: m.principle,
      idealFor: m.ideal_for,
      duration: m.duration_label,
      maturation: m.maturation,
      maintenance: m.maintenance,
      pros: m.pros,
      watchouts: m.watchouts,
      service: m.service,
    })),
    stages: stages.rows[0]?.body ?? [],
  };
}
