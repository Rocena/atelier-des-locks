// @ts-check
/**
 * Durées de conservation (§14). Seul fichier SQL du module, requêtes paramétrées uniquement.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 */

/**
 * Clientes à anonymiser : aucune activité (RDV, y compris à venir) depuis `cutoff`.
 * @param {Db} db @param {Date} cutoff
 * @returns {Promise<string[]>}
 */
export async function findInactiveClientIds(db, cutoff) {
  const { rows } = await db.query(
    `SELECT c.id FROM clients c
      WHERE c.anonymized_at IS NULL AND c.created_at < $1
        AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.client_id = c.id AND a.starts_at >= $1)`,
    [cutoff],
  );
  return rows.map((r) => /** @type {string} */ (r.id));
}

/**
 * Efface la référence des photos de cheveux des RDV antérieurs à `cutoff` ; renvoie les chemins.
 * @param {Db} db @param {Date} cutoff
 * @returns {Promise<string[]>}
 */
export async function clearOldHairPhotos(db, cutoff) {
  const { rows } = await db.query(
    `UPDATE appointments SET hair_photo_path = NULL
      WHERE hair_photo_path IS NOT NULL AND starts_at < $1
      RETURNING hair_photo_path`,
    [cutoff],
  );
  return rows.map((r) => /** @type {string} */ (r.hair_photo_path));
}

/** Vide les destinataires des envois anciens. @param {Db} db @param {Date} cutoff */
export async function clearOldRecipients(db, cutoff) {
  const res = await db.query(
    `UPDATE notifications_log SET recipient = '' WHERE created_at < $1 AND recipient <> ''`,
    [cutoff],
  );
  return res.rowCount ?? 0;
}

/** Supprime les sessions expirées. @param {Db} db @param {Date} now */
export async function deleteExpiredSessions(db, now) {
  const res = await db.query('DELETE FROM sessions WHERE expires_at < $1', [now]);
  return res.rowCount ?? 0;
}

/** Efface les adresses IP anciennes des sessions et du journal d'audit. @param {Db} db @param {Date} cutoff */
export async function clearOldIps(db, cutoff) {
  const s = await db.query(
    `UPDATE sessions SET ip = NULL WHERE ip IS NOT NULL AND created_at < $1`,
    [cutoff],
  );
  const a = await db.query(
    `UPDATE audit_log SET ip = NULL WHERE ip IS NOT NULL AND created_at < $1`,
    [cutoff],
  );
  return (s.rowCount ?? 0) + (a.rowCount ?? 0);
}
