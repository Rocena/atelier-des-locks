// @ts-check
/**
 * Construction des messages (emails et SMS) à partir de l'état d'un RDV. Fonctions pures :
 * aucun accès base ni réseau, donc testables ligne à ligne.
 *
 * Voix de la marque (BRAND.md) : on vouvoie, phrases courtes, chaleureux et précis.
 * SMS : expéditeur alphanumérique « AtelierLock », 160 caractères GSM maximum, pas de « STOP »
 * (messages transactionnels, §7.6).
 */
import { fmt } from '../../lib/format.js';
import { QUEUES } from './plan.js';
import { renderHtml, renderText } from './email-layout.js';
import { appointmentCalendar } from '../booking/service.js';

/**
 * @typedef {object} MessageContext  état du RDV et de la cliente, lu en base à l'exécution
 * @property {string} appointmentId
 * @property {string} status
 * @property {Date} startsAt
 * @property {number} durationMinutes
 * @property {string} serviceName
 * @property {string[]} options
 * @property {number|null} price
 * @property {boolean} priceFrom
 * @property {string|null} hairState
 * @property {string|null} clientNotes
 * @property {boolean} hasPhoto
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} email
 * @property {string|null} phone
 * @property {boolean} smsReminders
 * @property {boolean} anonymized
 * @property {boolean} hasReview
 * @property {Date} updatedAt
 */

/**
 * @typedef {object} MessageEnv  ce qui vient de la configuration, pas de la base
 * @property {string} publicUrl
 * @property {{ name: string, address: { street: string, postalCode: string, city: string }, phone: string }} site
 * @property {string} ownerEmail
 * @property {string} bookingUrl        lien pour reprendre rendez-vous
 * @property {number} cancellationHours
 * @property {string[]} tips            conseils de préparation
 * @property {string} [googleReviewUrl]
 */

/**
 * @typedef {object} Links
 * @property {string} [manageUrl]  lien « Gérer mon RDV » (absent si le jeton est indisponible)
 * @property {string} [reviewUrl]  lien personnel « Laisser mon avis »
 */

/**
 * Un message prêt à partir.
 * @typedef {object} OutgoingMessage
 * @property {'email'|'sms'} channel
 * @property {string} template      nom journalisé (booking_confirmation, reminder_d2…)
 * @property {string} recipient     email ou numéro E.164 (journalisé : donnée personnelle)
 * @property {string} dedupeKey
 * @property {{ subject: string, html: string, text: string, to: { email: string, name: string }, attachments?: { name: string, contentType: string, content: string }[] } | { text: string, to: string }} payload
 */

// ─── Utilitaires de format ───────────────────────────────────────────────────

const shortDate = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Paris',
});

/** « mar. 1 déc. » @param {Date} instant */
export const formatShortDay = (instant) => shortDate.format(instant);

/** « Mardi 1er décembre 2026 » : jour en tête en majuscule. @param {Date} instant */
const longDay = (instant) => {
  const text = fmt.formatDay(instant);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** @param {MessageContext} ctx */
function priceLabel(ctx) {
  if (ctx.price == null) return 'Sur devis';
  return `${ctx.priceFrom ? 'à partir de ' : ''}${fmt.formatEuro(ctx.price)}`;
}

/** @param {MessageEnv} env */
const addressLine = (env) =>
  `${env.site.address.street}, ${env.site.address.postalCode} ${env.site.address.city}`;

/**
 * Remplace ce que le jeu de caractères GSM 7 bits ne sait pas coder (sinon l'opérateur passe en
 * UCS-2 et la limite tombe à 70 caractères) : lettres accentuées absentes de GSM, apostrophe
 * typographique, espaces insécables.
 * @param {string} text
 */
export function toGsm(text) {
  // Lettres accentuées présentes dans l'alphabet GSM 7 bits : on les garde telles quelles.
  const GSM_KEEP = 'éèùìòÇØøÅåÄÖÑÜäöñüà';
  return [
    ...text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d\u00ab\u00bb]/g, '"')
      .replace(/[\u00a0\u202f]/g, ' '),
  ]
    .map((ch) => (GSM_KEEP.includes(ch) ? ch : ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
    .join('')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...');
}

/** Longueur maximale d'un SMS à un seul segment. */
export const SMS_MAX = 160;

/**
 * SMS : transcodé GSM, jamais plus de 160 caractères. Si le texte dépasse, on retire d'abord le
 * contexte (jamais le lien, qui est l'utilité du message).
 * @param {string} head  début du message
 * @param {string} [tail]  fin (lien), conservée en entier
 */
function sms(head, tail = '') {
  const cleanTail = toGsm(tail);
  const room = SMS_MAX - cleanTail.length;
  let cleanHead = toGsm(head);
  if (cleanHead.length > room)
    cleanHead = `${cleanHead.slice(0, Math.max(0, room - 3)).trimEnd()}...`;
  return toGsm(cleanHead + cleanTail);
}

// ─── Contenus des emails ─────────────────────────────────────────────────────

/** @param {MessageContext} ctx @param {MessageEnv} env */
function appointmentDetails(ctx, env) {
  /** @type {{ label: string, value: string }[]} */
  const details = [
    { label: 'Prestation', value: ctx.serviceName },
    ...(ctx.options.length ? [{ label: 'Options', value: ctx.options.join(', ') }] : []),
    { label: 'Date', value: longDay(ctx.startsAt) },
    { label: 'Heure', value: fmt.formatTime(ctx.startsAt) },
    { label: 'Durée prévue', value: fmt.formatMinutes(ctx.durationMinutes) },
    { label: 'Tarif estimé', value: priceLabel(ctx) },
    { label: 'Lieu', value: `${env.site.name}\n${addressLine(env)}` },
  ];
  return details;
}

/** @param {MessageEnv} env */
const policyNote = (env) =>
  `Déplacement et annulation gratuits jusqu’à ${env.cancellationHours} h avant le rendez-vous. Passé ce délai, appelez le salon.`;

/**
 * @param {import('./email-layout.js').EmailContent} content
 * @param {MessageEnv} env
 * @param {string} footerNote
 */
function render(content, env, footerNote) {
  const layout = {
    publicUrl: env.publicUrl,
    salonName: env.site.name,
    address: addressLine(env),
    phone: env.site.phone || undefined,
    footerNote,
  };
  return {
    subject: content.subject,
    html: renderHtml(content, layout),
    text: renderText(content, layout),
  };
}

const FOOTER_BOOKING = 'Vous recevez cet email car vous avez pris rendez-vous sur notre site.';

/** @param {string} kind */
const isCancel = (kind) => kind.startsWith('cancelled');

/**
 * @param {string} kind
 * @param {MessageContext} ctx
 * @param {MessageEnv} env
 * @param {Links} links
 * @returns {import('./email-layout.js').EmailContent}
 */
function bookingEmail(kind, ctx, env, links) {
  const day = fmt.formatDay(ctx.startsAt);
  const time = fmt.formatTime(ctx.startsAt);
  const manage = links.manageUrl
    ? { label: 'Gérer mon rendez-vous', url: links.manageUrl }
    : undefined;

  if (kind === 'rescheduled') {
    return {
      subject: `Votre rendez-vous est déplacé au ${day} à ${time}`,
      preheader: `Nouvelle date : ${day} à ${time}.`,
      title: 'Votre rendez-vous *est déplacé*.',
      paragraphs: [
        `Bonjour ${ctx.firstName}, c’est fait : votre rendez-vous a bien changé de créneau.`,
        'Voici la nouvelle date. Le fichier joint met votre agenda à jour.',
      ],
      details: appointmentDetails(ctx, env),
      cta: manage,
      notes: [policyNote(env)],
    };
  }
  if (isCancel(kind)) {
    const bySalon = kind === 'cancelled_by_salon';
    return {
      subject: `Votre rendez-vous du ${day} est annulé`,
      preheader: bySalon
        ? 'Nous sommes désolées, nous devons annuler ce rendez-vous.'
        : 'Votre annulation est bien prise en compte.',
      title: bySalon ? 'Votre rendez-vous *est annulé*.' : 'Annulation *bien reçue*.',
      paragraphs: [
        bySalon
          ? `Bonjour ${ctx.firstName}, nous sommes sincèrement désolées : nous devons annuler votre rendez-vous du ${day} à ${time} (${ctx.serviceName}). Nous reviendrons vers vous pour vous proposer un autre créneau.`
          : `Bonjour ${ctx.firstName}, votre rendez-vous du ${day} à ${time} (${ctx.serviceName}) est annulé. Le créneau est libéré.`,
        'Quand vous le souhaitez, vous pouvez reprendre rendez-vous en quelques clics.',
      ],
      cta: { label: 'Prendre un nouveau rendez-vous', url: env.bookingUrl },
    };
  }
  if (kind === 'validated') {
    return {
      subject: `Bonne nouvelle : votre rendez-vous du ${day} à ${time} est confirmé`,
      preheader: `${ctx.serviceName}, ${day} à ${time}. Le fichier joint l’ajoute à votre agenda.`,
      title: 'Votre rendez-vous *est validé*.',
      paragraphs: [
        `Bonjour ${ctx.firstName}, bonne nouvelle : nous avons validé votre demande. Votre place est réservée, voici le récapitulatif.`,
        'Le fichier joint ajoute le rendez-vous à votre agenda.',
      ],
      details: appointmentDetails(ctx, env),
      cta: manage,
      notes: [policyNote(env)],
      list: { heading: 'Pour bien vous préparer', items: env.tips },
    };
  }
  // Confirmation (created)
  const pending = ctx.status === 'pending';
  return {
    subject: pending
      ? 'Votre demande de rendez-vous est bien reçue'
      : `Votre rendez-vous du ${day} à ${time} est confirmé`,
    preheader: pending
      ? `${ctx.serviceName}, ${day} à ${time}. Nous la validons et revenons vers vous.`
      : `${ctx.serviceName}, ${day} à ${time}. Le fichier joint l’ajoute à votre agenda.`,
    title: pending ? 'Votre demande *est bien reçue*.' : 'Votre rendez-vous *est confirmé*.',
    paragraphs: [
      pending
        ? `Bonjour ${ctx.firstName}, merci de votre confiance. Le salon valide votre demande et vous écrit dès que c’est fait.`
        : `Bonjour ${ctx.firstName}, merci de votre confiance : votre place est réservée. Voici le récapitulatif.`,
      'Le fichier joint ajoute le rendez-vous à votre agenda.',
    ],
    details: appointmentDetails(ctx, env),
    cta: manage,
    notes: [policyNote(env)],
    list: { heading: 'Pour bien vous préparer', items: env.tips },
  };
}

/**
 * @param {string} kind
 * @param {MessageContext} ctx
 * @param {MessageEnv} env
 * @returns {import('./email-layout.js').EmailContent}
 */
function ownerEmail(kind, ctx, env) {
  const who = `${ctx.firstName} ${ctx.lastName.charAt(0)}.`;
  const day = fmt.formatDay(ctx.startsAt);
  const time = fmt.formatTime(ctx.startsAt);
  const headline = isCancel(kind)
    ? 'Rendez-vous annulé'
    : kind === 'rescheduled'
      ? 'Rendez-vous déplacé'
      : ctx.status === 'pending'
        ? 'Nouvelle demande à valider'
        : 'Nouveau rendez-vous';
  return {
    subject: `${headline} : ${who}, ${day} à ${time}`,
    preheader: `${ctx.serviceName} · ${who}`,
    title: `${headline}.`,
    paragraphs: [
      isCancel(kind)
        ? `Le créneau est de nouveau libre.`
        : `Un rendez-vous ${kind === 'rescheduled' ? 'a été déplacé' : 'vient d’être pris'} sur le site.`,
    ],
    details: [
      { label: 'Cliente', value: `${ctx.firstName} ${ctx.lastName}` },
      { label: 'Contact', value: [ctx.phone, ctx.email].filter(Boolean).join('\n') },
      { label: 'Prestation', value: ctx.serviceName },
      ...(ctx.options.length ? [{ label: 'Options', value: ctx.options.join(', ') }] : []),
      { label: 'Date', value: longDay(ctx.startsAt) },
      { label: 'Heure', value: fmt.formatTime(ctx.startsAt) },
      { label: 'Tarif estimé', value: priceLabel(ctx) },
      ...(ctx.hairState ? [{ label: 'Cheveux', value: ctx.hairState }] : []),
      ...(ctx.clientNotes ? [{ label: 'Message', value: ctx.clientNotes }] : []),
      ...(ctx.hasPhoto ? [{ label: 'Photo', value: 'Une photo des cheveux a été jointe.' }] : []),
    ],
    notes: [`Alerte automatique de ${env.site.name}.`],
  };
}

/**
 * @param {'request'|'reminder'} type
 * @param {MessageContext} ctx
 * @param {MessageEnv} env
 * @param {Links} links
 * @returns {import('./email-layout.js').EmailContent}
 */
function reviewEmail(type, ctx, env, links) {
  const reminder = type === 'reminder';
  return {
    subject: reminder
      ? `Un petit mot sur votre rendez-vous, ${ctx.firstName} ?`
      : `Comment s’est passé votre rendez-vous, ${ctx.firstName} ?`,
    preheader: 'Deux minutes pour partager votre expérience.',
    title: reminder ? 'Votre avis *compte* toujours.' : 'Votre avis *compte*.',
    paragraphs: [
      reminder
        ? `Bonjour ${ctx.firstName}, nous n’osons pas insister : c’est notre seule relance. Si vous avez deux minutes, votre retour sur « ${ctx.serviceName} » nous aide beaucoup.`
        : `Bonjour ${ctx.firstName}, merci de votre visite. Votre retour sur « ${ctx.serviceName} » aide d’autres femmes à nous trouver, et nous aide à progresser.`,
      'Vous pouvez noter votre rendez-vous, écrire quelques mots et, si vous le souhaitez, ajouter une photo du résultat.',
    ],
    cta: links.reviewUrl ? { label: 'Laisser mon avis', url: links.reviewUrl } : undefined,
    notes: ['Ce lien est personnel : il fonctionne une seule fois et reste valable 30 jours.'],
  };
}

// ─── SMS ─────────────────────────────────────────────────────────────────────

/**
 * @param {string} kind
 * @param {MessageContext} ctx
 * @param {MessageEnv} env
 * @param {Links} links
 */
function bookingSms(kind, ctx, env, links) {
  const when = `${formatShortDay(ctx.startsAt)} à ${fmt.formatTime(ctx.startsAt)}`;
  const link = links.manageUrl
    ? ` Gérer : ${links.manageUrl}`
    : ` Infos : ${env.site.phone || env.publicUrl}`;
  if (kind === 'rescheduled') return sms(`${env.site.name} : RDV déplacé au ${when}.`, link);
  if (isCancel(kind))
    return sms(`${env.site.name} : RDV du ${when} annulé.`, ` Reprendre : ${env.bookingUrl}`);
  if (kind === 'validated') return sms(`${env.site.name} : RDV validé, ${when}.`, link);
  const state = ctx.status === 'pending' ? 'demande reçue' : 'RDV confirmé';
  return sms(`${env.site.name} : ${state}, ${when}.`, link);
}

// ─── Assemblage ──────────────────────────────────────────────────────────────

/**
 * Messages à envoyer pour un job, avec leurs raisons de ne pas partir (canal indisponible).
 * @param {object} p
 * @param {string} p.queue
 * @param {import('./plan.js').JobData} p.data
 * @param {MessageContext} p.ctx
 * @param {MessageEnv} p.env
 * @param {Links} [p.links]
 * @param {Date} p.now
 * @returns {{ messages: OutgoingMessage[], skipped: { channel: 'email'|'sms', template: string, dedupeKey: string, reason: string }[] }}
 */
export function buildMessages({ queue, data, ctx, env, links = {}, now }) {
  /** @type {OutgoingMessage[]} */
  const messages = [];
  /** @type {{ channel: 'email'|'sms', template: string, dedupeKey: string, reason: string }[]} */
  const skipped = [];
  const kind = data.kind ?? 'created';
  const name = `${ctx.firstName} ${ctx.lastName}`.trim();

  /** @param {string} template @param {import('./email-layout.js').EmailContent} content @param {string} footer @param {boolean} [ics] */
  const email = (template, content, footer, ics = false) => {
    if (!ctx.email)
      return void skipped.push({
        channel: 'email',
        template,
        dedupeKey: data.dedupeKey,
        reason: 'no_email',
      });
    const rendered = render(content, env, footer);
    messages.push({
      channel: 'email',
      template,
      recipient: ctx.email,
      dedupeKey: data.dedupeKey,
      payload: {
        ...rendered,
        to: { email: ctx.email, name },
        ...(ics
          ? {
              attachments: [
                {
                  name: 'rendez-vous-atelier-des-locks.ics',
                  contentType: 'text/calendar; charset=utf-8',
                  content: appointmentCalendar(
                    /** @type {any} */ ({
                      id: ctx.appointmentId,
                      status: ctx.status,
                      startsAt: ctx.startsAt,
                      durationMinutes: ctx.durationMinutes,
                      serviceName: ctx.serviceName,
                      updatedAt: ctx.updatedAt,
                    }),
                    {
                      manageUrl: links.manageUrl ?? env.publicUrl,
                      site: env.site,
                      now,
                    },
                  ),
                },
              ],
            }
          : {}),
      },
    });
  };

  /** @param {string} template @param {string} body */
  const smsOut = (template, body) => {
    if (!ctx.smsReminders || !ctx.phone) {
      return void skipped.push({
        channel: 'sms',
        template,
        dedupeKey: data.dedupeKey,
        reason: ctx.phone ? 'sms_opt_out' : 'no_phone',
      });
    }
    messages.push({
      channel: 'sms',
      template,
      recipient: ctx.phone,
      dedupeKey: data.dedupeKey,
      payload: { to: ctx.phone, text: body },
    });
  };

  switch (queue) {
    case QUEUES.confirmation: {
      // Validation par le salon : même file, autre texte et autre modèle (visible dans le journal).
      const validated = kind === 'validated';
      const template = validated ? 'booking_validated' : 'booking_confirmation';
      const confirmKind = validated ? 'validated' : 'created';
      email(template, bookingEmail(confirmKind, ctx, env, links), FOOTER_BOOKING, true);
      smsOut(template, bookingSms(confirmKind, ctx, env, links));
      break;
    }
    case QUEUES.change: {
      const template = isCancel(kind) ? 'booking_cancelled' : 'booking_rescheduled';
      email(template, bookingEmail(kind, ctx, env, links), FOOTER_BOOKING, kind === 'rescheduled');
      smsOut(template, bookingSms(kind, ctx, env, links));
      break;
    }
    case QUEUES.reminderD2:
      email(
        'reminder_d2',
        {
          subject: `Dans 2 jours : votre rendez-vous du ${fmt.formatDay(ctx.startsAt)} à ${fmt.formatTime(ctx.startsAt)}`,
          preheader: `${ctx.serviceName}, ${fmt.formatDay(ctx.startsAt)} à ${fmt.formatTime(ctx.startsAt)}.`,
          title: 'À *après-demain* !',
          paragraphs: [
            `Bonjour ${ctx.firstName}, nous avons hâte de vous retrouver. Voici votre rendez-vous, et quelques conseils pour qu’il se passe au mieux.`,
          ],
          details: appointmentDetails(ctx, env),
          cta: links.manageUrl
            ? { label: 'Gérer mon rendez-vous', url: links.manageUrl }
            : undefined,
          notes: [policyNote(env)],
          list: { heading: 'Pour bien vous préparer', items: env.tips },
        },
        FOOTER_BOOKING,
      );
      break;
    case QUEUES.reminderD1:
      smsOut(
        'reminder_d1',
        sms(
          `Rappel ${env.site.name} : RDV demain à ${fmt.formatTime(ctx.startsAt)}.`,
          links.manageUrl ? ` Un empêchement ? ${links.manageUrl}` : '',
        ),
      );
      break;
    case QUEUES.ownerAlert:
      if (!env.ownerEmail) {
        skipped.push({
          channel: 'email',
          template: 'owner_alert',
          dedupeKey: data.dedupeKey,
          reason: 'no_owner_email',
        });
      } else {
        const rendered = render(
          ownerEmail(kind, ctx, env),
          env,
          'Cet email est réservé à la propriétaire du salon.',
        );
        messages.push({
          channel: 'email',
          template: 'owner_alert',
          recipient: env.ownerEmail,
          dedupeKey: data.dedupeKey,
          payload: { ...rendered, to: { email: env.ownerEmail, name: env.site.name } },
        });
      }
      break;
    case QUEUES.reviewRequest:
      email('review_request', reviewEmail('request', ctx, env, links), FOOTER_BOOKING);
      break;
    case QUEUES.reviewReminder:
      email('review_reminder', reviewEmail('reminder', ctx, env, links), FOOTER_BOOKING);
      break;
    default:
      break;
  }
  return { messages, skipped };
}
