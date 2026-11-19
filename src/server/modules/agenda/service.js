// @ts-check
/**
 * Cas d'usage de l'agenda de l'admin : vues jour / semaine / liste, rendez-vous saisi par le
 * salon, déplacement (glisser-déposer) avec notification, changement de statut, blocages.
 * Les règles de planning (chevauchement) sont portées par la base (contrainte d'exclusion) ;
 * les notifications ne lèvent jamais d'erreur (le RDV est déjà enregistré).
 */
import { computeAvailability } from '../booking/availability.js';
import { computeBooking } from '../booking/policy.js';
import { normalizePhone } from '../booking/schemas.js';
import { generateToken } from '../booking/tokens.js';
import * as bookingRepo from '../booking/repo.js';
import { MANAGE_LINK_DAYS_AFTER, availabilityInput, isOverlap } from '../booking/service.js';
import { placeholderEmailFor } from '../clients/placeholder.js';
import { addDays, utcToZoned, zonedToUtc } from '../../lib/zoned-time.js';
import * as repo from './repo.js';
import {
  closedRanges,
  hourMarks,
  localDate,
  openRanges,
  place,
  timeToMinutes,
  timelineBounds,
  weekDates,
} from './timeline.js';

const DAY = 86_400_000;
const MINUTE = 60_000;

export class AgendaError extends Error {
  /**
   * @param {'not_found'|'service'|'options'|'no_staff'|'slot_taken'|'blocked'|'inactive'|'past'|'too_early'|'transition'|'has_appointment'|'unchanged'} code
   */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Transitions de statut autorisées (corrections comprises). */
export const TRANSITIONS = /** @type {Record<string, string[]>} */ ({
  pending: ['confirmed', 'cancelled_by_salon'],
  confirmed: ['completed', 'no_show', 'cancelled_by_salon'],
  completed: ['no_show', 'confirmed'],
  no_show: ['completed', 'confirmed'],
  cancelled_by_client: ['confirmed'],
  cancelled_by_salon: ['confirmed'],
});

/** @param {string} from @param {string} to @param {string} tz */
const dayRange = (from, to, tz) => ({
  from: zonedToUtc(from, '00:00', tz),
  to: zonedToUtc(addDays(to, 1), '00:00', tz),
});

/**
 * Données d'une vue de l'agenda.
 * @param {import('pg').Pool} db
 * @param {{ view: 'jour'|'semaine'|'liste', date: string, timeZone: string, now: Date }} q
 */
export async function loadAgenda(db, { view, date, timeZone, now }) {
  const today = utcToZoned(now, timeZone).date;
  if (view === 'liste') {
    const to = addDays(date, 60);
    const range = dayRange(date, to, timeZone);
    const appointments = await repo.findAppointments(db, { ...range, limit: 300 });
    /** @type {{ date: string, items: repo.AgendaAppointment[] }[]} */
    const days = [];
    for (const a of appointments) {
      const d = localDate(a.startsAt, timeZone);
      const last = days.at(-1);
      if (last && last.date === d) last.items.push(a);
      else days.push({ date: d, items: [a] });
    }
    return { view, date, today, days, prev: addDays(date, -60), next: to };
  }

  const dates = view === 'jour' ? [date] : weekDates(date);
  const range = dayRange(dates[0], dates[dates.length - 1], timeZone);
  const [appointments, blocks, staff] = await Promise.all([
    repo.findAppointments(db, range),
    repo.findBlocks(db, range.from, range.to),
    repo.findActiveStaff(db),
  ]);
  const staffIds = staff.map((s) => s.id);
  const planning = await bookingRepo.findPlanning(db, {
    staffIds,
    fromDate: dates[0],
    toDate: dates[dates.length - 1],
    fromInstant: range.from,
    toInstant: range.to,
  });

  const columns = dates.map((d) => {
    const items = appointments
      .filter((a) => localDate(a.startsAt, timeZone) === d)
      .map((a) => ({
        ...a,
        ...place(a, d, timeZone),
        draggable: a.status === 'pending' || a.status === 'confirmed',
      }));
    const dayBlocks = blocks
      .filter((b) => localDate(b.startsAt, timeZone) === d)
      .map((b) => ({ ...b, ...place({ startsAt: b.startsAt, endsAt: b.endsAt }, d, timeZone) }));
    return {
      date: d,
      items,
      blocks: dayBlocks,
      open: openRanges(d, planning.weeklyHours, planning.closures),
    };
  });
  const bounds = timelineBounds(
    columns.flatMap((c) => [...c.items, ...c.blocks]),
    columns.map((c) => c.open),
  );
  const nowMin = dates.includes(today) ? timeToMinutes(utcToZoned(now, timeZone).time) : null;
  return {
    view,
    date,
    today,
    ...bounds,
    marks: hourMarks(bounds.dayStart, bounds.dayEnd),
    nowMin,
    columns: columns.map((c) => ({
      ...c,
      closed: closedRanges(c.open, bounds.dayStart, bounds.dayEnd),
    })),
    prev: addDays(date, view === 'jour' ? -1 : -7),
    next: addDays(date, view === 'jour' ? 1 : 7),
  };
}

/**
 * Prestations et praticiennes pour le formulaire de RDV manuel.
 * @param {import('pg').Pool} db
 */
export async function manualFormData(db) {
  const [services, staff, settings] = await Promise.all([
    bookingRepo.findServicesForBooking(db),
    repo.findActiveStaff(db),
    bookingRepo.findBookingSettings(db),
  ]);
  return { services, staff, settings };
}

/**
 * RDV saisi par le salon (téléphone, WhatsApp, sur place). Contrairement à la réservation en
 * ligne : hors horaires d'ouverture possible, pas de délai minimum, prestations « sur devis »
 * autorisées. Jamais de chevauchement (RDV ou blocage).
 * @param {import('pg').Pool} pool
 * @param {{ notifications: any }} deps
 * @param {import('zod').infer<typeof import('./schemas.js').manualForm>} form
 * @param {Date} now
 */
export async function createManual(pool, { notifications }, form, now) {
  const [services, settings] = await Promise.all([
    bookingRepo.findServicesForBooking(pool),
    bookingRepo.findBookingSettings(pool),
  ]);
  const service = services.find((s) => s.slug === form.service);
  if (!service) throw new AgendaError('service');
  const options = form.options.map((/** @type {number} */ id) =>
    service.options.find((o) => o.id === id),
  );
  if (options.some((o) => !o)) throw new AgendaError('options');
  const chosen = /** @type {bookingRepo.BookableOption[]} */ (options);
  const booking = computeBooking(service, chosen);

  const startsAt = zonedToUtc(form.date, form.time, settings.timeZone);
  const endsAt = new Date(startsAt.getTime() + booking.occupationMinutes * MINUTE);
  const status = form.completed && startsAt <= now ? 'completed' : 'confirmed';

  const phone = form.phone ? normalizePhone(form.phone) : null;
  const email = form.email ?? placeholderEmailFor(phone ?? '', form.lastName);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Prestation sans praticienne associée (consultation, départ de locks…) : le salon la réalise
    // lui-même, on prend les praticiennes actives. La réservation en ligne, elle, les exclut.
    const linked = await bookingRepo.findStaffForService(client, service.id);
    const staffIds = linked.length ? linked : (await repo.findActiveStaff(client)).map((s) => s.id);
    const staffId = form.staffId && staffIds.includes(form.staffId) ? form.staffId : staffIds[0];
    if (!staffId) throw new AgendaError('no_staff');
    if (await repo.blockOverlaps(client, staffId, startsAt, endsAt))
      throw new AgendaError('blocked');

    const clientId = await bookingRepo.upsertClient(client, {
      firstName: form.firstName,
      lastName: form.lastName,
      email,
      phone: /** @type {string} */ (phone),
      smsReminders: phone !== null,
      newsletter: false,
    });
    const { token, hash } = generateToken();
    /** @type {string} */
    let id;
    try {
      await client.query('SAVEPOINT manual');
      id = await bookingRepo.insertAppointment(client, {
        clientId,
        staffId,
        serviceId: service.id,
        status: /** @type {any} */ (status),
        startsAt,
        endsAt,
        durationMinutes: booking.durationMax,
        bufferMinutes: booking.bufferMinutes,
        price: booking.price,
        priceFrom: booking.priceFrom,
        hairState: '',
        notes: form.notes ?? '',
        photoPath: null,
        tokenHash: hash,
        tokenExpiresAt: new Date(endsAt.getTime() + MANAGE_LINK_DAYS_AFTER * DAY),
        options: chosen,
      });
    } catch (error) {
      if (isOverlap(error)) throw new AgendaError('slot_taken');
      throw error;
    }
    await repo.markAdminSource(client, id);
    if (form.internalNotes) await repo.updateInternalNotes(client, id, form.internalNotes);
    await client.query('COMMIT');

    if (form.notify && status === 'confirmed' && startsAt > now) {
      await notifications.appointmentBooked({ appointmentId: id, token });
    }
    return { id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Déplace un rendez-vous (glisser-déposer ou choix d'un créneau). Même durée, même praticienne.
 * Le lien « Gérer mon RDV » est renouvelé (le nouvel email contient un lien valable).
 * @param {import('pg').Pool} pool
 * @param {{ notifications: any }} deps
 * @param {{ id: string, startsAt: Date, notify: boolean, now: Date }} q
 */
export async function moveAppointment(pool, { notifications }, { id, startsAt, notify, now }) {
  const client = await pool.connect();
  /** @type {string} */
  let token;
  try {
    await client.query('BEGIN');
    const appointment = await repo.findAppointment(client, id, { forUpdate: true });
    if (!appointment) throw new AgendaError('not_found');
    if (!['pending', 'confirmed'].includes(appointment.status)) throw new AgendaError('inactive');
    if (startsAt.getTime() < now.getTime() - 5 * MINUTE) throw new AgendaError('past');
    if (startsAt.getTime() === appointment.startsAt.getTime()) throw new AgendaError('unchanged');
    const occupation = appointment.endsAt.getTime() - appointment.startsAt.getTime();
    const endsAt = new Date(startsAt.getTime() + occupation);
    if (await repo.blockOverlaps(client, appointment.staffId, startsAt, endsAt)) {
      throw new AgendaError('blocked');
    }
    const generated = generateToken();
    token = generated.token;
    try {
      await client.query('SAVEPOINT move');
      await repo.moveAppointment(client, {
        id,
        staffId: appointment.staffId,
        startsAt,
        endsAt,
        tokenHash: generated.hash,
        tokenExpiresAt: new Date(endsAt.getTime() + MANAGE_LINK_DAYS_AFTER * DAY),
      });
    } catch (error) {
      if (isOverlap(error)) throw new AgendaError('slot_taken');
      throw error;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  if (notify) await notifications.appointmentRescheduled({ appointmentId: id, token });
  return { id };
}

/**
 * Créneaux libres pour déplacer un RDV un jour donné (le RDV lui-même ne bloque pas).
 * Pas de délai minimum côté salon.
 * @param {import('pg').Pool} db
 * @param {{ id: string, date: string, now: Date }} q
 */
export async function moveSlots(db, { id, date, now }) {
  const appointment = await repo.findAppointment(db, id);
  if (!appointment) throw new AgendaError('not_found');
  const settings = await bookingRepo.findBookingSettings(db);
  const staffIds = await bookingRepo.findStaffForService(db, appointment.serviceId);
  const input = await availabilityInput(db, {
    staffIds: staffIds.length ? staffIds : [appointment.staffId],
    from: date,
    to: date,
    occupationMinutes: (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / MINUTE,
    // Le salon déplace sans délai minimum et au-delà de l'horizon proposé en ligne.
    settings: { ...settings, minNoticeHours: 0, horizonDays: 730 },
    now,
    excludeAppointmentId: id,
  });
  const days = computeAvailability(input);
  return (days[0]?.slots ?? []).map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt }));
}

/**
 * Change le statut d'un rendez-vous et déclenche les notifications associées.
 * @param {import('pg').Pool} pool
 * @param {{ notifications: any }} deps
 * @param {{ id: string, status: string, reason?: string, notify: boolean, now: Date }} q
 */
export async function changeStatus(pool, { notifications }, { id, status, reason, notify, now }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const appointment = await repo.findAppointment(client, id, { forUpdate: true });
    if (!appointment) throw new AgendaError('not_found');
    if (!TRANSITIONS[appointment.status]?.includes(status)) throw new AgendaError('transition');
    if ((status === 'completed' || status === 'no_show') && appointment.startsAt > now) {
      throw new AgendaError('too_early');
    }
    try {
      await client.query('SAVEPOINT status');
      await repo.updateStatus(client, { id, status, reason });
    } catch (error) {
      if (isOverlap(error)) throw new AgendaError('slot_taken');
      throw error;
    }
    await client.query('COMMIT');
    if (status === 'completed') {
      await notifications.appointmentCompleted({ appointmentId: id, completedAt: now });
    } else if (status === 'cancelled_by_salon' && notify) {
      await notifications.appointmentCancelled({ appointmentId: id, by: 'salon' });
    }
    return { id, previous: appointment.status };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Bloque un créneau (pause, rendez-vous personnel). Refusé s'il couvre un rendez-vous.
 * @param {import('pg').Pool} db
 * @param {{ date: string, startTime: string, endTime: string, reason?: string, staffId?: number, userId: string, timeZone: string }} b
 */
export async function addBlock(db, b) {
  const staff = await repo.findActiveStaff(db);
  const staffId = b.staffId && staff.some((s) => s.id === b.staffId) ? b.staffId : staff[0]?.id;
  if (!staffId) throw new AgendaError('no_staff');
  const startsAt = zonedToUtc(b.date, b.startTime, b.timeZone);
  const endsAt = zonedToUtc(b.date, b.endTime, b.timeZone);
  if (await repo.appointmentOverlaps(db, staffId, startsAt, endsAt)) {
    throw new AgendaError('has_appointment');
  }
  const id = await repo.insertBlock(db, {
    staffId,
    startsAt,
    endsAt,
    reason: b.reason ?? null,
    userId: b.userId,
  });
  return { id };
}

/** Message d'erreur affiché (vouvoiement) pour chaque code. */
export const AGENDA_MESSAGES = /** @type {Record<string, string>} */ ({
  not_found: 'Ce rendez-vous n’existe plus.',
  service: 'Cette prestation n’existe plus.',
  options: 'Une option choisie n’existe plus pour cette prestation.',
  no_staff: 'Aucune praticienne n’est disponible pour cette prestation.',
  slot_taken: 'Ce créneau est déjà occupé par un autre rendez-vous.',
  blocked: 'Ce créneau est bloqué dans votre agenda. Retirez d’abord le blocage.',
  inactive: 'Ce rendez-vous ne peut plus être déplacé (annulé ou terminé).',
  past: 'Impossible de déplacer un rendez-vous dans le passé.',
  too_early: 'Ce rendez-vous n’a pas encore eu lieu.',
  transition: 'Ce changement de statut n’est pas possible.',
  has_appointment: 'Un rendez-vous existe déjà sur ce créneau : déplacez-le ou annulez-le d’abord.',
  unchanged: 'Le rendez-vous est déjà à cette heure.',
});

/** Statut HTTP de chaque erreur métier. */
export const AGENDA_STATUS = /** @type {Record<string, number>} */ ({
  not_found: 404,
  service: 422,
  options: 422,
  no_staff: 422,
  slot_taken: 409,
  blocked: 409,
  inactive: 409,
  past: 422,
  too_early: 422,
  transition: 409,
  has_appointment: 409,
  unchanged: 422,
});
