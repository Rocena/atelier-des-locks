// @ts-check
/**
 * Routes admin de l'agenda : vues, rendez-vous (création manuelle, détail, statut, notes,
 * déplacement), photo des cheveux, blocages. Validation → service → réponse.
 * Accessibles à la propriétaire et à l'équipe (rôles ANY).
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { ANY } from '../admin/guard.js';
import { redirectWith } from '../admin/nav.js';
import { audit } from '../audit/service.js';
import { fieldErrors } from '../auth/schemas.js';
import { utcToZoned, zonedToUtc } from '../../lib/zoned-time.js';
import { findBookingSettings } from '../booking/repo.js';
import { displayEmail } from '../clients/placeholder.js';
import {
  AGENDA_MESSAGES,
  AGENDA_STATUS,
  AgendaError,
  TRANSITIONS,
  addBlock,
  changeStatus,
  createManual,
  loadAgenda,
  manualFormData,
  moveAppointment,
  moveSlots,
} from './service.js';
import * as repo from './repo.js';
import {
  agendaQuery,
  blockForm,
  idParams,
  manualForm,
  moveForm,
  notesForm,
  slotsQuery,
  statusForm,
  uuidParams,
} from './schemas.js';

/** Photo d'un RDV : nom généré par l'application (UUID.webp), jamais fourni par un utilisateur. */
const PHOTO_RE = /^(hair|reviews)\/[0-9a-f-]{36}\.webp$/;

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ config: import('../../config.js').AppConfig, now: () => Date }} options
 */
export default async function agendaRoutes(app, { config, now }) {
  const deps = { notifications: app.notifications };
  const wantsJson = (/** @type {import('fastify').FastifyRequest} */ request) =>
    request.headers.accept?.includes('application/json') === true;

  /**
   * Erreur métier de l'agenda : JSON pour le glisser-déposer, page sinon.
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} reply
   * @param {unknown} error
   * @param {() => any} [render]
   */
  function failure(request, reply, error, render) {
    if (!(error instanceof AgendaError)) throw error;
    const status = AGENDA_STATUS[error.code] ?? 400;
    const message = AGENDA_MESSAGES[error.code];
    if (wantsJson(request)) return reply.code(status).send({ error: error.code, message });
    if (!render) return backWithError(reply, request, error.code);
    return render();
  }

  /**
   * Formulaire classique : retour sur la fiche du rendez-vous avec le message (jamais de JSON brut).
   * @param {import('fastify').FastifyReply} reply
   * @param {import('fastify').FastifyRequest} request
   * @param {string} code
   */
  function backWithError(reply, request, code) {
    const id = /** @type {{ id?: string }} */ (request.params).id;
    const target = id ? `/admin/agenda/rdv/${id}` : '/admin/agenda';
    return reply.redirect(
      `${target}?erreur=${encodeURIComponent(code)}${request.url.includes('/deplacer') ? '&deplacer=1#deplacer' : ''}`,
      303,
    );
  }

  // ─── Vues ──────────────────────────────────────────────────────────────────
  app.get('/agenda', { config: { roles: ANY } }, async (request, reply) => {
    const q = agendaQuery.parse(request.query);
    const settings = await findBookingSettings(app.db);
    const today = utcToZoned(now(), settings.timeZone).date;
    const agenda = await loadAgenda(app.db, {
      view: q.vue,
      date: q.date ?? today,
      timeZone: settings.timeZone,
      now: now(),
    });
    return reply.adminPage('admin/agenda', { title: 'Agenda', section: 'agenda', agenda });
  });

  // ─── Rendez-vous saisi par le salon ────────────────────────────────────────
  /** @param {import('fastify').FastifyRequest} request @param {Record<string, unknown>} [extra] */
  async function newAppointmentPage(request, extra = {}) {
    const data = await manualFormData(app.db);
    const q = /** @type {Record<string, string>} */ (request.query ?? {});
    const today = utcToZoned(now(), data.settings.timeZone).date;
    return {
      title: 'Nouveau rendez-vous',
      section: 'agenda',
      ...data,
      today,
      values: { date: q.date ?? today, time: q.time ?? '', ...(extra.values ?? {}) },
      ...extra,
    };
  }

  app.get('/agenda/rdv/nouveau', { config: { roles: ANY } }, async (request, reply) =>
    reply.adminPage('admin/rdv-nouveau', await newAppointmentPage(request)),
  );

  app.post(
    '/agenda/rdv',
    { config: { roles: ANY }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const body = /** @type {Record<string, any>} */ (request.body ?? {});
      const parsed = manualForm.safeParse(body);
      if (!parsed.success) {
        return reply
          .code(422)
          .adminPage(
            'admin/rdv-nouveau',
            await newAppointmentPage(request, { errors: fieldErrors(parsed.error), values: body }),
          );
      }
      try {
        const { id } = await createManual(app.db, deps, parsed.data, now());
        await audit(request, 'appointment.create', {
          type: 'appointment',
          id,
          details: { notify: parsed.data.notify, completed: parsed.data.completed },
        });
        return redirectWith(reply, `/admin/agenda/rdv/${id}`, 'created');
      } catch (error) {
        return failure(request, reply, error, async () =>
          reply.code(AGENDA_STATUS[/** @type {AgendaError} */ (error).code] ?? 400).adminPage(
            'admin/rdv-nouveau',
            await newAppointmentPage(request, {
              errors: { _form: AGENDA_MESSAGES[/** @type {AgendaError} */ (error).code] },
              values: body,
            }),
          ),
        );
      }
    },
  );

  // ─── Fiche d'un rendez-vous ────────────────────────────────────────────────
  app.get('/agenda/rdv/:id', { config: { roles: ANY } }, async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    const appointment = params.success ? await repo.findAppointment(app.db, params.data.id) : null;
    if (!appointment) return reply.callNotFound();
    const settings = await findBookingSettings(app.db);
    const q = slotsQuery.parse(request.query);
    const startDate = utcToZoned(appointment.startsAt, settings.timeZone).date;
    const movable = ['pending', 'confirmed'].includes(appointment.status);
    const wantsMove = movable && /** @type {any} */ (request.query)?.deplacer === '1';
    const date =
      q.date ??
      (appointment.startsAt > now() ? startDate : utcToZoned(now(), settings.timeZone).date);
    const slots = wantsMove
      ? await moveSlots(app.db, { id: appointment.id, date, now: now() })
      : [];
    return reply.adminPage('admin/rdv', {
      title: `${appointment.firstName} ${appointment.lastName}`,
      section: 'agenda',
      appointment: { ...appointment, email: displayEmail(appointment.email) },
      transitions: TRANSITIONS[appointment.status] ?? [],
      movable,
      wantsMove,
      moveDate: date,
      slots,
      error: AGENDA_MESSAGES[String(/** @type {any} */ (request.query)?.erreur)] ?? null,
      timeZone: settings.timeZone,
      startDate,
      minDate: utcToZoned(now(), settings.timeZone).date,
      waNumber: appointment.phone ? appointment.phone.replace(/\D/g, '') : null,
    });
  });

  app.post(
    '/agenda/rdv/:id/statut',
    { config: { roles: ANY }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const params = uuidParams.safeParse(request.params);
      const parsed = statusForm.safeParse(request.body);
      if (!params.success || !parsed.success) return reply.code(422).send({ error: 'validation' });
      const back = `/admin/agenda/rdv/${params.data.id}`;
      try {
        const { previous } = await changeStatus(app.db, deps, {
          id: params.data.id,
          ...parsed.data,
          now: now(),
        });
        await audit(request, 'appointment.status', {
          type: 'appointment',
          id: params.data.id,
          details: { from: previous, to: parsed.data.status, notify: parsed.data.notify },
        });
        return redirectWith(reply, back, 'status');
      } catch (error) {
        return failure(request, reply, error);
      }
    },
  );

  app.post(
    '/agenda/rdv/:id/notes',
    { config: { roles: ANY }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const params = uuidParams.safeParse(request.params);
      const parsed = notesForm.safeParse(request.body);
      if (!params.success || !parsed.success) return reply.code(422).send({ error: 'validation' });
      if (!(await repo.findAppointment(app.db, params.data.id))) return reply.callNotFound();
      await repo.updateInternalNotes(app.db, params.data.id, parsed.data.notes ?? null);
      await audit(request, 'appointment.notes', { type: 'appointment', id: params.data.id });
      return redirectWith(reply, `/admin/agenda/rdv/${params.data.id}`, 'saved');
    },
  );

  app.post(
    '/agenda/rdv/:id/deplacer',
    { config: { roles: ANY }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const params = uuidParams.safeParse(request.params);
      const parsed = moveForm.safeParse(request.body);
      if (!params.success || !parsed.success) {
        return reply.code(422).send({ error: 'validation', message: 'Date invalide.' });
      }
      const { timeZone } = await findBookingSettings(app.db);
      const startsAt =
        parsed.data.startsAt ??
        zonedToUtc(
          /** @type {string} */ (parsed.data.date),
          /** @type {string} */ (parsed.data.time),
          timeZone,
        );
      try {
        await moveAppointment(app.db, deps, {
          id: params.data.id,
          startsAt,
          notify: parsed.data.notify,
          now: now(),
        });
        await audit(request, 'appointment.move', {
          type: 'appointment',
          id: params.data.id,
          details: { to: startsAt.toISOString(), notify: parsed.data.notify },
        });
        if (wantsJson(request)) return { ok: true, notified: parsed.data.notify };
        return redirectWith(
          reply,
          `/admin/agenda/rdv/${params.data.id}`,
          parsed.data.notify ? 'moved' : 'moved_silent',
        );
      } catch (error) {
        return failure(request, reply, error);
      }
    },
  );

  // Photo des cheveux : visible uniquement par un compte connecté, jamais en cache public.
  app.get('/agenda/rdv/:id/photo', { config: { roles: ANY } }, async (request, reply) => {
    const params = uuidParams.safeParse(request.params);
    const relative = params.success ? await repo.findHairPhotoPath(app.db, params.data.id) : null;
    if (!relative || !PHOTO_RE.test(relative)) return reply.callNotFound();
    const file = path.resolve(config.booking.uploadDir, relative);
    try {
      await stat(file);
    } catch {
      return reply.callNotFound();
    }
    reply.header('Content-Type', 'image/webp');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(createReadStream(file));
  });

  // ─── Blocages ──────────────────────────────────────────────────────────────
  /** @param {import('fastify').FastifyRequest} request @param {Record<string, unknown>} [extra] */
  async function blockPage(request, extra = {}) {
    const settings = await findBookingSettings(app.db);
    const q = /** @type {Record<string, string>} */ (request.query ?? {});
    const today = utcToZoned(now(), settings.timeZone).date;
    const from = new Date(Date.now() - 1);
    const blocks = await repo.findBlocks(app.db, from, new Date(from.getTime() + 365 * 86_400_000));
    return {
      title: 'Bloquer un créneau',
      section: 'agenda',
      today,
      blocks: blocks.map((b) => ({
        ...b,
        date: utcToZoned(b.startsAt, settings.timeZone).date,
      })),
      values: { date: q.date ?? today, startTime: q.time ?? '', ...(extra.values ?? {}) },
      ...extra,
    };
  }

  app.get('/agenda/blocages', { config: { roles: ANY } }, async (request, reply) =>
    reply.adminPage('admin/blocages', await blockPage(request)),
  );

  app.post(
    '/agenda/blocages',
    { config: { roles: ANY }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const body = /** @type {Record<string, any>} */ (request.body ?? {});
      const parsed = blockForm.safeParse(body);
      if (!parsed.success) {
        return reply
          .code(422)
          .adminPage(
            'admin/blocages',
            await blockPage(request, { errors: fieldErrors(parsed.error), values: body }),
          );
      }
      const settings = await findBookingSettings(app.db);
      try {
        const { id } = await addBlock(app.db, {
          ...parsed.data,
          userId: /** @type {NonNullable<typeof request.admin>} */ (request.admin).user.id,
          timeZone: settings.timeZone,
        });
        await audit(request, 'block.create', {
          type: 'block',
          id,
          details: { date: parsed.data.date, from: parsed.data.startTime, to: parsed.data.endTime },
        });
        return redirectWith(reply, `/admin/agenda?date=${parsed.data.date}`, 'blocked');
      } catch (error) {
        return failure(request, reply, error, async () =>
          reply.code(AGENDA_STATUS[/** @type {AgendaError} */ (error).code] ?? 400).adminPage(
            'admin/blocages',
            await blockPage(request, {
              errors: { _form: AGENDA_MESSAGES[/** @type {AgendaError} */ (error).code] },
              values: body,
            }),
          ),
        );
      }
    },
  );

  app.post(
    '/agenda/blocages/:id/supprimer',
    { config: { roles: ANY }, preHandler: app.csrfProtection },
    async (request, reply) => {
      const params = idParams.safeParse(request.params);
      if (!params.success) return reply.code(422).send({ error: 'validation' });
      if (!(await repo.deleteBlock(app.db, params.data.id))) return reply.callNotFound();
      await audit(request, 'block.delete', { type: 'block', id: params.data.id });
      return redirectWith(reply, '/admin/agenda/blocages', 'unblocked');
    },
  );
}
