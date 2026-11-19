// @ts-check
/**
 * Planification des jobs de notification (§7.6) : QUAND chaque message part, et POURQUOI un job
 * déjà planifié peut être écarté à l'exécution. Fonctions pures : aucune base, aucune horloge.
 */
import { describe, expect, it } from 'vitest';
import {
  QUEUES,
  TIMING,
  evaluateJob,
  planBooked,
  planCancelled,
  planCompleted,
  planReminders,
  planRescheduled,
  reminderInstant,
} from './plan.js';

const TZ = 'Europe/Paris';
const ID = '0b6f4a52-7c0a-4d6c-9a43-3a2c8f1d5e11';
const iso = (/** @type {Date} */ d) => d.toISOString();
/** @returns {any} */
const byQueue = (/** @type {import('./plan.js').PlannedJob[]} */ jobs, /** @type {string} */ q) =>
  jobs.find((j) => j.queue === q);

describe('rappels : heure locale de Paris', () => {
  it('J-2 à 10h : mardi 1er décembre 2026 9h → dimanche 29 novembre 10h (heure d’hiver, UTC+1)', () => {
    const startsAt = new Date('2026-12-01T08:00:00Z');
    expect(iso(reminderInstant(startsAt, TIMING.reminderEmail, TZ))).toBe(
      '2026-11-29T09:00:00.000Z',
    );
  });

  it('J-1 à 18h : la veille du RDV, 18h Paris', () => {
    const startsAt = new Date('2026-12-01T08:00:00Z');
    expect(iso(reminderInstant(startsAt, TIMING.reminderSms, TZ))).toBe('2026-11-30T17:00:00.000Z');
  });

  it('heure d’été : mêmes heures locales, décalage UTC+2', () => {
    const startsAt = new Date('2026-07-14T07:00:00Z'); // 9h Paris
    expect(iso(reminderInstant(startsAt, TIMING.reminderEmail, TZ))).toBe(
      '2026-07-12T08:00:00.000Z',
    );
    expect(iso(reminderInstant(startsAt, TIMING.reminderSms, TZ))).toBe('2026-07-13T16:00:00.000Z');
  });

  it('RDV juste après le passage à l’heure d’été (lundi 29 mars 2027) : J-2 en hiver, J-1 en été', () => {
    // Changement d'heure : dimanche 28 mars 2027, 2h → 3h.
    const startsAt = new Date('2027-03-29T12:00:00Z'); // 14h Paris (UTC+2)
    expect(iso(reminderInstant(startsAt, TIMING.reminderEmail, TZ))).toBe(
      '2027-03-27T09:00:00.000Z',
    ); // 10h, UTC+1
    expect(iso(reminderInstant(startsAt, TIMING.reminderSms, TZ))).toBe('2027-03-28T16:00:00.000Z'); // 18h, UTC+2
  });

  it('retour à l’heure d’hiver (dimanche 25 octobre 2026) : J-1 à 18h reste 18h Paris', () => {
    const startsAt = new Date('2026-10-26T08:00:00Z'); // lundi 9h Paris (UTC+1)
    expect(iso(reminderInstant(startsAt, TIMING.reminderSms, TZ))).toBe('2026-10-25T17:00:00.000Z'); // 18h, UTC+1
  });

  it('la date locale compte, pas la date UTC : un RDV à 0h30 Paris est « du jour » local', () => {
    const startsAt = new Date('2026-12-01T23:30:00Z'); // mercredi 2 décembre 0h30 Paris
    expect(iso(reminderInstant(startsAt, TIMING.reminderEmail, TZ))).toBe(
      '2026-11-30T09:00:00.000Z',
    );
  });
});

describe('planBooked : RDV créé', () => {
  const base = {
    appointmentId: ID,
    startsAt: new Date('2026-12-02T08:00:00Z'),
    smsEnabled: true,
    timeZone: TZ,
    tk: 'jeton-scelle',
  };
  const now = new Date('2026-11-20T10:00:00Z');

  it('planifie confirmation et alerte immédiates, rappel J-2 email, rappel J-1 SMS', () => {
    const jobs = planBooked({ ...base, now });
    expect(jobs.map((j) => j.queue)).toEqual([
      QUEUES.confirmation,
      QUEUES.ownerAlert,
      QUEUES.reminderD2,
      QUEUES.reminderD1,
    ]);
    expect(iso(byQueue(jobs, QUEUES.confirmation).startAfter)).toBe(iso(now));
    expect(iso(byQueue(jobs, QUEUES.ownerAlert).startAfter)).toBe(iso(now));
    expect(iso(byQueue(jobs, QUEUES.reminderD2).startAfter)).toBe('2026-11-30T09:00:00.000Z'); // lundi 10h
    expect(iso(byQueue(jobs, QUEUES.reminderD1).startAfter)).toBe('2026-12-01T17:00:00.000Z'); // mardi 18h
  });

  it('pas de rappel SMS si la cliente a refusé les SMS (ou sans téléphone)', () => {
    const jobs = planBooked({ ...base, smsEnabled: false, now });
    expect(byQueue(jobs, QUEUES.reminderD1)).toBeUndefined();
    expect(byQueue(jobs, QUEUES.reminderD2)).toBeDefined();
  });

  it('un rappel déjà passé n’est pas planifié (RDV pris tard) : la confirmation suffit', () => {
    // Lundi 30 novembre, 11h : J-2 (10h) est passé, J-1 SMS (18h le soir) reste à venir.
    const late = planBooked({ ...base, now: new Date('2026-11-30T10:00:00Z') });
    expect(byQueue(late, QUEUES.reminderD2)).toBeUndefined();
    expect(byQueue(late, QUEUES.reminderD1)).toBeDefined();
    // Mardi 1er décembre 18h30 Paris : plus aucun rappel.
    const veryLate = planBooked({ ...base, now: new Date('2026-12-01T17:30:00Z') });
    expect(veryLate.map((j) => j.queue)).toEqual([QUEUES.confirmation, QUEUES.ownerAlert]);
  });

  it('un rappel pile à l’instant présent n’est pas planifié (strictement dans le futur)', () => {
    const exact = new Date('2026-11-30T09:00:00Z');
    expect(byQueue(planReminders({ ...base, now: exact }), QUEUES.reminderD2)).toBeUndefined();
  });

  it('aucune donnée personnelle dans la charge utile', () => {
    for (const job of planBooked({ ...base, now })) {
      expect(
        Object.keys(job.data)
          .sort()
          .every((k) => ['appointmentId', 'dedupeKey', 'kind', 'startsAt', 'tk'].includes(k)),
      ).toBe(true);
      expect(JSON.stringify(job.data)).not.toMatch(/@|\+33|Diallo|Awa/);
    }
  });

  it('clés de dédoublonnage uniques par message et liées au créneau', () => {
    const keys = planBooked({ ...base, now }).map((j) => j.data.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.includes(ID))).toBe(true);
  });

  it('sans jeton scellé, la charge n’en porte pas', () => {
    const jobs = planBooked({ ...base, tk: undefined, now });
    expect(jobs.every((j) => !('tk' in j.data))).toBe(true);
  });
});

describe('planRescheduled : RDV déplacé', () => {
  const now = new Date('2026-11-25T10:00:00Z');
  const params = {
    appointmentId: ID,
    startsAt: new Date('2026-12-09T13:00:00Z'), // mercredi 9 décembre, 14h Paris
    smsEnabled: true,
    now,
    timeZone: TZ,
    tk: 'x',
  };

  it('prévient la cliente et la propriétaire, puis replanifie les rappels sur le nouvel horaire', () => {
    const jobs = planRescheduled(params);
    expect(jobs.map((j) => j.queue)).toEqual([
      QUEUES.change,
      QUEUES.ownerAlert,
      QUEUES.reminderD2,
      QUEUES.reminderD1,
    ]);
    expect(byQueue(jobs, QUEUES.change)?.data.kind).toBe('rescheduled');
    expect(iso(byQueue(jobs, QUEUES.reminderD2).startAfter)).toBe('2026-12-07T09:00:00.000Z');
    expect(iso(byQueue(jobs, QUEUES.reminderD1).startAfter)).toBe('2026-12-08T17:00:00.000Z');
  });

  it('deux déplacements successifs ne partagent aucune clé (donc aucun message perdu)', () => {
    const first = planRescheduled(params).map((j) => j.data.dedupeKey);
    const second = planRescheduled({ ...params, startsAt: new Date('2026-12-10T08:00:00Z') }).map(
      (j) => j.data.dedupeKey,
    );
    expect(first.filter((k) => second.includes(k))).toEqual([]);
  });

  it('les rappels de l’ancien créneau sont écartés à l’exécution', () => {
    const [oldReminder] = planReminders({ ...params, startsAt: new Date('2026-12-02T08:00:00Z') });
    const decision = evaluateJob(
      QUEUES.reminderD2,
      { status: 'confirmed', startsAt: params.startsAt, anonymized: false, hasReview: false },
      oldReminder.data,
      new Date('2026-11-30T09:00:00Z'),
    );
    expect(decision).toEqual({ send: false, reason: 'rescheduled' });
  });
});

describe('planCancelled : RDV annulé', () => {
  const now = new Date('2026-11-25T10:00:00Z');

  it('prévient la cliente et la propriétaire, sans nouveau rappel', () => {
    const jobs = planCancelled({ appointmentId: ID, by: 'client', now });
    expect(jobs.map((j) => j.queue)).toEqual([QUEUES.change, QUEUES.ownerAlert]);
    expect(jobs.every((j) => j.data.kind === 'cancelled_by_client')).toBe(true);
    expect(jobs.every((j) => iso(j.startAfter) === iso(now))).toBe(true);
  });

  it('distingue l’annulation par le salon', () => {
    const jobs = planCancelled({ appointmentId: ID, by: 'salon', now });
    expect(jobs[0].data.kind).toBe('cancelled_by_salon');
    expect(jobs[0].data.dedupeKey).not.toBe(
      planCancelled({ appointmentId: ID, by: 'client', now })[0].data.dedupeKey,
    );
  });
});

describe('planCompleted : statut « terminé »', () => {
  const completedAt = new Date('2026-12-02T12:30:00Z');

  it('demande d’avis 3 h après, relance unique 5 jours après la demande', () => {
    const jobs = planCompleted({ appointmentId: ID, completedAt });
    expect(jobs.map((j) => j.queue)).toEqual([QUEUES.reviewRequest, QUEUES.reviewReminder]);
    expect(iso(jobs[0].startAfter)).toBe('2026-12-02T15:30:00.000Z');
    expect(iso(jobs[1].startAfter)).toBe('2026-12-07T15:30:00.000Z');
  });

  it('les constantes du §7.6 sont celles attendues', () => {
    expect(TIMING.reviewRequestDelayMs).toBe(3 * 3_600_000);
    expect(TIMING.reviewReminderDelayMs).toBe(5 * 86_400_000);
    expect(TIMING.reviewLinkDays).toBe(30);
  });

  it('une seule demande et une seule relance par RDV : clés fixes', () => {
    const a = planCompleted({ appointmentId: ID, completedAt });
    const b = planCompleted({ appointmentId: ID, completedAt: new Date('2026-12-09T09:00:00Z') });
    expect(a.map((j) => j.data.dedupeKey)).toEqual(b.map((j) => j.data.dedupeKey));
  });
});

describe('evaluateJob : le job doit-il encore partir ?', () => {
  const startsAt = new Date('2026-12-02T08:00:00Z');
  const now = new Date('2026-11-30T09:00:00Z');
  /** @param {Partial<import('./plan.js').JobContext>} [over] */
  const ctx = (over = {}) => ({
    status: 'confirmed',
    startsAt,
    anonymized: false,
    hasReview: false,
    ...over,
  });
  const data = { appointmentId: ID, startsAt: startsAt.toISOString(), dedupeKey: 'k' };

  it('rappels : seulement pour un RDV confirmé, au même créneau, à venir', () => {
    for (const queue of [QUEUES.reminderD2, QUEUES.reminderD1]) {
      expect(evaluateJob(queue, ctx(), data, now)).toEqual({ send: true });
      expect(evaluateJob(queue, ctx({ status: 'cancelled_by_client' }), data, now)).toMatchObject({
        reason: 'not_confirmed',
      });
      expect(evaluateJob(queue, ctx({ status: 'pending' }), data, now)).toMatchObject({
        reason: 'not_confirmed',
      });
      expect(
        evaluateJob(queue, ctx({ startsAt: new Date('2026-12-03T08:00:00Z') }), data, now),
      ).toMatchObject({ reason: 'rescheduled' });
      expect(evaluateJob(queue, ctx(), data, new Date('2026-12-02T08:00:01Z'))).toMatchObject({
        reason: 'past',
      });
    }
  });

  it('confirmation : écartée si le RDV a été annulé avant l’envoi', () => {
    const job = { ...data, kind: 'created' };
    expect(evaluateJob(QUEUES.confirmation, ctx(), job, now)).toEqual({ send: true });
    expect(evaluateJob(QUEUES.confirmation, ctx({ status: 'pending' }), job, now)).toEqual({
      send: true,
    });
    expect(
      evaluateJob(QUEUES.confirmation, ctx({ status: 'cancelled_by_client' }), job, now),
    ).toMatchObject({ reason: 'not_active' });
  });

  it('alerte propriétaire : toujours envoyée, même si la cliente a annulé depuis', () => {
    expect(
      evaluateJob(QUEUES.ownerAlert, ctx({ status: 'cancelled_by_client' }), data, now),
    ).toEqual({ send: true });
  });

  it('message d’annulation : seulement si le RDV est bien annulé', () => {
    const job = { ...data, kind: 'cancelled_by_client' };
    expect(evaluateJob(QUEUES.change, ctx({ status: 'cancelled_by_client' }), job, now)).toEqual({
      send: true,
    });
    expect(evaluateJob(QUEUES.change, ctx({ status: 'confirmed' }), job, now)).toMatchObject({
      reason: 'not_cancelled',
    });
  });

  it('message de déplacement : écarté si le RDV a encore bougé depuis', () => {
    const job = { ...data, kind: 'rescheduled' };
    expect(evaluateJob(QUEUES.change, ctx(), job, now)).toEqual({ send: true });
    expect(
      evaluateJob(QUEUES.change, ctx({ startsAt: new Date('2026-12-05T08:00:00Z') }), job, now),
    ).toMatchObject({ reason: 'rescheduled_again' });
  });

  it('demande d’avis et relance : RDV terminé et aucun avis déjà déposé', () => {
    for (const queue of [QUEUES.reviewRequest, QUEUES.reviewReminder]) {
      expect(evaluateJob(queue, ctx({ status: 'completed' }), data, now)).toEqual({ send: true });
      expect(evaluateJob(queue, ctx({ status: 'no_show' }), data, now)).toMatchObject({
        reason: 'not_completed',
      });
      expect(
        evaluateJob(queue, ctx({ status: 'completed', hasReview: true }), data, now),
      ).toMatchObject({ reason: 'review_already_left' });
    }
  });

  it('cliente anonymisée (RGPD) : plus aucun envoi, quel que soit le job', () => {
    for (const queue of Object.values(QUEUES)) {
      expect(
        evaluateJob(queue, ctx({ status: 'completed', anonymized: true }), data, now),
      ).toMatchObject({ reason: 'client_anonymized' });
    }
  });

  it('file inconnue : on n’envoie rien', () => {
    expect(evaluateJob('autre', ctx(), data, now)).toMatchObject({ send: false });
  });
});
