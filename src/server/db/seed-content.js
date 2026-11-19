// @ts-check
/**
 * Charge les contenus de départ (JSON de la phase 2, dans db/seeds/*.json) dans les tables.
 * Idempotent : relançable sans doublons (upsert sur les clés naturelles : slug, clé, etc.).
 * Réservé au développement (cf. seed.js). SQL toujours paramétré.
 *
 * Les prix, durées et options sont des valeurs d'exemple : is_placeholder = true (§6).
 * Les avis sont des exemples : is_placeholder = true, à remplacer avant la mise en ligne (§8).
 * Aucun horaire d'ouverture n'est semé : à confirmer par la propriétaire (TODO-PROPRIO).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * @template T
 * @param {string} name
 * @returns {Promise<T>}
 */
async function readJson(name) {
  const path = fileURLToPath(new URL(`./seeds/${name}.json`, import.meta.url));
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Euros → centimes (null conservé). @param {number|null|undefined} euros */
const toCents = (euros) => (euros == null ? null : Math.round(euros * 100));

/** @param {import('pg').PoolClient} db */
export async function seedContent(db) {
  await seedCatalog(db);
  await seedGallery(db);
  await seedReviews(db);
  await seedContentTables(db);
  await seedStaff(db);
}

/** @param {import('pg').PoolClient} db */
async function seedCatalog(db) {
  const { categories, services } = await readJson('services');
  const { methods, stages } = await readJson('methods');

  for (const c of categories) {
    await db.query(
      `INSERT INTO categories (slug, name, headline, summary, intro, media_label, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (slug) DO UPDATE SET name = $2, headline = $3, summary = $4, intro = $5,
         media_label = $6, position = $7`,
      [c.slug, c.name, c.headline, c.summary, c.intro, c.media, c.order],
    );
  }

  for (const [index, s] of services.entries()) {
    const { rows } = await db.query(
      `INSERT INTO services (slug, category_id, name, summary, body, duration_min_minutes,
         duration_max_minutes, buffer_after_minutes, price_cents, price_from, on_quote,
         deposit_cents, active, bookable_online, allergy_test_required, featured, position,
         is_placeholder)
       VALUES ($1, (SELECT id FROM categories WHERE slug = $2), $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, true)
       ON CONFLICT (slug) DO UPDATE SET category_id = EXCLUDED.category_id, name = $3, summary = $4,
         body = $5, duration_min_minutes = $6, duration_max_minutes = $7, buffer_after_minutes = $8,
         price_cents = $9, price_from = $10, on_quote = $11, deposit_cents = $12, active = $13,
         bookable_online = $14, allergy_test_required = $15, featured = $16, position = $17,
         is_placeholder = true
       RETURNING id`,
      [
        s.slug,
        s.category,
        s.name,
        s.summary,
        JSON.stringify(s.body),
        s.durationMin,
        s.durationMax,
        s.bufferAfter,
        toCents(s.price),
        s.priceFrom,
        s.onQuote,
        toCents(s.deposit),
        s.active,
        s.bookableOnline,
        s.allergyTest,
        s.featured,
        s.order ?? index + 1,
      ],
    );
    const serviceId = rows[0].id;

    for (const [position, o] of s.options.entries()) {
      await db.query(
        `INSERT INTO service_options (service_id, label, price_cents, position, is_placeholder)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (service_id, label) DO UPDATE SET price_cents = $3, position = $4`,
        [serviceId, o.label, toCents(o.price), position],
      );
    }

    // Photos et FAQ propres à la prestation : remplacées à chaque seed.
    await db.query('DELETE FROM service_photos WHERE service_id = $1', [serviceId]);
    for (const [position, caption] of s.photos.entries()) {
      await db.query(
        'INSERT INTO service_photos (service_id, caption, position) VALUES ($1, $2, $3)',
        [serviceId, caption, position],
      );
    }
    await db.query('DELETE FROM faq_items WHERE service_id = $1', [serviceId]);
    for (const [position, f] of s.faq.entries()) {
      await db.query(
        'INSERT INTO faq_items (service_id, question, answer, position) VALUES ($1, $2, $3, $4)',
        [serviceId, f.q, f.a, position],
      );
    }
  }

  for (const [index, m] of methods.entries()) {
    await db.query(
      `INSERT INTO methods (slug, name, aka, family, featured, summary, principle, ideal_for,
         duration_label, maturation, maintenance, pros, watchouts, service_id, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         (SELECT id FROM services WHERE slug = $14), $15)
       ON CONFLICT (slug) DO UPDATE SET name = $2, aka = $3, family = $4, featured = $5,
         summary = $6, principle = $7, ideal_for = $8, duration_label = $9, maturation = $10,
         maintenance = $11, pros = $12, watchouts = $13, service_id = EXCLUDED.service_id,
         position = $15`,
      [
        m.slug,
        m.name,
        m.aka,
        m.family,
        m.featured,
        m.summary,
        m.principle,
        m.idealFor,
        m.duration,
        m.maturation,
        m.maintenance,
        m.pros,
        m.watchouts,
        m.service,
        index,
      ],
    );
  }

  // Liens prestation ↔ méthodes, dans l'ordre du JSON.
  for (const s of services) {
    for (const [position, methodSlug] of s.methods.entries()) {
      await db.query(
        `INSERT INTO service_methods (service_id, method_id, position)
         VALUES ((SELECT id FROM services WHERE slug = $1), (SELECT id FROM methods WHERE slug = $2), $3)
         ON CONFLICT (service_id, method_id) DO UPDATE SET position = $3`,
        [s.slug, methodSlug, position],
      );
    }
  }

  // Étapes de maturation des locks : bloc de contenu éditable.
  await db.query(
    `INSERT INTO content_blocks (key, title, body) VALUES ('methods.stages', $1, $2)
     ON CONFLICT (key) DO UPDATE SET title = $1, body = $2`,
    ['Les étapes de la vie d’une loc', JSON.stringify(stages)],
  );
}

/** @param {import('pg').PoolClient} db */
async function seedGallery(db) {
  const { items, sizes } = await readJson('gallery');
  for (const [position, size] of sizes.entries()) {
    await db.query(
      `INSERT INTO tags (kind, slug, label, position) VALUES ('size', $1, $2, $3)
       ON CONFLICT (kind, slug) DO UPDATE SET label = $2, position = $3`,
      [size.slug, size.label, position],
    );
  }
  for (const [position, item] of items.entries()) {
    const { rows } = await db.query(
      `INSERT INTO gallery_items (slug, title, category_id, method_id, ratio, featured, position,
         is_placeholder)
       VALUES ($1, $2, (SELECT id FROM categories WHERE slug = $3),
         (SELECT id FROM methods WHERE slug = $4), $5, $6, $7, true)
       ON CONFLICT (slug) DO UPDATE SET title = $2, category_id = EXCLUDED.category_id,
         method_id = EXCLUDED.method_id, ratio = $5, featured = $6, position = $7
       RETURNING id`,
      [item.id, item.title, item.category, item.method, item.ratio, item.featured, position],
    );
    await db.query('DELETE FROM gallery_item_tags WHERE item_id = $1', [rows[0].id]);
    await db.query(
      `INSERT INTO gallery_item_tags (item_id, tag_id)
       SELECT $1, id FROM tags WHERE kind = 'size' AND slug = $2`,
      [rows[0].id, item.size],
    );
  }
}

/** @param {import('pg').PoolClient} db */
async function seedReviews(db) {
  const { reviews } = await readJson('reviews');
  for (const r of reviews) {
    // Identifiant déterministe : le seed reste idempotent sans clé naturelle.
    await db.query(
      `INSERT INTO reviews (id, service_id, author_name, rating, body, consent_publication,
         status, featured, verified, submitted_at, is_placeholder)
       VALUES (md5($1)::uuid, (SELECT id FROM services WHERE slug = $2), $3, $4, $5, true,
         'approved', $6, $7, ($8::date + time '12:00') AT TIME ZONE 'UTC', true)
       ON CONFLICT (id) DO UPDATE SET service_id = EXCLUDED.service_id, author_name = $3,
         rating = $4, body = $5, featured = $6, verified = $7, submitted_at = EXCLUDED.submitted_at`,
      [
        'seed-review-' + r.id,
        r.service,
        r.author,
        r.rating,
        r.text,
        r.featured,
        r.verified,
        r.date,
      ],
    );
  }
}

/** @param {import('pg').PoolClient} db */
async function seedContentTables(db) {
  const { articles } = await readJson('articles');
  const { groups } = await readJson('faq');
  const settings = /** @type {Record<string, unknown>} */ (await readJson('settings'));

  for (const a of articles) {
    const { rows } = await db.query(
      `INSERT INTO articles (slug, title, plain_title, excerpt, sections, reading_minutes, status,
         published_on)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', $7)
       ON CONFLICT (slug) DO UPDATE SET title = $2, plain_title = $3, excerpt = $4, sections = $5,
         reading_minutes = $6, status = 'published', published_on = $7
       RETURNING id`,
      [
        a.slug,
        a.title,
        a.plainTitle,
        a.excerpt,
        JSON.stringify(a.sections),
        a.readingMinutes,
        a.date,
      ],
    );
    const topicSlug = a.topic
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    const tag = await db.query(
      `INSERT INTO tags (kind, slug, label) VALUES ('topic', $1, $2)
       ON CONFLICT (kind, slug) DO UPDATE SET label = $2 RETURNING id`,
      [topicSlug, a.topic],
    );
    await db.query('DELETE FROM article_tags WHERE article_id = $1', [rows[0].id]);
    await db.query('INSERT INTO article_tags (article_id, tag_id) VALUES ($1, $2)', [
      rows[0].id,
      tag.rows[0].id,
    ]);
  }

  for (const [gi, g] of groups.entries()) {
    const { rows } = await db.query(
      `INSERT INTO faq_groups (slug, title, position) VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET title = $2, position = $3 RETURNING id`,
      [g.slug, g.title, gi],
    );
    await db.query('DELETE FROM faq_items WHERE group_id = $1', [rows[0].id]);
    for (const [position, item] of g.items.entries()) {
      await db.query(
        'INSERT INTO faq_items (group_id, question, answer, position) VALUES ($1, $2, $3, $4)',
        [rows[0].id, item.q, item.a, position],
      );
    }
  }

  // Réglages éditables : une clé par bloc (site.announcement, site.founder…).
  for (const key of ['announcement', 'founder', 'stats', 'instagram']) {
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [`site.${key}`, JSON.stringify(settings[key])],
    );
  }
}

/** Une praticienne par défaut (TODO-PROPRIO : nom réel), rattachée aux prestations réservables. */
/** @param {import('pg').PoolClient} db */
async function seedStaff(db) {
  await db.query(
    `INSERT INTO staff (display_name, role_label)
     SELECT 'La fondatrice', 'Locticienne et fondatrice'
     WHERE NOT EXISTS (SELECT 1 FROM staff)`,
  );
  await db.query(
    `INSERT INTO staff_services (staff_id, service_id)
     SELECT (SELECT min(id) FROM staff), s.id FROM services s WHERE s.bookable_online
     ON CONFLICT DO NOTHING`,
  );
}
