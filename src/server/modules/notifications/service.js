// @ts-check
/**
 * Orchestration des notifications (§7.6) : planifie les jobs (pg-boss) quand un RDV change, puis
 * les exécute (relecture du RDV, garde-fous, rendu, envoi, journal).
 *
 * Principes :
 *  - les jobs ne contiennent aucune donnée personnelle (identifiant du RDV + clé de dédoublonnage) ;
 *  - jamais d'envoi en double : chaque message a une clé unique par canal dans notifications_log ;
 *  - une erreur définitive du fournisseur (adresse refusée) n'est pas rejouée ; une panne
 *    passagère l'est (retries de pg-boss) ;
 *  - un échec de planification ne fait jamais échouer la réservation (déjà enregistrée).
 *
 * @typedef {import('pg').Pool} Pool
 * @typedef {import('./providers.js').NotificationProvider} NotificationProvider
 * @typedef {import('./queue.js').JobQueue} JobQueue
 */
import * as repo from './repo.js';
import {
  ALL_QUEUES,
  QUEUES,
  evaluateJob,
  planBooked,
  planCancelled,
  planCompleted,
  planRescheduled,
} from './plan.js';
import { buildMessages } from './messages.js';
import { ProviderError } from './providers.js';
import { openToken, sealToken } from './seal.js';
import { findBookingSettings } from '../booking/repo.js';
import { isPlaceholderEmail } from '../clients/placeholder.js';
import { HAIR_STATES } from '../booking/schemas.js';
import { PREPARATION_TIPS } from '../booking/service.js';
import * as reviews from '../reviews/service.js';
import * as reviewsRepo from '../reviews/repo.js';

/**
 * @typedef {object} NotifierOptions
 * @property {Pool} db
 * @property {JobQueue} queue
 * @property {NotificationProvider} provider
 * @property {import('../../config.js').AppConfig} config
 * @property {any} site                       informations du salon (lib/site.js)
 * @property {() => Date} [now]
 * @property {{ info: (o: object, m?: string) => void, error: (o: object, m?: string) => void }} [log]
 */

const silent = { info() {}, error() {} };

/**
 * @param {NotifierOptions} options
 */
export function createNotifier({
  db,
  queue,
  provider,
  config,
  site,
  now = () => new Date(),
  log = silent,
}) {
  const publicUrl = config.publicUrl;
  const bookingUrl =
    config.booking.provider === 'fresha_link' ? config.booking.freshaUrl : `${publicUrl}/reserver`;

  /** Dépose des jobs ; ne lève jamais (la réservation est déjà enregistrée). @param {import('./plan.js').PlannedJob[]} jobs */
  async function enqueue(jobs) {
    for (const job of jobs) {
      try {
        await queue.send(job.queue, job.data, { startAfter: job.startAfter });
      } catch (error) {
        log.error(
          {
            event: 'notifications.enqueue_failed',
            queue: job.queue,
            appointmentId: job.data.appointmentId,
            err: error,
          },
          'planification impossible',
        );
      }
    }
  }

  /** @param {string} appointmentId */
  async function planningContext(appointmentId) {
    const [ctx, settings] = await Promise.all([
      repo.findContext(db, appointmentId),
      findBookingSettings(db),
    ]);
    if (!ctx) return null;
    return {
      ctx,
      timeZone: settings.timeZone,
      smsEnabled: ctx.smsReminders && Boolean(ctx.phone),
    };
  }

  /**
   * Un événement ne doit jamais faire échouer l'action de la cliente (le RDV est déjà enregistré) :
   * l'erreur est journalisée, sans donnée personnelle.
   * @template {(arg: any) => Promise<void>} F
   * @param {string} name
   * @param {F} fn
   * @returns {F}
   */
  const safe = (name, fn) =>
    /** @type {F} */ (
      async (/** @type {any} */ arg) => {
        try {
          await fn(arg);
        } catch (error) {
          log.error(
            { event: `notifications.${name}_failed`, err: error },
            'notification non planifiée',
          );
        }
      }
    );

  // ─── Événements : appelés par la réservation (et, plus tard, par l'admin) ───

  /**
   * RDV créé : confirmation, alerte propriétaire, rappels J-2 (email) et J-1 18h (SMS).
   * @param {{ appointmentId: string, token: string }} e  `token` : jeton « Gérer mon RDV » en clair
   */
  const appointmentBooked = safe(
    'booked',
    async function appointmentBooked({ appointmentId, token }) {
      const p = await planningContext(appointmentId);
      if (!p) return;
      await enqueue(
        planBooked({
          appointmentId,
          startsAt: p.ctx.startsAt,
          smsEnabled: p.smsEnabled,
          now: now(),
          timeZone: p.timeZone,
          tk: sealToken(token, config.sessionSecret),
        }),
      );
    },
  );

  /** @param {{ appointmentId: string, token: string }} e */
  const appointmentRescheduled = safe(
    'rescheduled',
    async function appointmentRescheduled({ appointmentId, token }) {
      const p = await planningContext(appointmentId);
      if (!p) return;
      await enqueue(
        planRescheduled({
          appointmentId,
          startsAt: p.ctx.startsAt,
          smsEnabled: p.smsEnabled,
          now: now(),
          timeZone: p.timeZone,
          tk: sealToken(token, config.sessionSecret),
        }),
      );
    },
  );

  /** @param {{ appointmentId: string, by: 'client'|'salon' }} e */
  const appointmentCancelled = safe(
    'cancelled',
    async function appointmentCancelled({ appointmentId, by }) {
      await enqueue(planCancelled({ appointmentId, by, now: now() }));
    },
  );

  /**
   * Statut → « terminé » : demande d'avis 3 h plus tard, relance unique à J+5 (appelé par l'admin).
   * @param {{ appointmentId: string, completedAt?: Date }} e
   */
  const appointmentCompleted = safe(
    'completed',
    async function appointmentCompleted({ appointmentId, completedAt = now() }) {
      await enqueue(planCompleted({ appointmentId, completedAt }));
    },
  );

  // ─── Exécution d'un job ─────────────────────────────────────────────────────

  /**
   * Envoie un message et le journalise. Renvoie une erreur à rejouer (ou null).
   * @param {import('./messages.js').OutgoingMessage} message
   * @param {{ appointmentId: string, clientId: string }} ids
   * @returns {Promise<{ sent: boolean, retry: Error|null }>}
   */
  async function deliver(message, ids) {
    const logId = await repo.claimLog(db, {
      appointmentId: ids.appointmentId,
      clientId: ids.clientId,
      channel: message.channel,
      template: message.template,
      recipient: message.recipient,
      dedupeKey: message.dedupeKey,
    });
    if (!logId) return { sent: false, retry: null }; // déjà envoyé : rien à refaire
    try {
      const result =
        message.channel === 'email'
          ? await provider.sendEmail({
              .../** @type {any} */ (message.payload),
              tag: message.template,
            })
          : await provider.sendSms({
              .../** @type {any} */ (message.payload),
              tag: message.template,
            });
      await repo.markSent(db, logId, result.messageId, now());
      return { sent: true, retry: null };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await repo.markFailed(db, logId, text);
      log.error(
        {
          event: 'notifications.send_failed',
          template: message.template,
          channel: message.channel,
          error: text,
        },
        'envoi échoué',
      );
      const retryable = !(error instanceof ProviderError) || error.retryable;
      return { sent: false, retry: retryable ? /** @type {Error} */ (error) : null };
    }
  }

  /**
   * Exécute un job : relit le RDV, applique les garde-fous, construit et envoie les messages.
   * Lève une erreur uniquement si une nouvelle tentative a une chance de réussir.
   * @param {string} queueName
   * @param {import('./plan.js').JobData} data
   */
  async function process(queueName, data) {
    const current = now();
    const ctx = await repo.findContext(db, data.appointmentId);
    if (!ctx) return; // RDV supprimé entre-temps

    const settings = await findBookingSettings(db);
    const env = {
      publicUrl,
      site,
      ownerEmail: config.notifications.ownerEmail,
      bookingUrl,
      cancellationHours: settings.cancellationHours,
      tips: PREPARATION_TIPS,
    };
    const ids = { appointmentId: data.appointmentId, clientId: ctx.clientId };
    const fullCtx = {
      ...ctx,
      hairState: ctx.hairState ? (/** @type {any} */ (HAIR_STATES)[ctx.hairState] ?? null) : null,
    };

    // 1. Faut-il encore envoyer ? (RDV annulé, déplacé, avis déjà laissé…)
    let decision = evaluateJob(queueName, ctx, data, current);
    const isReview = queueName === QUEUES.reviewRequest || queueName === QUEUES.reviewReminder;
    /** @type {{ expiresAt?: Date }} */
    let tokenOptions = {};
    if (decision.send && queueName === QUEUES.reviewReminder) {
      // Relance unique, et seulement s'il reste un lien utilisable (ni utilisé, ni expiré).
      if (await reviewsRepo.reminderAlreadySent(db, data.appointmentId)) {
        decision = { send: false, reason: 'reminder_already_sent' };
      } else {
        const usable = await reviewsRepo.findUsableToken(db, data.appointmentId, current);
        if (!usable) decision = { send: false, reason: 'no_usable_link' };
        else tokenOptions = { expiresAt: usable.expiresAt };
      }
    }
    if (!decision.send) {
      const { messages, skipped } = buildMessages({
        queue: queueName,
        data,
        ctx: fullCtx,
        env,
        now: current,
      });
      for (const m of messages)
        await repo.logSkipped(db, { ...ids, ...m, reason: /** @type {any} */ (decision).reason });
      for (const s of skipped)
        await repo.logSkipped(db, {
          ...ids,
          ...s,
          recipient: '',
          reason: /** @type {any} */ (decision).reason,
        });
      return;
    }

    // 2. Liens personnels : « Gérer mon RDV » (jeton scellé) et « Laisser mon avis » (nouveau jeton).
    /** @type {import('./messages.js').Links} */
    const links = {};
    const manageToken = openToken(data.tk, config.sessionSecret);
    if (manageToken) links.manageUrl = `${publicUrl}/rdv/${manageToken}`;
    if (isReview) {
      // Pas de nouveau lien si l'email est déjà parti (nouvel essai après un échec SMS, par exemple).
      if (await repo.wasSent(db, data.dedupeKey, 'email')) return;
      if (!ctx.email || isPlaceholderEmail(ctx.email)) return;
      const { token } = await reviews.issueReviewToken(
        db,
        data.appointmentId,
        current,
        tokenOptions,
      );
      links.reviewUrl = `${publicUrl}/avis/laisser/${token}`;
    }

    // 3. Envoi, canal par canal.
    const { messages, skipped } = buildMessages({
      queue: queueName,
      data,
      ctx: fullCtx,
      env,
      links,
      now: current,
    });
    for (const s of skipped)
      await repo.logSkipped(db, { ...ids, ...s, recipient: '', reason: s.reason });
    /** @type {Error|null} */
    let retry = null;
    let reviewSent = false;
    // Cliente sans adresse email (RDV pris par téléphone) : pas d'email, le SMS part quand même.
    for (const message of messages) {
      if (message.channel === 'email' && isPlaceholderEmail(message.recipient)) continue;
      const result = await deliver(message, ids);
      if (result.sent && isReview) reviewSent = true;
      retry ??= result.retry;
    }
    if (reviewSent && queueName === QUEUES.reviewReminder) {
      await reviewsRepo.markReminderSent(db, data.appointmentId, current);
    }
    if (retry) throw retry;
  }

  /** Branche un worker par file. */
  async function registerWorkers() {
    for (const name of ALL_QUEUES) await queue.work(name, (data) => process(name, data));
  }

  return {
    appointmentBooked,
    appointmentRescheduled,
    appointmentCancelled,
    appointmentCompleted,
    process,
    registerWorkers,
    /** Démarre la file (migrations pg-boss) et les workers. */
    async start() {
      await queue.start();
      await registerWorkers();
    },
    async stop() {
      await queue.stop();
    },
  };
}

/** @typedef {ReturnType<typeof createNotifier>} Notifier */
