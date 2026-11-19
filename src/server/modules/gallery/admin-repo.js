// @ts-check
/**
 * Accès admin à la galerie : réalisations, étiquettes (catégorie, méthode, taille), ordre.
 * Seul fichier SQL de cette partie du module. Requêtes paramétrées uniquement.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 */
import { randomBytes } from 'node:crypto';

/** @param {Db} db */
export async function findAdminGallery(db) {
  const { rows } = await db.query(
    `SELECT g.id, g.title, g.alt_text, g.image_path, g.featured, g.active, g.ratio,
            c.name AS category, m.name AS method, t.label AS size
       FROM gallery_items g
       LEFT JOIN categories c ON c.id = g.category_id
       LEFT JOIN methods m ON m.id = g.method_id
       LEFT JOIN gallery_item_tags git ON git.item_id = g.id
       LEFT JOIN tags t ON t.id = git.tag_id AND t.kind = 'size'
      ORDER BY g.position, g.id`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    title: /** @type {string} */ (r.title),
    alt: /** @type {string} */ (r.alt_text),
    image: r.image_path ? /** @type {string} */ (r.image_path).split('/').pop() : null,
    featured: /** @type {boolean} */ (r.featured),
    active: /** @type {boolean} */ (r.active),
    ratio: /** @type {string} */ (r.ratio),
    category: /** @type {string|null} */ (r.category),
    method: /** @type {string|null} */ (r.method),
    size: /** @type {string|null} */ (r.size),
  }));
}

/** Listes de choix des formulaires. @param {Db} db */
export async function findGalleryChoices(db) {
  const [categories, methods, sizes] = await Promise.all([
    db.query('SELECT id, name FROM categories WHERE active ORDER BY position, id'),
    db.query('SELECT id, name FROM methods ORDER BY position, id'),
    db.query(`SELECT id, label FROM tags WHERE kind = 'size' ORDER BY position, id`),
  ]);
  return {
    categories: categories.rows.map((r) => ({
      id: Number(r.id),
      name: /** @type {string} */ (r.name),
    })),
    methods: methods.rows.map((r) => ({ id: Number(r.id), name: /** @type {string} */ (r.name) })),
    sizes: sizes.rows.map((r) => ({ id: Number(r.id), name: /** @type {string} */ (r.label) })),
  };
}

/** @param {Db} db @param {number} id */
export async function findItem(db, id) {
  const { rows } = await db.query(
    `SELECT g.id, g.title, g.alt_text, g.image_path, g.category_id, g.method_id, g.featured, g.active,
            (SELECT git.tag_id FROM gallery_item_tags git JOIN tags t ON t.id = git.tag_id
              WHERE git.item_id = g.id AND t.kind = 'size' LIMIT 1) AS size_tag_id
       FROM gallery_items g WHERE g.id = $1`,
    [id],
  );
  const r = rows[0];
  return r
    ? {
        id: Number(r.id),
        title: /** @type {string} */ (r.title),
        alt: /** @type {string} */ (r.alt_text),
        imagePath: /** @type {string|null} */ (r.image_path),
        categoryId: r.category_id == null ? null : Number(r.category_id),
        methodId: r.method_id == null ? null : Number(r.method_id),
        sizeTagId: r.size_tag_id == null ? null : Number(r.size_tag_id),
        featured: /** @type {boolean} */ (r.featured),
        active: /** @type {boolean} */ (r.active),
      }
    : null;
}

/**
 * @typedef {object} ItemInput
 * @property {string} title @property {string} alt @property {number|null} categoryId
 * @property {number|null} methodId @property {number|null} sizeTagId @property {boolean} featured
 * @property {boolean} active
 */

/** @param {Db} db @param {number} itemId @param {number|null} sizeTagId */
async function setSizeTag(db, itemId, sizeTagId) {
  await db.query(
    `DELETE FROM gallery_item_tags
      WHERE item_id = $1 AND tag_id IN (SELECT id FROM tags WHERE kind = 'size')`,
    [itemId],
  );
  if (sizeTagId !== null) {
    await db.query(
      `INSERT INTO gallery_item_tags (item_id, tag_id)
       SELECT $1, id FROM tags WHERE id = $2 AND kind = 'size'`,
      [itemId, sizeTagId],
    );
  }
}

/**
 * @param {Db} db
 * @param {ItemInput & { imagePath: string, ratio: 'portrait'|'landscape'|'square' }} i
 */
export async function insertItem(db, i) {
  const slug = `r-${randomBytes(5).toString('hex')}`;
  const { rows } = await db.query(
    `INSERT INTO gallery_items (slug, title, alt_text, category_id, method_id, ratio, image_path,
        featured, active, is_placeholder, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false,
             (SELECT COALESCE(max(position), 0) + 1 FROM gallery_items))
     RETURNING id`,
    [slug, i.title, i.alt, i.categoryId, i.methodId, i.ratio, i.imagePath, i.featured, i.active],
  );
  const id = Number(rows[0].id);
  await setSizeTag(db, id, i.sizeTagId);
  return id;
}

/**
 * @param {Db} db @param {number} id
 * @param {ItemInput & { image?: { imagePath: string, ratio: 'portrait'|'landscape'|'square' } }} i
 */
export async function updateItem(db, id, i) {
  await db.query(
    `UPDATE gallery_items
        SET title = $2, alt_text = $3, category_id = $4, method_id = $5, featured = $6, active = $7,
            image_path = COALESCE($8, image_path), ratio = COALESCE($9, ratio),
            is_placeholder = CASE WHEN $8::text IS NULL THEN is_placeholder ELSE false END
      WHERE id = $1`,
    [
      id,
      i.title,
      i.alt,
      i.categoryId,
      i.methodId,
      i.featured,
      i.active,
      i.image?.imagePath ?? null,
      i.image?.ratio ?? null,
    ],
  );
  await setSizeTag(db, id, i.sizeTagId);
}

/** @param {Db} db @param {number} id @param {{ featured?: boolean, active?: boolean }} flags */
export async function setFlags(db, id, flags) {
  const { rowCount } = await db.query(
    `UPDATE gallery_items SET featured = COALESCE($2, featured), active = COALESCE($3, active)
      WHERE id = $1`,
    [id, flags.featured ?? null, flags.active ?? null],
  );
  return rowCount === 1;
}

/** Supprime la réalisation. Renvoie le chemin de l'image à effacer du disque. @param {Db} db @param {number} id */
export async function deleteItem(db, id) {
  const { rows } = await db.query('DELETE FROM gallery_items WHERE id = $1 RETURNING image_path', [
    id,
  ]);
  return rows[0] ? { imagePath: /** @type {string|null} */ (rows[0].image_path) } : null;
}
