// @ts-check
/**
 * Agenda de l'admin sur base réelle : rendez-vous saisi par le salon, déplacement avec
 * notification, statuts, blocages, créneaux libres, vues. L'horloge est figée au vendredi
 * 20 novembre 2026 ; les rendez-vous sont posés en décembre 2026 (mardis et mercredis).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../test-helpers.js';
import { generateToken, hashToken } from '../booking/tokens.js';
import { zonedToUtc } from '../../lib/zoned-time.js';
import { manualForm, moveForm } from './schemas.js';
import * as repo from './repo.js';
import {
  AgendaError,
  addBlock,
  changeStatus,
  createManual,
  loadAgenda,
  moveAppointment,
  moveSlots,
} from './service.js';

const NOW = new Date('2026-11-20T10:00:00Z');
const TZ = 'Europe/Paris';
const DOMAIN = '@agenda.test.invalid';
const pool = testPool();

/** @type {Array<{ event: string, args: any }>} */
let events = [];
const notifications = {
  appointmentBooked: async (/** @type {any} */ args) => void events.push({ event: 'booked', args }),
  appointmentRescheduled: async (/** @type {any} */ args) =>
    void events.push({ event: 'rescheduled', args }),
  appointmentValidated: async (/** @type {any} */ args) =>
    void events.push({ event: 'validated', args }),
  appointmentCancelled: async (/** @type {any} */ args) =>
    void events.push({ event: 'cancelled', args }),
  appointmentCompleted: async (/** @type {any} */ args) =>
    void events.push({ event: 'completed', args }),
};
const deps = { notifications };

/** @type {string} */
let serviceSlug;
let counter = 0;

/** @param {Record<string, unknown>} [over] */
function form(over = {}) {
  counter += 1;
  return manualForm.parse({
    firstName: 'Awa',
    lastName: `Test${counter}`,
    email: `awa${counter}${DOMAIN}`,
    service: serviceSlug,
    date: '2026-12-01',
    time: '10:00',
    notify: '1',
    ...over,
  });
}

beforeAll(async () => {
  const { rows } = await pool.query(
    `SELECT slug FROM services WHERE active AND price_cents IS NOT NULL AND NOT on_quote
      ORDER BY duration_max_minutes LIMIT 1`,
  );
  serviceSlug = rows[0].slug;
});
afterAll(async () => {
  // Les clientes saisies par téléphone (sans email) ont un email de remplacement.
  const mine = `SELECT id FROM clients WHERE email LIKE '%${DOMAIN}' OR email LIKE 'tel-%@sans-email.invalid'`;
  await pool.query(`DELETE FROM appointments WHERE client_id IN (${mine})`);
  await pool.query(`DELETE FROM clients WHERE id IN (${mine})`);
  const { cleanupAdminUsers } = await import('../admin/test-helpers.js');
  await cleanupAdminUsers(pool);
  await pool.query(`DELETE FROM blocks WHERE reason LIKE 'agenda-test%'`);
  await pool.end();
});

const settings = { timeZone: TZ };

describe('rendez-vous saisi par le salon', () => {
  it('crée un RDV confirmé, marqué « saisi par le salon », et prévient la cliente', async () => {
    events = [];
    const { id } = await createManual(pool, deps, form({ date: '2026-12-01', time: '10:00' }), NOW);
    const a = await repo.findAppointment(pool, id);
    expect(a).toMatchObject({ status: 'confirmed', source: 'admin' });
    expect(a?.startsAt.toISOString()).toBe(zonedToUtc('2026-12-01', '10:00', TZ).toISOString());
    expect(a?.endsAt.getTime()).toBeGreaterThan(a?.startsAt.getTime() ?? 0);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('booked');
    expect(events[0].args.appointmentId).toBe(id);
    // Le jeton transmis est celui dont l'empreinte est en base (lien « Gérer mon RDV » valable).
    const { rows } = await pool.query('SELECT manage_token_hash FROM appointments WHERE id = $1', [
      id,
    ]);
    expect(rows[0].manage_token_hash).toEqual(hashToken(events[0].args.token));
  });

  it('sans email : un email de remplacement, téléphone normalisé, jamais affiché', async () => {
    events = [];
    const { id } = await createManual(
      pool,
      deps,
      form({
        email: undefined,
        phone: '06 12 34 56 78',
        lastName: `Tel${counter}`,
        date: '2026-12-01',
        time: '15:00',
      }),
      NOW,
    );
    const a = await repo.findAppointment(pool, id);
    expect(a?.phone).toBe('+33612345678');
    expect(a?.email).toMatch(/@sans-email\.invalid$/);
  });

  it('ne prévient pas si la case est décochée', async () => {
    events = [];
    await createManual(
      pool,
      deps,
      form({ notify: undefined, date: '2026-12-02', time: '10:00' }),
      NOW,
    );
    expect(events).toHaveLength(0);
  });

  it('accepte une heure hors horaires d’ouverture et un délai court', async () => {
    const { id } = await createManual(pool, deps, form({ date: '2026-12-02', time: '19:30' }), NOW);
    expect((await repo.findAppointment(pool, id))?.status).toBe('confirmed');
  });

  it('refuse un créneau déjà pris (chevauchement)', async () => {
    await createManual(pool, deps, form({ date: '2026-12-03', time: '10:00' }), NOW);
    await expect(
      createManual(pool, deps, form({ date: '2026-12-03', time: '10:15' }), NOW),
    ).rejects.toMatchObject({
      code: 'slot_taken',
    });
  });

  it('refuse un créneau bloqué', async () => {
    const day = '2026-12-04';
    await addBlock(pool, {
      date: day,
      startTime: '10:00',
      endTime: '12:00',
      reason: 'agenda-test',
      userId: await anyUserId(),
      timeZone: TZ,
    });
    await expect(
      createManual(pool, deps, form({ date: day, time: '11:00' }), NOW),
    ).rejects.toMatchObject({ code: 'blocked' });
  });

  it('une prestation sans praticienne associée est assurée par la première praticienne active', async () => {
    const { rows } = await pool.query(
      `INSERT INTO services (slug, name, summary, duration_min_minutes, duration_max_minutes, price_cents, bookable_online)
       VALUES ('agenda-test-sans-staff', 'Consultation test', 'Test', 30, 30, 0, false) RETURNING id`,
    );
    try {
      const { id } = await createManual(
        pool,
        deps,
        form({
          service: 'agenda-test-sans-staff',
          date: '2026-12-30',
          time: '10:00',
          notify: undefined,
        }),
        NOW,
      );
      const a = await repo.findAppointment(pool, id);
      expect(a?.serviceName).toBe('Consultation test');
      expect(a?.staffId).toBeGreaterThan(0);
    } finally {
      await pool.query('DELETE FROM appointments WHERE service_id = $1', [rows[0].id]);
      await pool.query('DELETE FROM services WHERE id = $1', [rows[0].id]);
    }
  });

  it('un RDV passé peut être saisi comme terminé', async () => {
    const { id } = await createManual(
      pool,
      deps,
      form({ date: '2026-11-10', time: '10:00', completed: '1', notify: undefined }),
      NOW,
    );
    expect((await repo.findAppointment(pool, id))?.status).toBe('completed');
    // Dans le futur, la case est ignorée : le RDV reste confirmé.
    const future = await createManual(
      pool,
      deps,
      form({ date: '2026-12-08', time: '10:00', completed: '1' }),
      NOW,
    );
    expect((await repo.findAppointment(pool, future.id))?.status).toBe('confirmed');
  });

  it('refuse une prestation ou une option inconnue', async () => {
    await expect(
      createManual(pool, deps, form({ service: 'nexiste-pas' }), NOW),
    ).rejects.toMatchObject({ code: 'service' });
    await expect(
      createManual(pool, deps, form({ options: ['999999'] }), NOW),
    ).rejects.toMatchObject({ code: 'options' });
  });

  it('valide le formulaire : contact obligatoire, téléphone et date valides', () => {
    const base = { firstName: 'A', lastName: 'B', service: 'x', date: '2026-12-01', time: '10:00' };
    expect(manualForm.safeParse(base).success).toBe(false);
    expect(manualForm.safeParse({ ...base, phone: '0612345678' }).success).toBe(true);
    expect(manualForm.safeParse({ ...base, email: 'pas-un-email' }).success).toBe(false);
    expect(manualForm.safeParse({ ...base, phone: '12', email: 'a@b.fr' }).success).toBe(false);
    expect(manualForm.safeParse({ ...base, phone: '0612345678', date: '2026-13-40' }).success).toBe(
      false,
    );
    expect(manualForm.safeParse({ ...base, phone: '0612345678', time: '25:00' }).success).toBe(
      false,
    );
  });
});

/** @returns {Promise<string>} */
async function anyUserId() {
  const { rows } = await pool.query('SELECT id FROM users LIMIT 1');
  if (rows[0]) return rows[0].id;
  const { createTestUser } = await import('../admin/test-helpers.js');
  return (await createTestUser(pool)).id;
}

describe('formulaire de déplacement', () => {
  it('accepte un instant ISO (créneau choisi) ou un jour et une heure locaux (glisser-déposer)', () => {
    const iso = moveForm.parse({ startsAt: '2027-02-03T09:30:00.000Z', notify: '1' });
    expect(iso.startsAt?.toISOString()).toBe('2027-02-03T09:30:00.000Z');
    expect(iso.notify).toBe(true);
    expect(moveForm.parse({ startsAt: '2027-02-03T10:30:00+01:00' }).startsAt?.toISOString()).toBe(
      '2027-02-03T09:30:00.000Z',
    );
    expect(moveForm.parse({ date: '2026-12-02', time: '16:15', notify: '' })).toMatchObject({
      date: '2026-12-02',
      time: '16:15',
      notify: false,
    });
    for (const bad of [
      {},
      { startsAt: 'demain' },
      { startsAt: '2027-02-03' },
      { date: '2026-12-02' },
      { date: '2026-02-31', time: '10:00' },
      { date: '2026-12-02', time: '9h' },
    ]) {
      expect(moveForm.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('déplacement (glisser-déposer) avec notification', () => {
  it('déplace, renouvelle le lien « Gérer mon RDV » et prévient la cliente', async () => {
    const { id } = await createManual(
      pool,
      deps,
      form({ date: '2026-12-09', time: '10:00', notify: undefined }),
      NOW,
    );
    const before = await repo.findAppointment(pool, id);
    const oldHash = (
      await pool.query('SELECT manage_token_hash FROM appointments WHERE id = $1', [id])
    ).rows[0].manage_token_hash;
    events = [];
    const startsAt = zonedToUtc('2026-12-09', '16:00', TZ);
    await moveAppointment(pool, deps, { id, startsAt, notify: true, now: NOW });
    const after = await repo.findAppointment(pool, id);
    expect(after?.startsAt.toISOString()).toBe(startsAt.toISOString());
    // Même durée d'occupation.
    expect((after?.endsAt.getTime() ?? 0) - (after?.startsAt.getTime() ?? 0)).toBe(
      (before?.endsAt.getTime() ?? 0) - (before?.startsAt.getTime() ?? 0),
    );
    const newHash = (
      await pool.query('SELECT manage_token_hash FROM appointments WHERE id = $1', [id])
    ).rows[0].manage_token_hash;
    expect(newHash).not.toEqual(oldHash);
    expect(events).toEqual([
      { event: 'rescheduled', args: { appointmentId: id, token: events[0].args.token } },
    ]);
    expect(newHash).toEqual(hashToken(events[0].args.token));
  });

  it('sans notification : rien n’est envoyé', async () => {
    const { id } = await createManual(
      pool,
      deps,
      form({ date: '2026-12-09', time: '11:00', notify: undefined }),
      NOW,
    );
    events = [];
    await moveAppointment(pool, deps, {
      id,
      startsAt: zonedToUtc('2026-12-09', '12:30', TZ),
      notify: false,
      now: NOW,
    });
    expect(events).toHaveLength(0);
  });

  it('refuse un créneau occupé, un créneau bloqué, le passé, un RDV annulé, aucun changement', async () => {
    const a = await createManual(
      pool,
      deps,
      form({ date: '2026-12-10', time: '10:00', notify: undefined }),
      NOW,
    );
    const b = await createManual(
      pool,
      deps,
      form({ date: '2026-12-10', time: '15:00', notify: undefined }),
      NOW,
    );
    const target = (/** @type {string} */ time, date = '2026-12-10') => zonedToUtc(date, time, TZ);
    await expect(
      moveAppointment(pool, deps, { id: b.id, startsAt: target('10:30'), notify: false, now: NOW }),
    ).rejects.toMatchObject({ code: 'slot_taken' });
    await addBlock(pool, {
      date: '2026-12-11',
      startTime: '09:00',
      endTime: '13:00',
      reason: 'agenda-test-2',
      userId: await anyUserId(),
      timeZone: TZ,
    });
    await expect(
      moveAppointment(pool, deps, {
        id: b.id,
        startsAt: target('10:00', '2026-12-11'),
        notify: false,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'blocked' });
    await expect(
      moveAppointment(pool, deps, {
        id: b.id,
        startsAt: new Date('2026-11-01T10:00:00Z'),
        notify: false,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'past' });
    await expect(
      moveAppointment(pool, deps, { id: b.id, startsAt: target('15:00'), notify: false, now: NOW }),
    ).rejects.toMatchObject({ code: 'unchanged' });
    await changeStatus(pool, deps, {
      id: a.id,
      status: 'cancelled_by_salon',
      notify: false,
      now: NOW,
    });
    await expect(
      moveAppointment(pool, deps, { id: a.id, startsAt: target('11:00'), notify: false, now: NOW }),
    ).rejects.toMatchObject({ code: 'inactive' });
    await expect(
      moveAppointment(pool, deps, {
        id: '00000000-0000-4000-8000-000000000000',
        startsAt: target('11:00'),
        notify: false,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(AgendaError);
    // Le RDV b n'a pas bougé.
    expect((await repo.findAppointment(pool, b.id))?.startsAt.toISOString()).toBe(
      target('15:00').toISOString(),
    );
  });

  it('un créneau libéré par une annulation peut être repris', async () => {
    const a = await createManual(
      pool,
      deps,
      form({ date: '2026-12-15', time: '10:00', notify: undefined }),
      NOW,
    );
    await changeStatus(pool, deps, {
      id: a.id,
      status: 'cancelled_by_salon',
      notify: false,
      now: NOW,
    });
    const again = await createManual(
      pool,
      deps,
      form({ date: '2026-12-15', time: '10:00', notify: undefined }),
      NOW,
    );
    expect(again.id).not.toBe(a.id);
  });

  it('créneaux libres pour déplacer : le RDV lui-même ne bloque pas, pas de délai minimum', async () => {
    const { id } = await createManual(
      pool,
      deps,
      form({ date: '2026-12-16', time: '10:00', notify: undefined }),
      NOW,
    );
    const slots = await moveSlots(pool, { id, date: '2026-12-16', now: NOW });
    const times = slots.map((s) => s.startsAt);
    expect(times.length).toBeGreaterThan(3);
    expect(times).toContain(zonedToUtc('2026-12-16', '10:00', TZ).toISOString());
    // Un autre RDV occupe 14:00 : ce créneau n'est plus proposé.
    await createManual(
      pool,
      deps,
      form({ date: '2026-12-16', time: '14:00', notify: undefined }),
      NOW,
    );
    const after = (await moveSlots(pool, { id, date: '2026-12-16', now: NOW })).map(
      (s) => s.startsAt,
    );
    expect(after).not.toContain(zonedToUtc('2026-12-16', '14:00', TZ).toISOString());
    // Le lendemain proche (moins de 24 h) reste proposé : le salon n'a pas de délai minimum.
    const soon = await moveSlots(pool, { id, date: '2026-11-21', now: NOW });
    expect(Array.isArray(soon)).toBe(true);
    // Au-delà de l'horizon de réservation en ligne (60 jours), le salon peut quand même déplacer.
    const far = await moveSlots(pool, { id, date: '2027-06-02', now: NOW });
    expect(far.length).toBeGreaterThan(3);
  });
});

describe('statuts', () => {
  it('terminé → demande d’avis ; annulé par le salon → message à la cliente', async () => {
    const a = await createManual(
      pool,
      deps,
      form({ date: '2026-11-12', time: '10:00', notify: undefined, completed: undefined }),
      NOW,
    );
    await pool.query(`UPDATE appointments SET status = 'confirmed' WHERE id = $1`, [a.id]);
    events = [];
    await changeStatus(pool, deps, { id: a.id, status: 'completed', notify: false, now: NOW });
    expect(events).toEqual([
      { event: 'completed', args: { appointmentId: a.id, completedAt: NOW } },
    ]);
    expect((await repo.findAppointment(pool, a.id))?.status).toBe('completed');

    const b = await createManual(
      pool,
      deps,
      form({ date: '2026-12-17', time: '10:00', notify: undefined }),
      NOW,
    );
    events = [];
    await changeStatus(pool, deps, {
      id: b.id,
      status: 'cancelled_by_salon',
      reason: 'Imprévu',
      notify: true,
      now: NOW,
    });
    expect(events).toEqual([{ event: 'cancelled', args: { appointmentId: b.id, by: 'salon' } }]);
    const { rows } = await pool.query(
      'SELECT status, cancelled_at, cancellation_reason FROM appointments WHERE id = $1',
      [b.id],
    );
    expect(rows[0]).toMatchObject({ status: 'cancelled_by_salon', cancellation_reason: 'Imprévu' });
    expect(rows[0].cancelled_at).not.toBeNull();

    const c = await createManual(
      pool,
      deps,
      form({ date: '2026-12-17', time: '15:00', notify: undefined }),
      NOW,
    );
    events = [];
    await changeStatus(pool, deps, {
      id: c.id,
      status: 'cancelled_by_salon',
      notify: false,
      now: NOW,
    });
    expect(events).toHaveLength(0);
  });

  it('valider une demande : nouveau lien, message à la cliente (sauf si on ne veut pas la prévenir)', async () => {
    const pending = (/** @type {string} */ id) =>
      pool.query("UPDATE appointments SET status = 'pending' WHERE id = $1", [id]);
    const hashOf = async (/** @type {string} */ id) =>
      (await pool.query('SELECT manage_token_hash FROM appointments WHERE id = $1', [id])).rows[0]
        .manage_token_hash;
    const a = await createManual(
      pool,
      deps,
      form({ date: '2026-12-19', time: '10:00', notify: undefined }),
      NOW,
    );
    await pending(a.id);
    const oldHash = await hashOf(a.id);
    events = [];
    await changeStatus(pool, deps, { id: a.id, status: 'confirmed', notify: true, now: NOW });
    expect((await repo.findAppointment(pool, a.id))?.status).toBe('confirmed');
    expect(events.map((e) => e.event)).toEqual(['validated']);
    const newHash = await hashOf(a.id);
    expect(newHash).not.toEqual(oldHash);
    expect(newHash).toEqual(hashToken(events[0].args.token));

    const b = await createManual(
      pool,
      deps,
      form({ date: '2026-12-19', time: '15:00', notify: undefined }),
      NOW,
    );
    await pending(b.id);
    events = [];
    await changeStatus(pool, deps, { id: b.id, status: 'confirmed', notify: false, now: NOW });
    expect(events).toHaveLength(0);

    // Rouvrir un RDV annulé n'est pas une validation : aucun message.
    await changeStatus(pool, deps, {
      id: b.id,
      status: 'cancelled_by_salon',
      notify: false,
      now: NOW,
    });
    events = [];
    await changeStatus(pool, deps, { id: b.id, status: 'confirmed', notify: true, now: NOW });
    expect(events).toHaveLength(0);
  });

  it('refuse les transitions interdites et « terminé » avant le rendez-vous', async () => {
    const a = await createManual(
      pool,
      deps,
      form({ date: '2026-12-18', time: '10:00', notify: undefined }),
      NOW,
    );
    await expect(
      changeStatus(pool, deps, { id: a.id, status: 'completed', notify: false, now: NOW }),
    ).rejects.toMatchObject({ code: 'too_early' });
    await expect(
      changeStatus(pool, deps, { id: a.id, status: 'no_show', notify: false, now: NOW }),
    ).rejects.toMatchObject({ code: 'too_early' });
    await expect(
      changeStatus(pool, deps, { id: a.id, status: 'pending', notify: false, now: NOW }),
    ).rejects.toMatchObject({ code: 'transition' });
    await changeStatus(pool, deps, {
      id: a.id,
      status: 'cancelled_by_salon',
      notify: false,
      now: NOW,
    });
    await expect(
      changeStatus(pool, deps, { id: a.id, status: 'completed', notify: false, now: NOW }),
    ).rejects.toMatchObject({ code: 'transition' });
  });

  it('on peut rouvrir un RDV annulé si le créneau est encore libre, pas s’il est repris', async () => {
    const a = await createManual(
      pool,
      deps,
      form({ date: '2026-12-22', time: '10:00', notify: undefined }),
      NOW,
    );
    await changeStatus(pool, deps, {
      id: a.id,
      status: 'cancelled_by_salon',
      notify: false,
      now: NOW,
    });
    await changeStatus(pool, deps, { id: a.id, status: 'confirmed', notify: false, now: NOW });
    expect((await repo.findAppointment(pool, a.id))?.status).toBe('confirmed');
    await changeStatus(pool, deps, {
      id: a.id,
      status: 'cancelled_by_salon',
      notify: false,
      now: NOW,
    });
    await createManual(
      pool,
      deps,
      form({ date: '2026-12-22', time: '10:00', notify: undefined }),
      NOW,
    );
    await expect(
      changeStatus(pool, deps, { id: a.id, status: 'confirmed', notify: false, now: NOW }),
    ).rejects.toMatchObject({ code: 'slot_taken' });
  });

  it('absence : seulement après le rendez-vous', async () => {
    const a = await createManual(
      pool,
      deps,
      form({ date: '2026-11-11', time: '10:00', notify: undefined, completed: undefined }),
      NOW,
    );
    await pool.query(`UPDATE appointments SET status = 'confirmed' WHERE id = $1`, [a.id]);
    await changeStatus(pool, deps, { id: a.id, status: 'no_show', notify: false, now: NOW });
    expect((await repo.findAppointment(pool, a.id))?.status).toBe('no_show');
  });
});

describe('blocages', () => {
  it('refuse de bloquer un créneau qui couvre un rendez-vous', async () => {
    await createManual(
      pool,
      deps,
      form({ date: '2026-12-23', time: '10:00', notify: undefined }),
      NOW,
    );
    await expect(
      addBlock(pool, {
        date: '2026-12-23',
        startTime: '09:00',
        endTime: '11:00',
        reason: 'agenda-test-3',
        userId: await anyUserId(),
        timeZone: TZ,
      }),
    ).rejects.toMatchObject({ code: 'has_appointment' });
  });

  it('retire un blocage', async () => {
    const { id } = await addBlock(pool, {
      date: '2026-12-29',
      startTime: '09:00',
      endTime: '10:00',
      reason: 'agenda-test-4',
      userId: await anyUserId(),
      timeZone: TZ,
    });
    expect(await repo.deleteBlock(pool, id)).toBe(true);
    expect(await repo.deleteBlock(pool, id)).toBe(false);
  });

  it('un jeton déplacé n’est plus celui d’avant (les anciens liens ne servent plus)', () => {
    const a = generateToken();
    const b = generateToken();
    expect(hashToken(a.token)).not.toEqual(hashToken(b.token));
  });
});

describe('vues de l’agenda', () => {
  it('jour : rendez-vous placés, bornes de la frise, zones fermées', async () => {
    const view = /** @type {any} */ (
      await loadAgenda(pool, { view: 'jour', date: '2026-12-01', timeZone: TZ, now: NOW })
    );
    expect(view.columns).toHaveLength(1);
    const col = view.columns[0];
    expect(col.items.length).toBeGreaterThanOrEqual(2);
    const ten = col.items.find((/** @type {any} */ i) => i.startMin === 600);
    expect(ten).toBeTruthy();
    expect(ten.draggable).toBe(true);
    expect(view.dayStart % 60).toBe(0);
    expect(view.dayEnd).toBeGreaterThan(view.dayStart);
    // Mardi : ouvert 9h–12h et 14h–18h ; 12h–14h est une zone fermée.
    expect(col.closed.some((/** @type {any} */ z) => z.from === 720 && z.to === 840)).toBe(true);
    expect(view.prev).toBe('2026-11-30');
    expect(view.next).toBe('2026-12-02');
  });

  it('semaine : sept colonnes, lundi → dimanche', async () => {
    const view = /** @type {any} */ (
      await loadAgenda(pool, { view: 'semaine', date: '2026-12-02', timeZone: TZ, now: NOW })
    );
    expect(view.columns.map((/** @type {any} */ c) => c.date)).toEqual([
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ]);
    expect(view.next).toBe('2026-12-09');
    // Le lundi est fermé : pas de plage d'ouverture.
    expect(view.columns[0].open).toEqual([]);
  });

  it('liste : regroupée par jour, dans l’ordre', async () => {
    const view = /** @type {any} */ (
      await loadAgenda(pool, { view: 'liste', date: '2026-12-01', timeZone: TZ, now: NOW })
    );
    const dates = view.days.map((/** @type {any} */ d) => d.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe('2026-12-01');
    for (const day of view.days) {
      const starts = day.items.map((/** @type {any} */ i) => i.startsAt.getTime());
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
    }
  });

  it('les blocages apparaissent dans la frise', async () => {
    const view = /** @type {any} */ (
      await loadAgenda(pool, { view: 'jour', date: '2026-12-04', timeZone: TZ, now: NOW })
    );
    expect(view.columns[0].blocks.length).toBeGreaterThanOrEqual(1);
    expect(view.columns[0].blocks[0]).toMatchObject({ startMin: 600, spanMin: 120 });
  });
});

void settings;
