// @ts-check
/**
 * Contenus éditables : articles du journal, FAQ, réglages d'affichage (settings), blocs de texte.
 * Seul fichier du module qui contient du SQL.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 *
 * @typedef {object} Article
 * @property {string} slug
 * @property {string} title       avec un *mot* en accent
 * @property {string} plainTitle
 * @property {string} excerpt
 * @property {string} date
 * @property {number} readingMinutes
 * @property {string} topic
 * @property {{ title: string|null, paragraphs: string[] }[]} sections
 *
 * @typedef {object} Settings
 * @property {{ enabled: boolean, id: string, text: string, linkLabel: string, href: string }} announcement
 * @property {{ firstName: string, displayName: string, role: string }} founder
 * @property {{ clients: number, yearsOfPractice: number, isPlaceholder: boolean }} stats
 * @property {{ handle: string, url: string, tiles: string[] }} instagram
 *
 * @typedef {{ slug: string, title: string, items: { q: string, a: string }[] }} FaqGroup
 */

/**
 * Articles publiés (les brouillons restent invisibles).
 * @param {Db} db
 * @returns {Promise<Article[]>}
 */
export async function findPublishedArticles(db) {
  const { rows } = await db.query(
    `SELECT a.slug, a.title, a.plain_title, a.excerpt, a.sections, a.reading_minutes,
            to_char(a.published_on, 'YYYY-MM-DD') AS date,
            COALESCE((SELECT t.label FROM article_tags atg JOIN tags t ON t.id = atg.tag_id
                       WHERE atg.article_id = a.id AND t.kind = 'topic'
                       ORDER BY t.position, t.id LIMIT 1), '') AS topic
       FROM articles a
      WHERE a.status = 'published' AND a.published_on <= CURRENT_DATE
      ORDER BY a.published_on DESC, a.id`,
  );
  return rows.map((a) => ({
    slug: a.slug,
    title: a.title,
    plainTitle: a.plain_title,
    excerpt: a.excerpt,
    date: a.date,
    readingMinutes: a.reading_minutes,
    topic: a.topic,
    sections: a.sections,
  }));
}

/**
 * Réglages d'affichage : clés « site.* » de la table settings.
 * @param {Db} db
 * @returns {Promise<Settings>}
 */
export async function findSettings(db) {
  const { rows } = await db.query(`SELECT key, value FROM settings WHERE key LIKE 'site.%'`);
  const byKey = Object.fromEntries(rows.map((r) => [r.key.slice('site.'.length), r.value]));
  return /** @type {Settings} */ (byKey);
}

/**
 * FAQ du site, groupée par thème (les questions propres à une prestation sont dans services).
 * @param {Db} db
 * @returns {Promise<FaqGroup[]>}
 */
export async function findFaq(db) {
  const { rows } = await db.query(
    `SELECT g.slug, g.title, i.question, i.answer
       FROM faq_groups g JOIN faq_items i ON i.group_id = g.id
      ORDER BY g.position, g.id, i.position, i.id`,
  );
  /** @type {Map<string, FaqGroup>} */
  const groups = new Map();
  for (const row of rows) {
    /** @type {FaqGroup} */
    const group = groups.get(row.slug) ?? { slug: row.slug, title: row.title, items: [] };
    group.items.push({ q: row.question, a: row.answer });
    groups.set(row.slug, group);
  }
  return [...groups.values()];
}

/**
 * Bloc de contenu par clé (ex. « methods.stages »), ou null s'il n'existe pas.
 * @param {Db} db
 * @param {string} key
 * @returns {Promise<{ key: string, title: string, body: unknown } | null>}
 */
export async function findContentBlock(db, key) {
  const { rows } = await db.query('SELECT key, title, body FROM content_blocks WHERE key = $1', [
    key,
  ]);
  return rows[0] ?? null;
}
