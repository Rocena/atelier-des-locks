// @ts-check
/**
 * Accès admin aux contenus : articles du journal, FAQ, blocs de texte. Seul fichier SQL de cette
 * partie du module. Requêtes paramétrées uniquement.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 */

// ─── Articles ────────────────────────────────────────────────────────────────

/** @param {Db} db */
export async function findAdminArticles(db) {
  const { rows } = await db.query(
    `SELECT id, slug, plain_title, status, to_char(published_on, 'YYYY-MM-DD') AS published_on
       FROM articles ORDER BY (status = 'published') DESC, published_on DESC NULLS LAST, id DESC`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    slug: /** @type {string} */ (r.slug),
    title: /** @type {string} */ (r.plain_title),
    status: /** @type {string} */ (r.status),
    publishedOn: /** @type {string|null} */ (r.published_on),
  }));
}

/** @param {Db} db @param {number} id */
export async function findArticle(db, id) {
  const { rows } = await db.query(
    `SELECT id, slug, title, excerpt, sections, reading_minutes, status,
            to_char(published_on, 'YYYY-MM-DD') AS published_on
       FROM articles WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  return r
    ? {
        id: Number(r.id),
        slug: /** @type {string} */ (r.slug),
        title: /** @type {string} */ (r.title),
        excerpt: /** @type {string} */ (r.excerpt),
        sections: /** @type {{ title: string|null, paragraphs: string[] }[]} */ (r.sections),
        readingMinutes: /** @type {number} */ (r.reading_minutes),
        status: /** @type {string} */ (r.status),
        publishedOn: /** @type {string|null} */ (r.published_on),
      }
    : null;
}

/**
 * @typedef {object} ArticleInput
 * @property {string} slug @property {string} title @property {string} plainTitle
 * @property {string} excerpt @property {object[]} sections @property {number} readingMinutes
 * @property {'draft'|'published'} status @property {string|null} publishedOn
 */

/** @param {Db} db @param {ArticleInput} a */
export async function insertArticle(db, a) {
  const { rows } = await db.query(
    `INSERT INTO articles (slug, title, plain_title, excerpt, sections, reading_minutes, status, published_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      a.slug,
      a.title,
      a.plainTitle,
      a.excerpt,
      JSON.stringify(a.sections),
      a.readingMinutes,
      a.status,
      a.publishedOn,
    ],
  );
  return Number(rows[0].id);
}

/** @param {Db} db @param {number} id @param {ArticleInput} a */
export async function updateArticle(db, id, a) {
  await db.query(
    `UPDATE articles SET slug = $2, title = $3, plain_title = $4, excerpt = $5, sections = $6,
            reading_minutes = $7, status = $8, published_on = $9 WHERE id = $1`,
    [
      id,
      a.slug,
      a.title,
      a.plainTitle,
      a.excerpt,
      JSON.stringify(a.sections),
      a.readingMinutes,
      a.status,
      a.publishedOn,
    ],
  );
}

/** @param {Db} db @param {string} slug @param {number|null} [exceptId] */
export async function articleSlugTaken(db, slug, exceptId = null) {
  const { rows } = await db.query(
    'SELECT 1 FROM articles WHERE slug = $1 AND ($2::bigint IS NULL OR id <> $2) LIMIT 1',
    [slug, exceptId],
  );
  return rows.length > 0;
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

/** @param {Db} db */
export async function findAdminFaq(db) {
  const { rows } = await db.query(
    `SELECT g.id AS group_id, g.title AS group_title, i.id, i.question, i.answer
       FROM faq_groups g LEFT JOIN faq_items i ON i.group_id = g.id
      ORDER BY g.position, g.id, i.position, i.id`,
  );
  /** @type {Map<number, { id: number, title: string, items: { id: number, question: string, answer: string }[] }>} */
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(Number(r.group_id)) ?? {
      id: Number(r.group_id),
      title: /** @type {string} */ (r.group_title),
      items: /** @type {{ id: number, question: string, answer: string }[]} */ ([]),
    };
    if (r.id) g.items.push({ id: Number(r.id), question: r.question, answer: r.answer });
    groups.set(g.id, g);
  }
  return [...groups.values()];
}

/** @param {Db} db */
export async function findFaqGroups(db) {
  const { rows } = await db.query('SELECT id, title FROM faq_groups ORDER BY position, id');
  return rows.map((r) => ({ id: Number(r.id), title: /** @type {string} */ (r.title) }));
}

/** @param {Db} db @param {number} id */
export async function findFaqItem(db, id) {
  const { rows } = await db.query(
    'SELECT id, group_id, question, answer FROM faq_items WHERE id = $1 AND group_id IS NOT NULL',
    [id],
  );
  const r = rows[0];
  return r
    ? {
        id: Number(r.id),
        groupId: Number(r.group_id),
        question: /** @type {string} */ (r.question),
        answer: /** @type {string} */ (r.answer),
      }
    : null;
}

/** @param {Db} db @param {{ groupId: number, question: string, answer: string }} q */
export async function insertFaqItem(db, q) {
  const { rows } = await db.query(
    `INSERT INTO faq_items (group_id, question, answer, position)
     VALUES ($1, $2, $3, (SELECT COALESCE(max(position), 0) + 1 FROM faq_items WHERE group_id = $1))
     RETURNING id`,
    [q.groupId, q.question, q.answer],
  );
  return Number(rows[0].id);
}

/** @param {Db} db @param {number} id @param {{ groupId: number, question: string, answer: string }} q */
export async function updateFaqItem(db, id, q) {
  await db.query('UPDATE faq_items SET group_id = $2, question = $3, answer = $4 WHERE id = $1', [
    id,
    q.groupId,
    q.question,
    q.answer,
  ]);
}

/** @param {Db} db @param {number} id */
export async function deleteFaqItem(db, id) {
  const { rowCount } = await db.query(
    'DELETE FROM faq_items WHERE id = $1 AND group_id IS NOT NULL',
    [id],
  );
  return rowCount === 1;
}

// ─── Blocs de texte ──────────────────────────────────────────────────────────

/** @param {Db} db @param {string} key */
export async function findBlock(db, key) {
  const { rows } = await db.query('SELECT key, title, body FROM content_blocks WHERE key = $1', [
    key,
  ]);
  return rows[0] ?? null;
}

/** @param {Db} db @param {string} key @param {unknown} body @param {string} userId */
export async function updateBlock(db, key, body, userId) {
  await db.query('UPDATE content_blocks SET body = $2::jsonb, updated_by = $3 WHERE key = $1', [
    key,
    JSON.stringify(body),
    userId,
  ]);
}
