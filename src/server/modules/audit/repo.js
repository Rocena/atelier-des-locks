// @ts-check
/**
 * Journal d'audit (ajout seul) et journal des notifications, en lecture. Seul fichier SQL du module.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 */

/**
 * @param {Db} db
 * @param {{ userId: string|null, action: string, entityType?: string|null, entityId?: string|null, details?: Record<string, unknown>, ip?: string|null }} e
 */
export async function insertAudit(db, e) {
  await db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.userId, e.action, e.entityType ?? null, e.entityId ?? null, e.details ?? {}, e.ip ?? null],
  );
}

export const PAGE_SIZE = 50;

/**
 * @param {Db} db
 * @param {{ action?: string, userId?: string, page: number }} q
 */
export async function findAudit(db, q) {
  const params = [
    q.action ? `${q.action}%` : null,
    q.userId ?? null,
    PAGE_SIZE + 1,
    (q.page - 1) * PAGE_SIZE,
  ];
  const { rows } = await db.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, host(a.ip) AS ip,
            u.display_name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE ($1::text IS NULL OR a.action LIKE $1)
        AND ($2::uuid IS NULL OR a.user_id = $2::uuid)
      ORDER BY a.created_at DESC, a.id DESC LIMIT $3 OFFSET $4`,
    params,
  );
  return {
    hasNext: rows.length > PAGE_SIZE,
    rows: rows.slice(0, PAGE_SIZE).map((r) => ({
      id: Number(r.id),
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      details: r.details,
      createdAt: r.created_at,
      ip: r.ip,
      userName: r.user_name,
    })),
  };
}

/** Préfixes d'action pour le filtre. @param {Db} db */
export async function findAuditActions(db) {
  const { rows } = await db.query(
    `SELECT DISTINCT split_part(action, '.', 1) AS area FROM audit_log ORDER BY 1`,
  );
  return rows.map((r) => /** @type {string} */ (r.area));
}

/**
 * Journal des notifications (les destinataires sont masqués à l'affichage).
 * @param {Db} db
 * @param {{ status?: string, page: number }} q
 */
export async function findNotifications(db, q) {
  const { rows } = await db.query(
    `SELECT n.id, n.channel, n.template, n.recipient, n.status, n.error, n.attempts,
            n.scheduled_at, n.sent_at, n.appointment_id,
            c.first_name, left(c.last_name, 1) AS last_initial
       FROM notifications_log n LEFT JOIN clients c ON c.id = n.client_id
      WHERE ($1::text IS NULL OR n.status = $1)
      ORDER BY n.scheduled_at DESC, n.id DESC LIMIT $2 OFFSET $3`,
    [q.status ?? null, PAGE_SIZE + 1, (q.page - 1) * PAGE_SIZE],
  );
  return {
    hasNext: rows.length > PAGE_SIZE,
    rows: rows.slice(0, PAGE_SIZE).map((r) => ({
      id: r.id,
      channel: r.channel,
      template: r.template,
      recipient: r.recipient,
      status: r.status,
      error: r.error,
      attempts: r.attempts,
      scheduledAt: r.scheduled_at,
      sentAt: r.sent_at,
      appointmentId: r.appointment_id,
      clientLabel: r.first_name ? `${r.first_name} ${r.last_initial}.` : null,
    })),
  };
}
