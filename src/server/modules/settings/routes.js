// @ts-check
/**
 * Routes admin des réglages (propriétaire uniquement) : réservation (délais, politique),
 * horaires, fermetures et congés, coordonnées. Les réglages d'infrastructure (fournisseur de
 * réservation, lien Fresha, lien avis Google, envoi des messages) restent dans l'environnement
 * du serveur : ils sont affichés ici en lecture seule.
 */
import { OWNER } from '../admin/guard.js';
import { redirectWith } from '../admin/nav.js';
import { check, field, row, toValues } from '../admin/forms.js';
import { audit } from '../audit/service.js';
import { fieldErrors } from '../auth/schemas.js';
import { idParams } from '../agenda/schemas.js';
import { withTransaction } from '../../db/pool.js';
import * as repo from './repo.js';
import {
  WEEKDAYS,
  bookingSettingsForm,
  closureForm,
  contactForm,
  hoursForm,
  hoursToText,
  hoursToValues,
  parseHours,
  parseHoursText,
} from './schemas.js';
import { site as defaultSite } from '../../lib/site.js';

const BOOKING_KEYS = [
  'booking.min_notice_hours',
  'booking.horizon_days',
  'booking.cancellation_hours',
  'booking.manual_validation',
  'booking.slot_step_minutes',
  'booking.long_service_minutes',
  'booking.policy_text',
];

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ config: import('../../config.js').AppConfig }} options
 */
export default async function settingsRoutes(app, { config }) {
  const opts = { config: { roles: OWNER } };
  const post = { config: { roles: OWNER }, preHandler: app.csrfProtection };

  app.get('/reglages', opts, async (_request, reply) =>
    reply.adminPage('admin/reglages', {
      title: 'Réglages',
      section: 'reglages',
      infra: {
        provider:
          config.booking.provider === 'internal' ? 'Réservation sur le site' : 'Lien Fresha',
        fresha: config.booking.freshaUrl || '—',
        google: config.reviews.googleUrl || '—',
        notifications:
          config.notifications.provider === 'brevo'
            ? 'Brevo (envois réels)'
            : 'Console (aucun envoi)',
        ownerEmail: config.notifications.ownerEmail || '—',
      },
    }),
  );

  // ─── Réservation ───────────────────────────────────────────────────────────
  const bookingFields = [
    row(
      field('minNoticeHours', 'Délai minimum avant un rendez-vous (h)', {
        type: 'number',
        inputmode: 'numeric',
        min: 0,
      }),
      field('horizonDays', 'Réservable jusqu’à (jours)', {
        type: 'number',
        inputmode: 'numeric',
        min: 7,
      }),
    ),
    row(
      field('cancellationHours', 'Annulation gratuite jusqu’à (h avant)', {
        type: 'number',
        inputmode: 'numeric',
        min: 0,
      }),
      field('slotStepMinutes', 'Pas entre deux créneaux (min)', {
        type: 'number',
        inputmode: 'numeric',
        hint: '15, 20, 30, 45 ou 60.',
      }),
    ),
    field('longServiceMinutes', 'Prestation « longue » à partir de (min)', {
      type: 'number',
      inputmode: 'numeric',
      hint: 'Une prestation aussi longue peut traverser la pause de midi.',
    }),
    check('manualValidation', 'Je valide moi-même chaque rendez-vous', {
      hint: 'Les demandes arrivent « à valider » sur le tableau de bord.',
    }),
    field('policyText', 'Politique de rendez-vous (texte affiché aux clientes)', {
      type: 'textarea',
      rows: 6,
      maxlength: 1500,
    }),
  ];

  /** @param {Record<string, any>} s */
  const bookingValues = (s) =>
    toValues({
      minNoticeHours: s['booking.min_notice_hours'] ?? 24,
      horizonDays: s['booking.horizon_days'] ?? 60,
      cancellationHours: s['booking.cancellation_hours'] ?? 48,
      slotStepMinutes: s['booking.slot_step_minutes'] ?? 30,
      longServiceMinutes: s['booking.long_service_minutes'] ?? 240,
      manualValidation: s['booking.manual_validation'] === true,
      policyText: s['booking.policy_text'] ?? '',
    });

  /** @param {import('fastify').FastifyReply} reply @param {Record<string, unknown>} data */
  const formPage = (reply, data) =>
    reply.adminPage('admin/formulaire', {
      section: 'reglages',
      backHref: '/admin/reglages',
      backLabel: 'Réglages',
      ...data,
    });

  app.get('/reglages/reservation', opts, async (_request, reply) =>
    formPage(reply, {
      title: 'Réservation',
      lead: 'Ces réglages s’appliquent aussitôt à la réservation en ligne.',
      action: '/admin/reglages/reservation',
      fields: bookingFields,
      values: bookingValues(await repo.getSettings(app.db, BOOKING_KEYS)),
    }),
  );

  app.post('/reglages/reservation', post, async (request, reply) => {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = bookingSettingsForm.safeParse(body);
    if (!parsed.success) {
      return formPage(reply.code(422), {
        title: 'Réservation',
        action: '/admin/reglages/reservation',
        fields: bookingFields,
        values: body,
        errors: fieldErrors(parsed.error),
      });
    }
    const s = parsed.data;
    await withTransaction(app.db, async (tx) => {
      await repo.upsertSetting(tx, 'booking.min_notice_hours', s.minNoticeHours);
      await repo.upsertSetting(tx, 'booking.horizon_days', s.horizonDays);
      await repo.upsertSetting(tx, 'booking.cancellation_hours', s.cancellationHours);
      await repo.upsertSetting(tx, 'booking.slot_step_minutes', s.slotStepMinutes);
      await repo.upsertSetting(tx, 'booking.long_service_minutes', s.longServiceMinutes);
      await repo.upsertSetting(tx, 'booking.manual_validation', s.manualValidation);
      await repo.upsertSetting(tx, 'booking.policy_text', s.policyText);
    });
    await audit(request, 'settings.update', { type: 'settings', id: 'booking' });
    return redirectWith(reply, '/admin/reglages', 'saved');
  });

  // ─── Horaires hebdomadaires ────────────────────────────────────────────────
  app.get('/reglages/horaires', opts, async (_request, reply) =>
    reply.adminPage('admin/horaires', {
      title: 'Horaires d’ouverture',
      section: 'reglages',
      weekdays: WEEKDAYS,
      values: hoursToValues(await repo.findWeeklyHours(app.db)),
    }),
  );

  app.post('/reglages/horaires', post, async (request, reply) => {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = hoursForm.safeParse(body);
    const { ranges, errors } = parsed.success
      ? parseHours(parsed.data)
      : { ranges: [], errors: { _form: 'Horaires invalides.' } };
    // Un enregistrement vide fermerait le salon à toute réservation : on exige au moins une plage.
    if (parsed.success && ranges.length === 0 && Object.keys(errors).length === 0) {
      errors._form = 'Indiquez au moins une plage d’ouverture.';
    }
    if (!parsed.success || Object.keys(errors).length) {
      return reply.code(422).adminPage('admin/horaires', {
        title: 'Horaires d’ouverture',
        section: 'reglages',
        weekdays: WEEKDAYS,
        values: body,
        errors,
      });
    }
    const staffIds = await repo.findActiveStaffIds(app.db);
    await withTransaction(app.db, (tx) => repo.replaceWeeklyHours(tx, staffIds, ranges));
    await audit(request, 'hours.update', { type: 'hours', details: { ranges: ranges.length } });
    return redirectWith(reply, '/admin/reglages', 'saved');
  });

  // ─── Fermetures et congés ──────────────────────────────────────────────────
  /** @param {Record<string, unknown>} [extra] */
  async function closuresPage(extra = {}) {
    return {
      title: 'Congés et fermetures',
      section: 'reglages',
      closures: await repo.findClosures(app.db),
      values: {},
      errors: {},
      ...extra,
    };
  }

  app.get('/reglages/fermetures', opts, async (request, reply) =>
    reply.adminPage(
      'admin/fermetures',
      await closuresPage({ impact: Number(/** @type {any} */ (request.query)?.impact) || 0 }),
    ),
  );

  app.post('/reglages/fermetures', post, async (request, reply) => {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = closureForm.safeParse(body);
    if (!parsed.success) {
      return reply
        .code(422)
        .adminPage(
          'admin/fermetures',
          await closuresPage({ values: body, errors: fieldErrors(parsed.error) }),
        );
    }
    const c = parsed.data;
    const impacted =
      c.kind === 'closed' ? await repo.countAppointmentsBetween(app.db, c.startsOn, c.endsOn) : 0;
    const id = await repo.insertClosure(app.db, {
      kind: c.kind,
      startsOn: c.startsOn,
      endsOn: c.endsOn,
      opens: c.kind === 'special_hours' ? c.opens : null,
      closes: c.kind === 'special_hours' ? c.closes : null,
      reason: c.reason || null,
    });
    await audit(request, 'closure.create', {
      type: 'closure',
      id,
      details: { kind: c.kind, from: c.startsOn, to: c.endsOn, impacted },
    });
    // Les rendez-vous déjà posés ne sont jamais annulés automatiquement : on prévient.
    return reply.redirect(
      `/admin/reglages/fermetures?ok=created${impacted ? `&impact=${impacted}` : ''}`,
      303,
    );
  });

  app.post('/reglages/fermetures/:id/supprimer', post, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(422).send({ error: 'validation' });
    if (!(await repo.deleteClosure(app.db, params.data.id))) return reply.callNotFound();
    await audit(request, 'closure.delete', { type: 'closure', id: params.data.id });
    return redirectWith(reply, '/admin/reglages/fermetures', 'deleted');
  });

  // ─── Coordonnées et réseaux ────────────────────────────────────────────────
  const contactFields = [
    field('street', 'Adresse', { autocomplete: 'off' }),
    row(
      field('postalCode', 'Code postal', { inputmode: 'numeric', maxlength: 5 }),
      field('city', 'Ville'),
    ),
    row(
      field('phone', 'Téléphone', { type: 'tel', required: false, inputmode: 'tel' }),
      field('whatsapp', 'WhatsApp', { type: 'tel', required: false, inputmode: 'tel' }),
    ),
    field('instagram', 'Lien Instagram', {
      required: false,
      hint: 'Ex. https://instagram.com/atelierdeslocks',
    }),
    field('hours', 'Horaires affichés sur le site (pied de page, page contact)', {
      type: 'textarea',
      rows: 4,
      required: false,
      hint: 'Une ligne par période : « Mardi – vendredi | 9h30 – 19h ». C’est un affichage : les créneaux réservables viennent des horaires d’ouverture.',
    }),
  ];

  app.get('/reglages/coordonnees', opts, async (_request, reply) => {
    const { 'site.contact': saved } = await repo.getSettings(app.db, ['site.contact']);
    const contact = saved ?? {};
    return formPage(reply, {
      title: 'Coordonnées et réseaux',
      action: '/admin/reglages/coordonnees',
      fields: contactFields,
      values: toValues({
        street: contact.street ?? defaultSite.address.street,
        postalCode: contact.postalCode ?? defaultSite.address.postalCode,
        city: contact.city ?? defaultSite.address.city,
        phone: contact.phone ?? '',
        whatsapp: contact.whatsapp ?? '',
        instagram: contact.instagram ?? '',
        hours: hoursToText(contact.hours ?? defaultSite.hours),
      }),
    });
  });

  app.post('/reglages/coordonnees', post, async (request, reply) => {
    const body = /** @type {Record<string, any>} */ (request.body ?? {});
    const parsed = contactForm.safeParse(body);
    if (!parsed.success) {
      return formPage(reply.code(422), {
        title: 'Coordonnées et réseaux',
        action: '/admin/reglages/coordonnees',
        fields: contactFields,
        values: body,
        errors: fieldErrors(parsed.error),
      });
    }
    const c = parsed.data;
    await repo.upsertSetting(app.db, 'site.contact', { ...c, hours: parseHoursText(c.hours) });
    await audit(request, 'settings.update', { type: 'settings', id: 'contact' });
    return redirectWith(reply, '/admin/reglages', 'saved');
  });
}
