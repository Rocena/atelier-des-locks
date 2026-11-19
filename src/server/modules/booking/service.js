// @ts-check
/**
 * Cas d'usage de la réservation : créneaux, création d'un RDV, gestion par jeton, calendriers.
 * Orchestration uniquement : les règles sont dans availability.js et policy.js (pures),
 * le SQL dans repo.js. L'horloge (`now`) est toujours passée en paramètre (testable).
 */
import { computeAvailability, findSlot } from './availability.js';
import { computeBooking, selfService } from './policy.js';
import { generateToken, hashToken } from './tokens.js';
import { buildCalendar, googleCalendarUrl } from './ics.js';
import { addDays, daysBetween, utcToZoned, zonedToUtc } from '../../lib/zoned-time.js';
import * as repo from './repo.js';

const DAY = 86_400_000;
/** Le lien « Gérer mon RDV » reste valable 30 jours après la fin du RDV. */
export const MANAGE_LINK_DAYS_AFTER = 30;
/** Période maximale demandée en une fois par le calendrier public. */
export const MAX_SLOTS_RANGE_DAYS = 42;

export class BookingError extends Error {
  /**
   * @param {'not_found'|'not_bookable'|'invalid_options'|'slot_taken'|'bad_range'|'too_late'|'inactive'|'past'} code
   */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Conseils de préparation affichés à la confirmation (§7.2). TODO-PROPRIO : à relire. */
export const PREPARATION_TIPS = [
  'Venez cheveux propres, secs et démêlés, sans produit gras ni huile.',
  'Prévoyez de quoi vous occuper : les prestations de création durent plusieurs heures.',
  'Si vous avez une photo de la coiffure souhaitée, gardez-la sur votre téléphone.',
  'Un empêchement ? Déplacez ou annulez votre rendez-vous depuis le lien reçu par email.',
];

/** @typedef {import('pg').Pool} Pool */

/**
 * Prestation réservable en ligne et options choisies, ou erreur.
 * @param {repo.BookableService[]} services
 * @param {string} slug
 * @param {number[]} optionIds
 */
export function resolveService(services, slug, optionIds) {
  const service = services.find((s) => s.slug === slug);
  if (!service) throw new BookingError('not_found');
  if (!service.bookableOnline || service.onQuote) throw new BookingError('not_bookable');
  const options = optionIds.map((id) => service.options.find((o) => o.id === id));
  if (options.some((o) => !o)) throw new BookingError('invalid_options');
  const chosen = /** @type {repo.BookableOption[]} */ (options);
  return { service, options: chosen, booking: computeBooking(service, chosen) };
}

/**
 * Entrée du moteur à partir de la base, sur des dates locales.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ staffIds: number[], from: string, to: string, occupationMinutes: number, settings: repo.BookingSettings, now: Date, excludeAppointmentId?: string }} q
 * @returns {Promise<import('./availability.js').AvailabilityInput>}
 */
export async function availabilityInput(db, q) {
  const tz = q.settings.timeZone;
  const planning = await repo.findPlanning(db, {
    staffIds: q.staffIds,
    fromDate: q.from,
    toDate: q.to,
    fromInstant: new Date(zonedToUtc(q.from, '00:00', tz).getTime() - DAY),
    toInstant: new Date(zonedToUtc(addDays(q.to, 1), '00:00', tz).getTime() + DAY),
    excludeAppointmentId: q.excludeAppointmentId,
  });
  return {
    timeZone: tz,
    from: q.from,
    to: q.to,
    now: q.now,
    occupationMinutes: q.occupationMinutes,
    stepMinutes: q.settings.stepMinutes,
    minNoticeHours: q.settings.minNoticeHours,
    horizonDays: q.settings.horizonDays,
    longServiceMinutes: q.settings.longServiceMinutes,
    staffIds: q.staffIds,
    ...planning,
  };
}

/** @param {string} from @param {string} to */
function checkRange(from, to) {
  const span = daysBetween(from, to);
  if (span < 0 || span >= MAX_SLOTS_RANGE_DAYS) throw new BookingError('bad_range');
}

/**
 * Catalogue du tunnel : prestations groupées, avec durée et prix estimés.
 * @param {Pool} db
 */
export async function bookingCatalog(db) {
  const [services, settings, staffCount] = await Promise.all([
    repo.findServicesForBooking(db),
    repo.findBookingSettings(db),
    repo.countActiveStaff(db),
  ]);
  return { services, settings, staffCount };
}

/**
 * Créneaux disponibles d'une prestation (avec options) sur une période.
 * @param {Pool} db
 * @param {{ slug: string, optionIds: number[], from: string, to: string, now: Date }} q
 */
export async function getSlots(db, q) {
  checkRange(q.from, q.to);
  const [services, settings] = await Promise.all([
    repo.findServicesForBooking(db),
    repo.findBookingSettings(db),
  ]);
  const { service, booking } = resolveService(services, q.slug, q.optionIds);
  const staffIds = await repo.findStaffForService(db, service.id);
  const input = await availabilityInput(db, {
    staffIds,
    from: q.from,
    to: q.to,
    occupationMinutes: booking.occupationMinutes,
    settings,
    now: q.now,
  });
  const today = utcToZoned(q.now, settings.timeZone).date;
  return {
    booking,
    firstDate: today,
    lastDate: addDays(today, settings.horizonDays),
    days: computeAvailability(input).map((d) => ({
      date: d.date,
      // Les identifiants des praticiennes ne sortent pas : seule l'heure intéresse la cliente.
      slots: d.slots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt })),
    })),
  };
}

/** @param {unknown} error */
export const isOverlap = (error) =>
  typeof error === 'object' && error !== null && /** @type {any} */ (error).code === '23P01';

/**
 * Crée un rendez-vous. Double protection contre la double réservation (§7.3) :
 * revalidation du créneau dans une transaction, puis contrainte d'exclusion PostgreSQL
 * (si deux personnes valident en même temps, la seconde insertion échoue en 23P01).
 * @param {Pool} pool
 * @param {object} input
 * @param {import('zod').infer<typeof import('./schemas.js').bookingForm>} input.form
 * @param {string|null} input.photoPath  photo déjà nettoyée et stockée (ou null)
 * @param {Date} input.now
 */
export async function createAppointment(pool, { form, photoPath, now }) {
  const [services, settings] = await Promise.all([
    repo.findServicesForBooking(pool),
    repo.findBookingSettings(pool),
  ]);
  const { service, options, booking } = resolveService(services, form.service, form.options);
  const { date } = utcToZoned(form.startsAt, settings.timeZone);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const staffIds = await repo.findStaffForService(client, service.id);
    const input = await availabilityInput(client, {
      staffIds,
      from: date,
      to: date,
      occupationMinutes: booking.occupationMinutes,
      settings,
      now,
    });
    const slot = findSlot(input, form.startsAt);
    if (!slot) throw new BookingError('slot_taken');

    const clientId = await repo.upsertClient(client, form);
    const { token, hash } = generateToken();
    const endsAt = new Date(slot.endsAt);
    /** @type {string|null} */
    let id = null;
    for (const staffId of slot.staffIds) {
      await client.query('SAVEPOINT try_staff');
      try {
        id = await repo.insertAppointment(client, {
          clientId,
          staffId,
          serviceId: service.id,
          status: settings.manualValidation ? 'pending' : 'confirmed',
          startsAt: form.startsAt,
          endsAt,
          durationMinutes: booking.durationMax,
          bufferMinutes: booking.bufferMinutes,
          price: booking.price,
          priceFrom: booking.priceFrom,
          hairState: form.hairState,
          notes: form.notes,
          photoPath,
          tokenHash: hash,
          tokenExpiresAt: new Date(endsAt.getTime() + MANAGE_LINK_DAYS_AFTER * DAY),
          options,
        });
        await client.query('RELEASE SAVEPOINT try_staff');
        break;
      } catch (error) {
        if (!isOverlap(error)) throw error;
        await client.query('ROLLBACK TO SAVEPOINT try_staff');
      }
    }
    if (!id) throw new BookingError('slot_taken');
    await client.query('COMMIT');
    const appointment = /** @type {repo.ManagedAppointment} */ (
      await repo.findAppointmentById(pool, id)
    );
    return { token, appointment, booking, settings };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Vue « Gérer mon RDV ».
 * @param {Pool} db
 * @param {string} token
 * @param {Date} now
 */
export async function getManaged(db, token, now) {
  const [appointment, settings] = await Promise.all([
    repo.findAppointmentByToken(db, hashToken(token)),
    repo.findBookingSettings(db),
  ]);
  if (!appointment) throw new BookingError('not_found');
  const policy = selfService({
    status: appointment.status,
    startsAt: appointment.startsAt,
    now,
    cancellationHours: settings.cancellationHours,
  });
  return { appointment, settings, policy };
}

/**
 * Créneaux proposés pour déplacer un RDV : même durée, le RDV lui-même ne bloque pas.
 * @param {Pool} db
 * @param {{ token: string, from: string, to: string, now: Date }} q
 */
export async function getRescheduleSlots(db, q) {
  checkRange(q.from, q.to);
  const { appointment, settings, policy } = await getManaged(db, q.token, q.now);
  if (!policy.allowed) throw new BookingError(/** @type {any} */ (policy.reason));
  const staffIds = await repo.findStaffForService(db, appointment.serviceId);
  const input = await availabilityInput(db, {
    staffIds,
    from: q.from,
    to: q.to,
    occupationMinutes: appointment.durationMinutes + appointment.bufferMinutes,
    settings,
    now: q.now,
    excludeAppointmentId: appointment.id,
  });
  return computeAvailability(input).map((d) => ({
    date: d.date,
    slots: d.slots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt })),
  }));
}

/**
 * Applique une action de la cliente dans une transaction, ligne verrouillée.
 * @template T
 * @param {Pool} pool
 * @param {string} token
 * @param {Date} now
 * @param {(client: import('pg').PoolClient, appointment: repo.ManagedAppointment, settings: repo.BookingSettings) => Promise<T>} action
 */
async function withManagedAppointment(pool, token, now, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const appointment = await repo.findAppointmentByToken(client, hashToken(token), {
      forUpdate: true,
    });
    if (!appointment) throw new BookingError('not_found');
    const settings = await repo.findBookingSettings(client);
    const policy = selfService({
      status: appointment.status,
      startsAt: appointment.startsAt,
      now,
      cancellationHours: settings.cancellationHours,
    });
    if (!policy.allowed) throw new BookingError(/** @type {any} */ (policy.reason));
    const result = await action(client, appointment, settings);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Déplace un RDV vers un nouveau créneau (revalidé, même durée).
 * @param {Pool} pool
 * @param {{ token: string, startsAt: Date, now: Date }} q
 */
export async function reschedule(pool, { token, startsAt, now }) {
  return withManagedAppointment(pool, token, now, async (client, appointment, settings) => {
    const { date } = utcToZoned(startsAt, settings.timeZone);
    const staffIds = await repo.findStaffForService(client, appointment.serviceId);
    const input = await availabilityInput(client, {
      staffIds,
      from: date,
      to: date,
      occupationMinutes: appointment.durationMinutes + appointment.bufferMinutes,
      settings,
      now,
      excludeAppointmentId: appointment.id,
    });
    const slot = findSlot(input, startsAt);
    if (!slot) throw new BookingError('slot_taken');
    // Garder la même praticienne si elle est libre.
    const ordered = [
      ...slot.staffIds.filter((id) => id === appointment.staffId),
      ...slot.staffIds.filter((id) => id !== appointment.staffId),
    ];
    const endsAt = new Date(slot.endsAt);
    for (const staffId of ordered) {
      await client.query('SAVEPOINT try_staff');
      try {
        await repo.moveAppointment(client, {
          id: appointment.id,
          staffId,
          startsAt,
          endsAt,
          tokenExpiresAt: new Date(endsAt.getTime() + MANAGE_LINK_DAYS_AFTER * DAY),
        });
        await client.query('RELEASE SAVEPOINT try_staff');
        return { id: appointment.id };
      } catch (error) {
        if (!isOverlap(error)) throw error;
        await client.query('ROLLBACK TO SAVEPOINT try_staff');
      }
    }
    throw new BookingError('slot_taken');
  });
}

/**
 * Annulation par la cliente (dans le délai de la politique).
 * @param {Pool} pool
 * @param {{ token: string, reason: string, now: Date }} q
 */
export async function cancel(pool, { token, reason, now }) {
  return withManagedAppointment(pool, token, now, async (client, appointment) => {
    await repo.cancelAppointment(client, { id: appointment.id, reason });
    return { id: appointment.id };
  });
}

/**
 * Lieu affiché dans les agendas.
 * @param {{ name: string, address: { street: string, postalCode: string, city: string } }} site
 */
const locationOf = (site) =>
  `${site.name}, ${site.address.street}, ${site.address.postalCode} ${site.address.city}`;

/**
 * Fichier .ics d'un rendez-vous (la fin affichée exclut le tampon de rangement).
 * @param {repo.ManagedAppointment} appointment
 * @param {{ manageUrl: string, site: any, now: Date }} ctx
 */
export function appointmentCalendar(appointment, { manageUrl, site, now }) {
  const cancelled = appointment.status.startsWith('cancelled');
  return buildCalendar({
    name: site.name,
    now,
    events: [
      {
        uid: `${appointment.id}@atelier-des-locks`,
        startsAt: appointment.startsAt,
        endsAt: new Date(appointment.startsAt.getTime() + appointment.durationMinutes * 60_000),
        summary: `${appointment.serviceName}, ${site.name}`,
        description: [...PREPARATION_TIPS.slice(0, 2), `Gérer mon rendez-vous : ${manageUrl}`].join(
          '\n',
        ),
        location: locationOf(site),
        url: manageUrl,
        status: cancelled
          ? 'CANCELLED'
          : appointment.status === 'pending'
            ? 'TENTATIVE'
            : 'CONFIRMED',
        updatedAt: appointment.updatedAt,
      },
    ],
  });
}

/**
 * Lien Google Agenda d'un rendez-vous (sans le jeton, qui partirait chez Google).
 * @param {repo.ManagedAppointment} appointment
 * @param {{ site: any, publicUrl: string }} ctx
 */
export function appointmentGoogleUrl(appointment, { site, publicUrl }) {
  return googleCalendarUrl({
    title: `${appointment.serviceName}, ${site.name}`,
    startsAt: appointment.startsAt,
    endsAt: new Date(appointment.startsAt.getTime() + appointment.durationMinutes * 60_000),
    details: `${PREPARATION_TIPS[0]}\n${publicUrl}`,
    location: locationOf(site),
  });
}

/**
 * Flux iCal privé de la propriétaire : prénom + initiale, prestation, options. Pas de
 * téléphone ni d'email (le flux transite par les serveurs de l'agenda qui l'importe).
 * @param {Pool} db
 * @param {{ site: any, publicUrl: string, now: Date }} ctx
 */
export async function ownerFeed(db, { site, now }) {
  const appointments = await repo.findFeedAppointments(db, new Date(now.getTime() - 30 * DAY));
  return buildCalendar({
    name: `${site.name} · rendez-vous`,
    now,
    events: appointments.map((a) => ({
      uid: `${a.id}@atelier-des-locks`,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      summary: `${a.clientLabel} · ${a.serviceName}${a.status === 'pending' ? ' (à valider)' : ''}`,
      description: [
        a.options.length ? `Options : ${a.options.join(', ')}` : '',
        `Praticienne : ${a.staffName}`,
        a.bufferMinutes ? `Dont ${a.bufferMinutes} min de tampon` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      status: a.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED',
      updatedAt: a.updatedAt,
    })),
  });
}
