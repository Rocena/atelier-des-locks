// @ts-check
/**
 * Routes admin des clientes : recherche, fiche (historique, notes), export CSV, suppression RGPD.
 * Export et suppression : propriétaire uniquement ; le reste est ouvert à l'équipe.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ANY, OWNER } from '../admin/guard.js';
import { redirectWith } from '../admin/nav.js';
import { audit } from '../audit/service.js';
import { fieldErrors } from '../auth/schemas.js';
import { normalizePhone } from '../booking/schemas.js';
import { withTransaction } from '../../db/pool.js';
import * as agenda from '../agenda/repo.js';
import { checkbox, uuidParams } from '../agenda/schemas.js';
import { clientsToCsv } from './csv.js';
import { displayEmail } from './placeholder.js';
import * as repo from './repo.js';

const searchQuery = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
});

const clientForm = z.object({
  firstName: z.string().trim().min(1, 'Indiquez le prénom.').max(80),
  lastName: z.string().trim().min(1, 'Indiquez le nom.').max(80),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || normalizePhone(v) !== null, 'Numéro de téléphone invalide.'),
  smsReminders: checkbox,
  notes: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => v || undefined),
});

/** Suppression : la propriétaire doit cocher la confirmation. */
const confirmForm = z.object({ confirm: z.literal('1') });

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ config: import('../../config.js').AppConfig, now: () => Date }} options
 */
export default async function clientsRoutes(app, { config }) {
  app.get('/clientes', { config: { roles: ANY } }, async (request, reply) => {
    const q = searchQuery.parse(request.query);
    const result = await repo.searchClients(app.db, { q: q.q, page: q.page });
    return reply.adminPage('admin/clientes', {
      title: 'Clientes',
      section: 'clientes',
      result: { ...result, rows: result.rows.map((r) => ({ ...r, email: displayEmail(r.email) })) },
      q: q.q ?? '',
      page: q.page,
      isOwner: request.admin?.user.role === 'owner',
    });
  });

  // Export complet (propriétaire) : l'accès est tracé dans le journal d'audit.
  app.get('/clientes/export.csv', { config: { roles: OWNER } }, async (request, reply) => {
    const rows = await repo.findExportRows(app.db);
    await audit(request, 'client.export', { type: 'client', details: { count: rows.length } });
    const today = new Date().toISOString().slice(0, 10);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="clientes-${today}.csv"`);
    return clientsToCsv(rows);
  });

  /** @param {string} id */
  async function clientPage(id) {
    const client = await repo.findClient(app.db, id);
    if (!client || client.anonymizedAt) return null;
    const history = await agenda.findAppointments(app.db, {
      from: new Date('2000-01-01T00:00:00Z'),
      to: new Date('2100-01-01T00:00:00Z'),
      clientId: id,
      limit: 200,
    });
    return { client: { ...client, email: displayEmail(client.email) }, history: history.reverse() };
  }

  // Droit d'accès (RGPD) : export JSON des données d'une cliente, propriétaire uniquement, tracé.
  app.get('/clientes/:id/export.json', { config: { roles: OWNER } }, async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    const data = params.success ? await repo.findClientDataExport(app.db, params.data.id) : null;
    if (!params.success || !data) return reply.callNotFound();
    await audit(request, 'client.export_one', { type: 'client', id: params.data.id });
    return reply
      .header(
        'content-disposition',
        `attachment; filename="donnees-cliente-${params.data.id}.json"`,
      )
      .type('application/json; charset=utf-8')
      .send(JSON.stringify(data, null, 2));
  });

  app.get('/clientes/:id', { config: { roles: ANY } }, async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    const data = params.success ? await clientPage(params.data.id) : null;
    if (!data) return reply.callNotFound();
    return reply.adminPage('admin/cliente', {
      title: `${data.client.firstName} ${data.client.lastName}`,
      section: 'clientes',
      ...data,
      isOwner: request.admin?.user.role === 'owner',
    });
  });

  app.post(
    '/clientes/:id',
    { config: { roles: ANY }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const params = uuidParams.safeParse(request.params);
      const data = params.success ? await clientPage(params.data.id) : null;
      if (!params.success || !data) return reply.callNotFound();
      const body = /** @type {Record<string, any>} */ (request.body ?? {});
      const parsed = clientForm.safeParse(body);
      if (!parsed.success) {
        return reply.code(422).adminPage('admin/cliente', {
          title: `${data.client.firstName} ${data.client.lastName}`,
          section: 'clientes',
          ...data,
          isOwner: request.admin?.user.role === 'owner',
          errors: fieldErrors(parsed.error),
          values: body,
        });
      }
      const f = parsed.data;
      await repo.updateClient(app.db, {
        id: params.data.id,
        firstName: f.firstName,
        lastName: f.lastName,
        phone: f.phone ? normalizePhone(f.phone) : null,
        smsReminders: f.smsReminders,
        notes: f.notes ?? null,
      });
      await audit(request, 'client.update', { type: 'client', id: params.data.id });
      return redirectWith(reply, `/admin/clientes/${params.data.id}`, 'saved');
    },
  );

  // Suppression RGPD : page de confirmation (GET), puis action (POST). Propriétaire uniquement.
  app.get('/clientes/:id/supprimer', { config: { roles: OWNER } }, async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    const data = params.success ? await clientPage(params.data.id) : null;
    if (!data) return reply.callNotFound();
    const upcoming = data.history.filter(
      (a) => ['pending', 'confirmed'].includes(a.status) && a.startsAt > new Date(),
    ).length;
    return reply.adminPage('admin/cliente-supprimer', {
      title: 'Supprimer une cliente',
      section: 'clientes',
      ...data,
      upcoming,
    });
  });

  app.post(
    '/clientes/:id/supprimer',
    { config: { roles: OWNER }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const params = uuidParams.safeParse(request.params);
      const confirmed = confirmForm.safeParse(request.body);
      const data = params.success ? await clientPage(params.data.id) : null;
      if (!params.success || !data) return reply.callNotFound();
      if (!confirmed.success) {
        return reply.code(422).adminPage('admin/cliente-supprimer', {
          title: 'Supprimer une cliente',
          section: 'clientes',
          ...data,
          upcoming: 0,
          errors: { confirm: 'Cochez la case pour confirmer la suppression.' },
        });
      }
      const photos = await withTransaction(app.db, (tx) =>
        repo.anonymizeClient(tx, params.data.id),
      );
      // Fichiers supprimés après la validation de la transaction (les noms sont générés par l'application).
      for (const relative of photos) {
        if (/^(hair|reviews)\/[0-9a-f-]{36}\.webp$/.test(relative)) {
          await rm(path.join(config.booking.uploadDir, relative), { force: true });
        }
      }
      // Pas de nom ni d'email dans le journal : seulement l'identifiant technique.
      await audit(request, 'client.anonymize', { type: 'client', id: params.data.id });
      return redirectWith(reply, '/admin/clientes', 'anonymized');
    },
  );
}
