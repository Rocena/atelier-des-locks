// @ts-check
/**
 * Routes de la réservation (§7) : tunnel /reserver, API JSON, « Gérer mon RDV », calendriers.
 * Aucune logique ici : validation (schemas.js) → service.js → réponse.
 *
 * Adaptateur BOOKING_PROVIDER :
 *   - internal    : tunnel et API actifs ;
 *   - fresha_link : /reserver redirige vers Fresha, l'API de création répond 404. Les liens
 *     « Gérer mon RDV » déjà envoyés restent utilisables (RDV pris avant la bascule).
 */
import { site } from '../../lib/site.js';
import { fmt } from '../../lib/format.js';
import { addDays, utcToZoned, weekdayOf } from '../../lib/zoned-time.js';
import { createChallenge, createVerifier } from './anti-bot.js';
import { MAX_PHOTO_BYTES, UploadError, removePhoto, sanitizePhoto, storePhoto } from './upload.js';
import {
  HAIR_STATES,
  bookingForm,
  cancelBody,
  feedParams,
  rescheduleBody,
  slotsQuery,
  tokenParams,
} from './schemas.js';
import { safeEqual } from './tokens.js';
import * as booking from './service.js';
import { findCatalog } from '../services/repo.js';

/** Messages d'erreur affichés à la cliente (vouvoiement). */
const MESSAGES = {
  not_found: 'Cette prestation n’existe pas ou plus.',
  not_bookable: 'Cette prestation se réserve après un échange avec le salon.',
  invalid_options: 'Une option choisie n’est plus disponible. Rechargez la page.',
  slot_taken: 'Ce créneau vient d’être pris. Choisissez-en un autre.',
  bad_range: 'Période demandée invalide.',
  too_late: 'Le délai pour modifier ce rendez-vous en ligne est dépassé. Appelez le salon.',
  inactive: 'Ce rendez-vous ne peut plus être modifié.',
  past: 'Ce rendez-vous est passé.',
  too_many: 'Vous avez déjà plusieurs rendez-vous à venir. Appelez le salon pour en ajouter un.',
  bot_check: 'La vérification anti-robot a échoué. Rechargez la page et réessayez.',
  rejected: 'Votre demande n’a pas pu être envoyée.',
  validation: 'Certains champs sont à corriger.',
  photo_too_large: 'La photo dépasse 8 Mo. Choisissez une image plus légère.',
  photo_bad_type: 'La photo doit être au format JPEG, PNG ou WebP.',
  photo_unreadable: 'Cette photo est illisible. Essayez une autre image.',
  rate_limited: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
};

/** Codes HTTP des erreurs métier. */
const STATUS = {
  not_found: 404,
  not_bookable: 422,
  invalid_options: 422,
  slot_taken: 409,
  bad_range: 400,
  too_late: 403,
  inactive: 403,
  past: 403,
  too_many: 429,
};

/** @param {import('fastify').FastifyReply} reply */
function privatePage(reply) {
  // Pages à jeton : jamais en cache, jamais indexées, jeton jamais transmis en Referer.
  reply.header('Cache-Control', 'no-store');
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('Referrer-Policy', 'no-referrer');
}

/**
 * Lundi de la semaine d'une date locale.
 * @param {string} date
 */
const mondayOf = (date) => addDays(date, 1 - weekdayOf(date));

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ config: import('../../config.js').AppConfig, now?: () => Date }} options
 */
export default async function bookingRoutes(app, { config, now = () => new Date() }) {
  const internal = config.booking.provider === 'internal';
  const powKey = `anti-bot:${config.sessionSecret}`;
  const verifyPow = createVerifier({ key: powKey });
  const rateLimitResponse = () => ({
    statusCode: 429,
    error: 'rate_limited',
    message: MESSAGES.rate_limited,
  });
  /** @param {number} max @param {string} timeWindow */
  const limit = (max, timeWindow) => ({
    rateLimit: { max, timeWindow, errorResponseBuilder: rateLimitResponse },
  });

  /**
   * Réponse d'erreur métier JSON.
   * @param {import('fastify').FastifyReply} reply
   * @param {unknown} error
   */
  function bookingFailure(reply, error) {
    if (error instanceof booking.BookingError) {
      return reply
        .code(STATUS[error.code] ?? 400)
        .send({ error: error.code, message: MESSAGES[error.code] });
    }
    throw error;
  }

  // ─── Tunnel ────────────────────────────────────────────────────────────────
  if (!internal) {
    app.get('/reserver', (_request, reply) => reply.redirect(config.booking.freshaUrl, 302));
  } else {
    app.get('/reserver', async (request, reply) => {
      const { services, settings, staffCount } = await booking.bookingCatalog(app.db);
      const { categories } = await findCatalog(app.db);
      const today = utcToZoned(now(), settings.timeZone).date;
      // Données du tunnel, lues par le JS (JSON dans un <script type="application/json">).
      const data = {
        categories: categories.map((c) => ({ slug: c.slug, name: c.name })),
        services: services.map((s) => ({
          slug: s.slug,
          name: s.name,
          category: s.category,
          summary: s.summary,
          durationMin: s.durationMin,
          durationMax: s.durationMax,
          price: s.price,
          priceFrom: s.priceFrom,
          onQuote: s.onQuote,
          bookable: s.bookableOnline && !s.onQuote,
          allergyTest: s.allergyTest,
          options: s.options.map(({ id, label, price, extraMinutes }) => ({
            id,
            label,
            price,
            extraMinutes,
          })),
        })),
        today,
        lastDate: addDays(today, settings.horizonDays),
        cancellationHours: settings.cancellationHours,
        manualValidation: settings.manualValidation,
        maxPhotoBytes: MAX_PHOTO_BYTES,
      };
      return reply.page('pages/reserver', 'booking', {
        title: 'Réserver un rendez-vous · L’Atelier des Locks',
        description:
          'Réservez votre rendez-vous locks à Toulouse en quatre étapes : prestation, créneau, coordonnées, confirmation.',
        catalog: data,
        bookingJson: JSON.stringify(data).replaceAll('<', '\\u003c'),
        csrfToken: reply.generateCsrf(),
        hairStates: HAIR_STATES,
        policyText: settings.policyText,
        staffCount,
        preselect: /^[a-z0-9-]{1,80}$/.test(String(/** @type {any} */ (request.query)?.prestation))
          ? String(/** @type {any} */ (request.query).prestation)
          : '',
      });
    });

    // ─── API ───────────────────────────────────────────────────────────────────
    app.get('/api/booking/slots', { config: limit(120, '1 minute') }, async (request, reply) => {
      const parsed = slotsQuery.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', message: MESSAGES.bad_range });
      }
      const q = parsed.data;
      try {
        reply.header('Cache-Control', 'no-store');
        return await booking.getSlots(app.db, {
          slug: q.service,
          optionIds: q.options,
          from: q.from,
          to: q.to,
          now: now(),
        });
      } catch (error) {
        return bookingFailure(reply, error);
      }
    });

    app.get(
      '/api/booking/challenge',
      { config: limit(30, '1 minute') },
      async (_request, reply) => {
        reply.header('Cache-Control', 'no-store');
        return createChallenge({ key: powKey, now: now(), maxNumber: 20_000 });
      },
    );

    app.post(
      '/api/booking/appointments',
      {
        config: limit(config.booking.rateLimit, '10 minutes'),
        preHandler: app.csrfProtection,
      },
      async (request, reply) => {
        if (!request.isMultipart()) {
          return reply.code(415).send({ error: 'rejected', message: MESSAGES.rejected });
        }
        /** @type {Record<string, string|string[]>} */
        const fields = {};
        /** @type {Buffer|null} */
        let photo = null;
        try {
          for await (const part of request.parts()) {
            if (part.type === 'file') {
              const buffer = await part.toBuffer();
              if (part.fieldname === 'photo' && buffer.length > 0) photo = buffer;
            } else if (typeof part.value === 'string') {
              const previous = fields[part.fieldname];
              fields[part.fieldname] =
                previous === undefined
                  ? part.value
                  : [...(Array.isArray(previous) ? previous : [previous]), part.value];
            }
          }
        } catch (error) {
          if (/** @type {any} */ (error)?.code === 'FST_REQ_FILE_TOO_LARGE') {
            return reply.code(413).send({
              error: 'validation',
              message: MESSAGES.photo_too_large,
              fields: { photo: MESSAGES.photo_too_large },
            });
          }
          return reply.code(400).send({ error: 'rejected', message: MESSAGES.rejected });
        }

        const parsed = bookingForm.safeParse(fields);
        if (!parsed.success) {
          /** @type {Record<string, string>} */
          const fieldErrors = {};
          for (const issue of parsed.error.issues) {
            const key = String(issue.path[0] ?? 'form');
            fieldErrors[key] ??= issue.message.startsWith('Invalid')
              ? 'Ce champ est à vérifier.'
              : issue.message;
          }
          return reply
            .code(422)
            .send({ error: 'validation', message: MESSAGES.validation, fields: fieldErrors });
        }
        const form = parsed.data;
        // Pot de miel rempli : robot. Réponse volontairement neutre.
        if (form.website) {
          request.log.warn({ event: 'booking.honeypot' }, 'pot de miel rempli');
          return reply.code(422).send({ error: 'rejected', message: MESSAGES.rejected });
        }
        if (!verifyPow(form.altcha, now())) {
          return reply.code(422).send({ error: 'bot_check', message: MESSAGES.bot_check });
        }

        /** @type {string|null} */
        let photoPath = null;
        if (photo) {
          try {
            photoPath = await storePhoto(config.booking.uploadDir, await sanitizePhoto(photo));
          } catch (error) {
            if (error instanceof UploadError) {
              const message = MESSAGES[`photo_${error.code}`];
              return reply
                .code(422)
                .send({ error: 'validation', message, fields: { photo: message } });
            }
            throw error;
          }
        }

        try {
          const result = await booking.createAppointment(app.db, { form, photoPath, now: now() });
          const a = result.appointment;
          // Lien relatif : la page est déjà sur le bon domaine (les emails, eux, utiliseront PUBLIC_URL).
          const manageUrl = `/rdv/${result.token}`;
          // Confirmation, alerte propriétaire et rappels (§7.6). Jamais de donnée personnelle dans les logs.
          request.log.info({ event: 'appointment.created', appointmentId: a.id }, 'RDV créé');
          await app.notifications.appointmentBooked({ appointmentId: a.id, token: result.token });
          return reply.code(201).send({
            status: a.status,
            manageUrl,
            icsUrl: `/rdv/${result.token}/rdv.ics`,
            googleUrl: booking.appointmentGoogleUrl(a, { site, publicUrl: config.publicUrl }),
            appointment: {
              serviceName: a.serviceName,
              options: a.options,
              startsAt: a.startsAt.toISOString(),
              dayLabel: fmt.formatDay(a.startsAt),
              timeLabel: fmt.formatTime(a.startsAt),
              durationLabel: fmt.formatDuration(
                result.booking.durationMin,
                result.booking.durationMax,
              ),
              priceLabel:
                a.price == null
                  ? 'Sur devis'
                  : `${a.priceFrom ? 'à partir de ' : ''}${fmt.formatEuro(a.price)}`,
              firstName: a.firstName,
            },
            tips: booking.PREPARATION_TIPS,
            cancellationHours: result.settings.cancellationHours,
          });
        } catch (error) {
          if (photoPath) await removePhoto(config.booking.uploadDir, photoPath);
          return bookingFailure(reply, error);
        }
      },
    );
  }

  // ─── Gérer mon RDV ───────────────────────────────────────────────────────────
  const manageLimit = limit(30, '1 minute');

  /**
   * Charge la vue d'un RDV ; 404 HTML si le jeton est invalide ou expiré.
   * @param {import('fastify').FastifyRequest} request
   * @param {import('fastify').FastifyReply} reply
   */
  async function loadManaged(request, reply) {
    privatePage(reply);
    const params = tokenParams.safeParse(request.params);
    if (!params.success) return null;
    try {
      return {
        token: params.data.token,
        ...(await booking.getManaged(app.db, params.data.token, now())),
      };
    } catch (error) {
      if (error instanceof booking.BookingError) return null;
      throw error;
    }
  }

  /** @param {import('fastify').FastifyReply} reply */
  const linkNotFound = (reply) =>
    reply.code(404).page('pages/rdv-introuvable', 'booking', {
      title: 'Lien expiré ou invalide · L’Atelier des Locks',
      description: 'Ce lien de gestion de rendez-vous n’est plus valable.',
      noindex: true,
    });

  /** @param {NonNullable<Awaited<ReturnType<typeof loadManaged>>>} m */
  const manageView = (m) => ({
    title: 'Votre rendez-vous · L’Atelier des Locks',
    description: 'Consultez, déplacez ou annulez votre rendez-vous.',
    noindex: true,
    token: m.token,
    appointment: m.appointment,
    policy: m.policy,
    policyText: m.settings.policyText,
    cancellationHours: m.settings.cancellationHours,
    dayLabel: fmt.formatDay(m.appointment.startsAt),
    timeLabel: fmt.formatTime(m.appointment.startsAt),
    deadlineLabel: `${fmt.formatDay(m.policy.deadline)} à ${fmt.formatTime(m.policy.deadline)}`,
    googleUrl: booking.appointmentGoogleUrl(m.appointment, { site, publicUrl: config.publicUrl }),
  });

  app.get('/rdv/:token', { config: manageLimit }, async (request, reply) => {
    const m = await loadManaged(request, reply);
    if (!m) return linkNotFound(reply);
    const done = /** @type {any} */ (request.query)?.fait;
    return reply.page('pages/rdv', 'booking', {
      ...manageView(m),
      csrfToken: reply.generateCsrf(),
      done: ['deplace', 'annule', 'cree'].includes(done) ? done : null,
    });
  });

  app.get('/rdv/:token/deplacer', { config: manageLimit }, async (request, reply) => {
    const m = await loadManaged(request, reply);
    if (!m) return linkNotFound(reply);
    if (!m.policy.allowed) return reply.redirect(`/rdv/${m.token}`, 303);
    const tz = m.settings.timeZone;
    const today = utcToZoned(now(), tz).date;
    const lastDate = addDays(today, m.settings.horizonDays);
    const requested = String(/** @type {any} */ (request.query)?.semaine ?? '');
    const week =
      /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested >= mondayOf(today) && requested <= lastDate
        ? mondayOf(requested)
        : mondayOf(today);
    const days = await booking.getRescheduleSlots(app.db, {
      token: m.token,
      from: week,
      to: addDays(week, 6),
      now: now(),
    });
    return reply.page('pages/rdv-deplacer', 'booking', {
      ...manageView(m),
      title: 'Déplacer votre rendez-vous · L’Atelier des Locks',
      csrfToken: reply.generateCsrf(),
      error: /** @type {any} */ (request.query)?.erreur === 'pris' ? MESSAGES.slot_taken : null,
      week,
      previousWeek: week > mondayOf(today) ? addDays(week, -7) : null,
      nextWeek: addDays(week, 7) <= lastDate ? addDays(week, 7) : null,
      days: days.map((d) => ({
        date: d.date,
        label: fmt.formatDay(`${d.date}T12:00:00Z`),
        slots: d.slots.map((s) => ({ value: s.startsAt, label: fmt.formatTime(s.startsAt) })),
      })),
    });
  });

  app.post(
    '/rdv/:token/deplacer',
    { config: manageLimit, preHandler: app.csrfProtection },
    async (request, reply) => {
      privatePage(reply);
      const params = tokenParams.safeParse(request.params);
      const body = rescheduleBody.safeParse(request.body);
      if (!params.success) return linkNotFound(reply);
      const token = params.data.token;
      if (!body.success) return reply.redirect(`/rdv/${token}/deplacer?erreur=pris`, 303);
      try {
        const moved = await booking.reschedule(app.db, {
          token,
          startsAt: body.data.startsAt,
          now: now(),
        });
        await app.notifications.appointmentRescheduled({ appointmentId: moved.id, token });
        request.log.info({ event: 'appointment.rescheduled' }, 'RDV déplacé');
        return reply.redirect(`/rdv/${token}?fait=deplace`, 303);
      } catch (error) {
        if (!(error instanceof booking.BookingError)) throw error;
        if (error.code === 'not_found') return linkNotFound(reply);
        if (error.code === 'slot_taken')
          return reply.redirect(`/rdv/${token}/deplacer?erreur=pris`, 303);
        return reply.redirect(`/rdv/${token}`, 303);
      }
    },
  );

  app.post(
    '/rdv/:token/annuler',
    { config: manageLimit, preHandler: app.csrfProtection },
    async (request, reply) => {
      privatePage(reply);
      const params = tokenParams.safeParse(request.params);
      const body = cancelBody.safeParse(request.body ?? {});
      if (!params.success) return linkNotFound(reply);
      const token = params.data.token;
      try {
        const cancelled = await booking.cancel(app.db, {
          token,
          reason: body.success ? body.data.reason : '',
          now: now(),
        });
        await app.notifications.appointmentCancelled({ appointmentId: cancelled.id, by: 'client' });
        request.log.info({ event: 'appointment.cancelled' }, 'RDV annulé par la cliente');
        return reply.redirect(`/rdv/${token}?fait=annule`, 303);
      } catch (error) {
        if (!(error instanceof booking.BookingError)) throw error;
        if (error.code === 'not_found') return linkNotFound(reply);
        return reply.redirect(`/rdv/${token}`, 303);
      }
    },
  );

  app.get('/rdv/:token/rdv.ics', { config: manageLimit }, async (request, reply) => {
    const m = await loadManaged(request, reply);
    if (!m) return reply.code(404).send({ error: 'Not Found' });
    return reply
      .type('text/calendar; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="rendez-vous-atelier-des-locks.ics"')
      .send(
        booking.appointmentCalendar(m.appointment, {
          manageUrl: `${config.publicUrl}/rdv/${m.token}`,
          site,
          now: now(),
        }),
      );
  });

  // ─── Flux iCal privé de la propriétaire ──────────────────────────────────────
  app.get('/agenda/:token', { config: limit(60, '1 minute') }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    const params = feedParams.safeParse(request.params);
    const secret = config.booking.icalFeedToken;
    const given = params.success ? params.data.token.replace(/\.ics$/, '') : '';
    if (!secret || !given || !safeEqual(given, secret)) {
      return reply.code(404).send({ error: 'Not Found' });
    }
    return reply
      .type('text/calendar; charset=utf-8')
      .send(await booking.ownerFeed(app.db, { site, publicUrl: config.publicUrl, now: now() }));
  });
}
