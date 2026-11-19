// @ts-check
/**
 * Journal d'activité (qui a fait quoi) et journal des messages envoyés. Propriétaire uniquement.
 * Les adresses et numéros sont masqués à l'affichage.
 */
import { z } from 'zod';
import { OWNER } from '../admin/guard.js';
import * as repo from './repo.js';
import { actionLabel } from './service.js';

const auditQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1).catch(1),
  zone: z
    .string()
    .regex(/^[a-z_]{1,30}$/)
    .optional()
    .catch(undefined),
});

const notificationsQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1).catch(1),
  statut: z.enum(['queued', 'sent', 'failed', 'skipped']).optional().catch(undefined),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function auditRoutes(app) {
  const opts = { config: { roles: OWNER } };

  app.get('/journal', opts, async (request, reply) => {
    const q = auditQuery.parse(request.query);
    const [{ rows, hasNext }, areas] = await Promise.all([
      repo.findAudit(app.db, { action: q.zone ? `${q.zone}.` : undefined, page: q.page }),
      repo.findAuditActions(app.db),
    ]);
    return reply.adminPage('admin/journal', {
      title: 'Journal d’activité',
      section: 'journal',
      rows: rows.map((r) => ({ ...r, label: actionLabel(r.action) })),
      hasNext,
      page: q.page,
      zone: q.zone ?? '',
      areas,
    });
  });

  app.get('/notifications', opts, async (request, reply) => {
    const q = notificationsQuery.parse(request.query);
    const { rows, hasNext } = await repo.findNotifications(app.db, {
      status: q.statut,
      page: q.page,
    });
    return reply.adminPage('admin/notifications', {
      title: 'Messages envoyés',
      section: 'notifications',
      rows,
      hasNext,
      page: q.page,
      statut: q.statut ?? '',
    });
  });
}
