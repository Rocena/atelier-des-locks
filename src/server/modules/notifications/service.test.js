// @ts-check
/**
 * Cycle de vie complet des notifications sur la base de test : planification → exécution des jobs
 * (file en mémoire, fournisseur console) → journal, idempotence, retries, garde-fous, avis.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testConfig, testPool } from '../../test-helpers.js';
import { site } from '../../lib/site.js';
import { createNotifier } from './service.js';
import { createConsoleProvider, ProviderError } from './providers.js';
import { createMemoryQueue } from './queue.js';
import { createAppointment } from '../booking/service.js';
import { bookingForm } from '../booking/schemas.js';
import { getReviewForm, submitReview } from '../reviews/service.js';

const NOW = new Date('2026-11-20T10:00:00Z');
const DOMAIN = '@notif.test.invalid';
const pool = testPool();
const config = testConfig({
  OWNER_EMAIL: 'proprio@notif.test.invalid',
  PUBLIC_URL: 'https://salon.example',
});

let counter = 0;
/** Réserve un RDV réel (créneaux distincts : mercredi 2, jeudi 3, vendredi 4 décembre 2026). */
async function book(/** @type {string} */ startsAt, extra = {}) {
  const form = bookingForm.parse({
    service: 'resserrage-palm-rolling',
    startsAt,
    firstName: 'Awa',
    lastName: 'Diallo',
    email: `awa${++counter}${DOMAIN}`,
    phone: '06 12 34 56 78',
    hairState: 'mature_locks',
    policy: 'on',
    smsReminders: 'on',
    ...extra,
  });
  return createAppointment(pool, { form, photoPath: null, now: NOW });
}

function setup(provider = createConsoleProvider({ log: () => {} })) {
  const queue = createMemoryQueue();
  let clock = NOW;
  const notifier = createNotifier({ db: pool, queue, provider, config, site, now: () => clock });
  const realRun = queue.runDue;
  queue.runDue = async (/** @type {Date} */ t) => {
    clock = t;
    return realRun(t);
  };
  return { queue, notifier, provider };
}
/** @param {any} provider @returns {any[]} */
const outboxOf = (provider) =>
  /** @type {import('./providers.js').OutboxEntry[]} */ (provider.outbox);
const logRows = async (/** @type {string} */ id) =>
  (
    await pool.query(
      `SELECT channel, template, status, error, attempts FROM notifications_log WHERE appointment_id = $1 ORDER BY channel, template`,
      [id],
    )
  ).rows;

beforeEach(async () => {
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});
async function cleanup() {
  const where = `SELECT a.id FROM appointments a JOIN clients c ON c.id = a.client_id WHERE c.email LIKE '%${DOMAIN}'`;
  await pool.query(`DELETE FROM reviews WHERE appointment_id IN (${where})`);
  await pool.query(`DELETE FROM appointments WHERE id IN (${where})`);
  await pool.query(`DELETE FROM clients WHERE email LIKE '%${DOMAIN}'`);
}

describe('réservation → jobs', () => {
  it('planifie 4 jobs sans donnée personnelle, rappels aux bonnes heures', async () => {
    const { queue, notifier } = setup();
    const { appointment, token } = await book('2026-12-02T08:00:00.000Z');
    await notifier.appointmentBooked({ appointmentId: appointment.id, token });
    expect(queue.jobs.map((j) => j.name)).toEqual([
      'notif-confirmation',
      'notif-owner-alert',
      'notif-reminder-d2',
      'notif-reminder-d1',
    ]);
    expect(queue.jobs[2].startAfter.toISOString()).toBe('2026-11-30T09:00:00.000Z');
    expect(queue.jobs[3].startAfter.toISOString()).toBe('2026-12-01T17:00:00.000Z');
    const payload = JSON.stringify(queue.jobs.map((j) => j.data));
    expect(payload).not.toMatch(/Awa|Diallo|@notif|\+33/);
    expect(payload).not.toContain(token); // jeton uniquement scellé
  });

  it('exécute confirmation + alerte : email avec .ics et lien, SMS, email propriétaire, journal', async () => {
    const { queue, notifier, provider } = setup();
    await notifier.registerWorkers();
    const { appointment, token } = await book('2026-12-02T08:00:00.000Z');
    await notifier.appointmentBooked({ appointmentId: appointment.id, token });
    expect(await queue.runDue(NOW)).toBe(2); // les rappels sont dans le futur
    const outbox = outboxOf(provider);
    const email = outbox.find((m) => m.channel === 'email' && m.to.startsWith('awa'));
    expect(email.html).toContain(`https://salon.example/rdv/${token}`);
    expect(email.attachments[0].content).toContain('BEGIN:VCALENDAR');
    expect(outbox.find((m) => m.channel === 'sms').text).toContain(`/rdv/${token}`);
    expect(outbox.find((m) => m.to === 'proprio@notif.test.invalid').subject).toMatch(
      /^Nouveau rendez-vous/,
    );
    const rows = await logRows(appointment.id);
    expect(rows.map((r) => `${r.channel}:${r.template}:${r.status}`)).toEqual([
      'email:booking_confirmation:sent',
      'email:owner_alert:sent',
      'sms:booking_confirmation:sent',
    ]);
  });

  it('rejouer un job n’envoie rien de plus (idempotence)', async () => {
    const { queue, notifier, provider } = setup();
    await notifier.registerWorkers();
    const { appointment, token } = await book('2026-12-02T14:00:00.000Z');
    await notifier.appointmentBooked({ appointmentId: appointment.id, token });
    await queue.runDue(NOW);
    const before = outboxOf(provider).length;
    await notifier.process('notif-confirmation', queue.jobs[0].data);
    await notifier.process('notif-confirmation', queue.jobs[0].data);
    expect(outboxOf(provider).length).toBe(before);
  });

  it('rappels le jour venu : email J-2 puis SMS J-1, avec lien de gestion', async () => {
    const { queue, notifier, provider } = setup();
    await notifier.registerWorkers();
    const { appointment, token } = await book('2026-12-03T08:00:00.000Z');
    await notifier.appointmentBooked({ appointmentId: appointment.id, token });
    await queue.runDue(NOW);
    const sent = outboxOf(provider).length;
    expect(await queue.runDue(new Date('2026-12-02T18:00:00Z'))).toBe(2);
    const outbox = outboxOf(provider).slice(sent);
    expect(outbox.map((m) => m.channel).sort()).toEqual(['email', 'sms']);
    expect(outbox.find((m) => m.channel === 'sms').text).toMatch(/^Rappel .*demain/);
  });

  it('RDV annulé avant le rappel : le rappel est écarté et journalisé « skipped »', async () => {
    const { queue, notifier, provider } = setup();
    await notifier.registerWorkers();
    const { appointment, token } = await book('2026-12-04T08:00:00.000Z');
    await notifier.appointmentBooked({ appointmentId: appointment.id, token });
    await queue.runDue(NOW);
    await pool.query(`UPDATE appointments SET status = 'cancelled_by_client' WHERE id = $1`, [
      appointment.id,
    ]);
    await notifier.appointmentCancelled({ appointmentId: appointment.id, by: 'client' });
    const sent = outboxOf(provider).length;
    await queue.runDue(new Date('2026-12-04T00:00:00Z'));
    const outbox = outboxOf(provider).slice(sent);
    // Seuls l'annulation (cliente + SMS) et l'alerte propriétaire partent, pas les rappels.
    expect(outbox.map((m) => m.subject ?? m.text).join('|')).not.toMatch(/Dans 2 jours|Rappel/);
    expect(outbox.some((m) => /annulé/i.test(m.subject ?? m.text))).toBe(true);
    const skipped = (await logRows(appointment.id)).filter((r) => r.status === 'skipped');
    expect(skipped.map((r) => r.error)).toContain('not_confirmed');
  });

  it('SMS non envoyé si la cliente les a refusés, avec la raison au journal', async () => {
    const { queue, notifier, provider } = setup();
    await notifier.registerWorkers();
    const { appointment, token } = await book('2026-12-04T14:00:00.000Z', {
      smsReminders: undefined,
    });
    await notifier.appointmentBooked({ appointmentId: appointment.id, token });
    expect(queue.jobs.map((j) => j.name)).not.toContain('notif-reminder-d1');
    await queue.runDue(NOW);
    expect(outboxOf(provider).some((m) => m.channel === 'sms')).toBe(false);
    expect((await logRows(appointment.id)).find((r) => r.channel === 'sms')).toMatchObject({
      status: 'skipped',
      error: 'sms_opt_out',
    });
  });
});

describe('pannes du fournisseur', () => {
  it('panne passagère : le job échoue (pg-boss réessaie), puis un seul email part', async () => {
    let failures = 1;
    const base = createConsoleProvider({ log: () => {} });
    const flaky = {
      ...base,
      async sendEmail(/** @type {any} */ m) {
        if (m.to.email.startsWith('awa') && failures-- > 0)
          throw new ProviderError('503', true, 503);
        return base.sendEmail(m);
      },
    };
    const { queue, notifier } = setup(flaky);
    const { appointment, token } = await book('2026-12-09T08:00:00.000Z');
    await notifier.appointmentBooked({ appointmentId: appointment.id, token });
    const job = queue.jobs[0];
    await expect(notifier.process(job.name, job.data)).rejects.toThrow('503');
    expect(
      (await logRows(appointment.id)).find(
        (r) => r.template === 'booking_confirmation' && r.channel === 'email',
      ),
    ).toMatchObject({ status: 'failed' });
    await notifier.process(job.name, job.data); // 2e essai
    const rows = await logRows(appointment.id);
    expect(rows.find((r) => r.channel === 'email')).toMatchObject({ status: 'sent', attempts: 2 });
    expect(base.outbox.filter((m) => m.channel === 'email')).toHaveLength(1);
    expect(base.outbox.filter((m) => m.channel === 'sms')).toHaveLength(1); // le SMS n'est pas renvoyé 2 fois
  });

  it('erreur définitive (adresse refusée) : journalisée, job non rejoué', async () => {
    const base = createConsoleProvider({ log: () => {} });
    const refusing = {
      ...base,
      sendEmail: async () => {
        throw new ProviderError('400 invalid email', false, 400);
      },
    };
    const { queue, notifier } = setup(refusing);
    const { appointment, token } = await book('2026-12-09T14:00:00.000Z');
    await notifier.appointmentBooked({ appointmentId: appointment.id, token });
    await expect(notifier.process(queue.jobs[0].name, queue.jobs[0].data)).resolves.toBeUndefined();
    expect(
      (await logRows(appointment.id)).find(
        (r) => r.channel === 'email' && r.template === 'booking_confirmation',
      ),
    ).toMatchObject({ status: 'failed', error: '400 invalid email' });
  });

  it('une file en panne ne fait pas échouer la réservation', async () => {
    const queue = {
      ...createMemoryQueue(),
      send: async () => {
        throw new Error('file indisponible');
      },
    };
    const errors = [];
    const notifier = createNotifier({
      db: pool,
      queue,
      provider: createConsoleProvider({ log: () => {} }),
      config,
      site,
      now: () => NOW,
      log: { info() {}, error: (o) => errors.push(o) },
    });
    const { appointment, token } = await book('2026-12-10T08:00:00.000Z');
    await expect(
      notifier.appointmentBooked({ appointmentId: appointment.id, token }),
    ).resolves.toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('demande d’avis', () => {
  it('3 h après « terminé » : email avec lien unique valable 30 jours ; l’avis est ensuite déposable', async () => {
    const { queue, notifier, provider } = setup();
    await notifier.registerWorkers();
    const { appointment } = await book('2026-12-10T14:00:00.000Z');
    await pool.query(`UPDATE appointments SET status = 'completed' WHERE id = $1`, [
      appointment.id,
    ]);
    const completedAt = new Date('2026-12-10T17:00:00Z');
    await notifier.appointmentCompleted({ appointmentId: appointment.id, completedAt });
    expect(queue.jobs.map((j) => j.startAfter.toISOString())).toEqual([
      '2026-12-10T20:00:00.000Z',
      '2026-12-15T20:00:00.000Z',
    ]);

    expect(await queue.runDue(new Date('2026-12-10T19:59:00Z'))).toBe(0);
    expect(await queue.runDue(new Date('2026-12-10T20:00:00Z'))).toBe(1);
    const email = outboxOf(provider).find((m) => m.subject?.startsWith('Comment s’est passé'));
    const token = /https:\/\/salon\.example\/avis\/laisser\/([A-Za-z0-9_-]{43})/.exec(
      email.html,
    )?.[1];
    expect(token).toBeTruthy();
    const now = new Date('2026-12-11T10:00:00Z');
    const form = await getReviewForm(pool, /** @type {string} */ (token), now);
    expect(form.state).toBe('open');
    const { rows } = await pool.query(
      `SELECT expires_at FROM review_tokens WHERE appointment_id = $1`,
      [appointment.id],
    );
    expect(rows[0].expires_at.toISOString()).toBe('2027-01-09T20:00:00.000Z'); // +30 jours
    // Seule l'empreinte est en base.
    expect(JSON.stringify(rows)).not.toContain(/** @type {string} */ (token));

    // La relance part à J+5 si aucun avis n'a été laissé, avec un nouveau lien, une seule fois.
    expect(await queue.runDue(new Date('2026-12-15T20:00:00Z'))).toBe(1);
    expect(outboxOf(provider).filter((m) => m.subject?.startsWith('Un petit mot'))).toHaveLength(1);
    await notifier.process('notif-review-reminder', queue.jobs[1].data);
    expect(outboxOf(provider).filter((m) => m.subject?.startsWith('Un petit mot'))).toHaveLength(1);
  });

  it('pas de relance si l’avis a été laissé entre-temps', async () => {
    const { queue, notifier, provider } = setup();
    await notifier.registerWorkers();
    const { appointment } = await book('2026-12-11T08:00:00.000Z');
    await pool.query(`UPDATE appointments SET status = 'completed' WHERE id = $1`, [
      appointment.id,
    ]);
    await notifier.appointmentCompleted({
      appointmentId: appointment.id,
      completedAt: new Date('2026-12-11T12:00:00Z'),
    });
    await queue.runDue(new Date('2026-12-11T15:00:00Z'));
    const email = outboxOf(provider).find((m) => m.subject?.startsWith('Comment'));
    const token = /avis\/laisser\/([A-Za-z0-9_-]{43})/.exec(email.html)?.[1] ?? '';
    await submitReview(pool, {
      token,
      form: { rating: 5, body: 'Superbe travail, merci !', firstName: 'Awa', lastInitial: 'D' },
      photoPath: null,
      now: new Date('2026-12-12T09:00:00Z'),
    });
    await queue.runDue(new Date('2026-12-17T00:00:00Z'));
    expect(outboxOf(provider).some((m) => m.subject?.startsWith('Un petit mot'))).toBe(false);
    expect(
      (await logRows(appointment.id)).find((r) => r.template === 'review_reminder'),
    ).toMatchObject({ status: 'skipped', error: 'review_already_left' });
  });
});
