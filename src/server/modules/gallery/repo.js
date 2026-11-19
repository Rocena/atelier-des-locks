// @ts-check
/**
 * Galerie des réalisations (table gallery_items, étiquettes de taille dans tags).
 * Seul fichier du module qui contient du SQL.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 * @typedef {object} GalleryItem
 * @property {string} id        slug stable de la réalisation (ex. g01)
 * @property {string} title
 * @property {string} category
 * @property {string|null} method
 * @property {string} size
 * @property {'portrait'|'landscape'|'square'} ratio
 * @property {boolean} featured
 * @property {string|null} image   nom du fichier (uuid.webp) sous /media/galerie/, ou null (placeholder)
 * @property {string} alt
 * @typedef {{ slug: string, label: string }} Size
 */

/**
 * @param {Db} db
 * @returns {Promise<{ items: GalleryItem[], sizes: Size[] }>}
 */
export async function findGallery(db) {
  const [items, sizes] = await Promise.all([
    db.query(
      `SELECT g.slug AS id, g.title, c.slug AS category, m.slug AS method, t.slug AS size,
              g.ratio, g.featured, g.alt_text AS alt,
              CASE WHEN g.image_path IS NULL THEN NULL
                   ELSE substring(g.image_path from '[^/]+$') END AS image
         FROM gallery_items g
         LEFT JOIN categories c ON c.id = g.category_id
         LEFT JOIN methods m ON m.id = g.method_id
         LEFT JOIN gallery_item_tags git ON git.item_id = g.id
         LEFT JOIN tags t ON t.id = git.tag_id AND t.kind = 'size'
        WHERE g.active
        ORDER BY g.position, g.id`,
    ),
    db.query(`SELECT slug, label FROM tags WHERE kind = 'size' ORDER BY position, id`),
  ]);
  return { items: items.rows, sizes: sizes.rows };
}
