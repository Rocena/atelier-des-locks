// @ts-check
/**
 * Planification des notifications (§7.6) : fonctions pures, sans base ni horloge cachée.
 *
 * Deux questions, deux familles de fonctions :
 *   1. QUAND ? `plan…()` transforme un événement (RDV créé, déplacé, annulé, terminé) en liste de
 *      jobs datés. Le service les dépose dans pg-boss, qui les conserve en base : un redémarrage
 *      du serveur ne perd aucun rappel.
 *   2. FAUT-IL ENCORE ENVOYER ? `evaluateJob()` est rejouée au moment de l'exécution, sur l'état
 *      réel du RDV. Un rappel pour un RDV annulé ou déplacé entre-temps est écarté : c'est plus
 *      sûr que d'annuler des jobs, car un job égaré ne produit jamais un message erroné.
 *
 * Tous les horaires sont en heure de Paris (changements d'heure inclus, via zoned-time).
 */
import { addDays, utcToZoned, zonedToUtc } from '../../lib/zoned-time.js';

/** Files pg-boss (une par type de message). */
export const QUEUES = /** @type {const} */ ({
  confirmation: 'notif-confirmation',
  change: 'notif-change',
  ownerAlert: 'notif-owner-alert',
  reminderD2: 'notif-reminder-d2',
  reminderD1: 'notif-reminder-d1',
  reviewRequest: 'notif-review-request',
  reviewReminder: 'notif-review-reminder',
});

export const ALL_QUEUES = Object.values(QUEUES);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Réglages de timing du §7.6. */
export const TIMING = {
  /** Rappel par email : 2 jours avant, à 10h. */
  reminderEmail: { daysBefore: 2, at: '10:00' },
  /** Rappel par SMS : la veille à 18h. */
  reminderSms: { daysBefore: 1, at: '18:00' },
  /** Demande d'avis : 3 h après le passage du RDV au statut « terminé ». */
  reviewRequestDelayMs: 3 * HOUR,
  /** Relance unique : 5 jours après la demande d'avis. */
  reviewReminderDelayMs: 5 * DAY,
  /** Validité du lien « laisser un avis » (§8). */
  reviewLinkDays: 30,
};

/**
 * @typedef {object} PlannedJob
 * @property {string} queue
 * @property {Date} startAfter
 * @property {JobData} data
 */

/**
 * Charge utile d'un job : jamais de donnée personnelle (ni nom, ni email, ni téléphone).
 * Le jeton « Gérer mon RDV » n'y figure que scellé (AES-256-GCM, cf. seal.js).
 * @typedef {object} JobData
 * @property {string} appointmentId
 * @property {string} [startsAt]     début du RDV tel que connu à la planification (ISO)
 * @property {string} dedupeKey      identifie le message logique : une seule fois par canal
 * @property {string} [kind]         created | rescheduled | cancelled_by_client | cancelled_by_salon
 * @property {string} [tk]           jeton de gestion scellé
 */

/** @param {Date} date */
const epoch = (date) => Math.floor(date.getTime() / 1000);

/**
 * Instant local d'un jour de rappel : « n jours avant la date du RDV, à HH:MM, heure de Paris ».
 * @param {Date} startsAt
 * @param {{ daysBefore: number, at: string }} rule
 * @param {string} timeZone
 */
export function reminderInstant(startsAt, rule, timeZone) {
  const { date } = utcToZoned(startsAt, timeZone);
  return zonedToUtc(addDays(date, -rule.daysBefore), rule.at, timeZone);
}

/**
 * Rappels d'un RDV : email J-2 (10h) et SMS J-1 (18h). Un rappel déjà passé est ignoré (RDV pris
 * tard : la confirmation fait office de rappel).
 * @param {{ appointmentId: string, startsAt: Date, smsEnabled: boolean, now: Date, timeZone: string, tk?: string }} p
 * @returns {PlannedJob[]}
 */
export function planReminders({ appointmentId, startsAt, smsEnabled, now, timeZone, tk }) {
  /** @type {PlannedJob[]} */
  const jobs = [];
  const base = { appointmentId, startsAt: startsAt.toISOString(), ...(tk ? { tk } : {}) };
  const d2 = reminderInstant(startsAt, TIMING.reminderEmail, timeZone);
  if (d2 > now) {
    jobs.push({
      queue: QUEUES.reminderD2,
      startAfter: d2,
      data: { ...base, dedupeKey: `reminder_d2:${appointmentId}:${epoch(startsAt)}` },
    });
  }
  const d1 = reminderInstant(startsAt, TIMING.reminderSms, timeZone);
  if (smsEnabled && d1 > now) {
    jobs.push({
      queue: QUEUES.reminderD1,
      startAfter: d1,
      data: { ...base, dedupeKey: `reminder_d1:${appointmentId}:${epoch(startsAt)}` },
    });
  }
  return jobs;
}

/**
 * RDV créé : confirmation (email + .ics + lien, SMS court), alerte propriétaire, rappels.
 * @param {{ appointmentId: string, startsAt: Date, smsEnabled: boolean, now: Date, timeZone: string, tk?: string }} p
 * @returns {PlannedJob[]}
 */
export function planBooked(p) {
  const { appointmentId, startsAt, now, tk } = p;
  const base = { appointmentId, startsAt: startsAt.toISOString(), ...(tk ? { tk } : {}) };
  return [
    {
      queue: QUEUES.confirmation,
      startAfter: now,
      data: {
        ...base,
        kind: 'created',
        dedupeKey: `confirmation:${appointmentId}:${epoch(startsAt)}`,
      },
    },
    {
      queue: QUEUES.ownerAlert,
      startAfter: now,
      data: {
        ...base,
        kind: 'created',
        dedupeKey: `owner:created:${appointmentId}:${epoch(startsAt)}`,
      },
    },
    ...planReminders(p),
  ];
}

/**
 * RDV « à valider » validé par le salon : message de confirmation (email + .ics + lien, SMS court).
 * La clé de dédoublonnage est distincte de celle de la demande reçue, sinon rien ne partirait.
 * Les rappels sont déjà planifiés à la demande ; on les redépose (clés identiques : jamais de doublon).
 * @param {{ appointmentId: string, startsAt: Date, smsEnabled: boolean, now: Date, timeZone: string, tk?: string }} p
 * @returns {PlannedJob[]}
 */
export function planValidated(p) {
  const { appointmentId, startsAt, now, tk } = p;
  return [
    {
      queue: QUEUES.confirmation,
      startAfter: now,
      data: {
        appointmentId,
        startsAt: startsAt.toISOString(),
        ...(tk ? { tk } : {}),
        kind: 'validated',
        dedupeKey: `confirmation:validated:${appointmentId}:${epoch(startsAt)}`,
      },
    },
    ...planReminders(p),
  ];
}

/**
 * RDV déplacé : message à la cliente, alerte propriétaire, nouveaux rappels. Les anciens rappels
 * (même RDV, ancien horaire) sont écartés à l'exécution : `startsAt` du job ≠ `startsAt` réel.
 * @param {{ appointmentId: string, startsAt: Date, smsEnabled: boolean, now: Date, timeZone: string, tk?: string }} p
 * @returns {PlannedJob[]}
 */
export function planRescheduled(p) {
  const { appointmentId, startsAt, now, tk } = p;
  const base = { appointmentId, startsAt: startsAt.toISOString(), ...(tk ? { tk } : {}) };
  return [
    {
      queue: QUEUES.change,
      startAfter: now,
      data: {
        ...base,
        kind: 'rescheduled',
        dedupeKey: `change:rescheduled:${appointmentId}:${epoch(startsAt)}`,
      },
    },
    {
      queue: QUEUES.ownerAlert,
      startAfter: now,
      data: {
        ...base,
        kind: 'rescheduled',
        dedupeKey: `owner:rescheduled:${appointmentId}:${epoch(startsAt)}`,
      },
    },
    ...planReminders(p),
  ];
}

/**
 * RDV annulé (par la cliente ou par le salon).
 * @param {{ appointmentId: string, by: 'client'|'salon', now: Date }} p
 * @returns {PlannedJob[]}
 */
export function planCancelled({ appointmentId, by, now }) {
  const kind = by === 'salon' ? 'cancelled_by_salon' : 'cancelled_by_client';
  return [
    {
      queue: QUEUES.change,
      startAfter: now,
      data: { appointmentId, kind, dedupeKey: `change:${kind}:${appointmentId}` },
    },
    {
      queue: QUEUES.ownerAlert,
      startAfter: now,
      data: { appointmentId, kind, dedupeKey: `owner:${kind}:${appointmentId}` },
    },
  ];
}

/**
 * RDV passé au statut « terminé » : demande d'avis 3 h plus tard, relance unique 5 jours après.
 * @param {{ appointmentId: string, completedAt: Date }} p
 * @returns {PlannedJob[]}
 */
export function planCompleted({ appointmentId, completedAt }) {
  const request = new Date(completedAt.getTime() + TIMING.reviewRequestDelayMs);
  const reminder = new Date(request.getTime() + TIMING.reviewReminderDelayMs);
  return [
    {
      queue: QUEUES.reviewRequest,
      startAfter: request,
      data: { appointmentId, dedupeKey: `review_request:${appointmentId}` },
    },
    {
      queue: QUEUES.reviewReminder,
      startAfter: reminder,
      data: { appointmentId, dedupeKey: `review_reminder:${appointmentId}` },
    },
  ];
}

// ─── Garde-fous à l'exécution ────────────────────────────────────────────────

const ACTIVE = ['pending', 'confirmed'];

/**
 * État du RDV au moment de l'exécution du job.
 * @typedef {object} JobContext
 * @property {string} status
 * @property {Date} startsAt
 * @property {boolean} anonymized  la cliente a été anonymisée (RGPD) : plus aucun envoi
 * @property {boolean} hasReview   un avis a déjà été déposé pour ce RDV
 */

/**
 * Le job doit-il encore partir ? Rejouée à chaque exécution et à chaque nouvel essai.
 * @param {string} queue
 * @param {JobContext} ctx
 * @param {JobData} data
 * @param {Date} now
 * @returns {{ send: true } | { send: false, reason: string }}
 */
export function evaluateJob(queue, ctx, data, now) {
  if (ctx.anonymized) return { send: false, reason: 'client_anonymized' };
  const sameSlot = !data.startsAt || ctx.startsAt.getTime() === Date.parse(data.startsAt);

  switch (queue) {
    case QUEUES.confirmation:
      // Validation : le RDV doit être confirmé au moment de l'envoi (annulé ou remis en attente depuis).
      if (data.kind === 'validated' && ctx.status !== 'confirmed') {
        return { send: false, reason: 'not_confirmed' };
      }
      // Annulé avant même l'envoi : la confirmation n'a plus de sens (l'annulation part seule).
      if (!ACTIVE.includes(ctx.status)) return { send: false, reason: 'not_active' };
      if (!sameSlot) return { send: false, reason: 'rescheduled' };
      return { send: true };

    case QUEUES.ownerAlert:
      // Information de la propriétaire : toujours envoyée (même si la cliente a annulé depuis).
      return { send: true };

    case QUEUES.change:
      if (data.kind === 'rescheduled') {
        if (!ACTIVE.includes(ctx.status)) return { send: false, reason: 'not_active' };
        if (!sameSlot) return { send: false, reason: 'rescheduled_again' };
      } else if (!ctx.status.startsWith('cancelled')) {
        return { send: false, reason: 'not_cancelled' };
      }
      return { send: true };

    case QUEUES.reminderD2:
    case QUEUES.reminderD1:
      // Les rappels ne concernent que les RDV confirmés (pas ceux en attente de validation).
      if (ctx.status !== 'confirmed') return { send: false, reason: 'not_confirmed' };
      if (!sameSlot) return { send: false, reason: 'rescheduled' };
      if (ctx.startsAt <= now) return { send: false, reason: 'past' };
      return { send: true };

    case QUEUES.reviewRequest:
    case QUEUES.reviewReminder:
      if (ctx.status !== 'completed') return { send: false, reason: 'not_completed' };
      if (ctx.hasReview) return { send: false, reason: 'review_already_left' };
      return { send: true };

    default:
      return { send: false, reason: 'unknown_queue' };
  }
}
