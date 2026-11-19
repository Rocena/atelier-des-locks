// @ts-check
/**
 * Moteur de disponibilités (§7.3). Fonctions PURES : aucune base, aucune horloge implicite.
 * Toutes les données (horaires, exceptions, RDV, blocages, maintenant) sont passées en entrée.
 *
 * Règles :
 *   - les horaires sont en heure locale (Europe/Paris), les créneaux sortent en UTC ;
 *   - un jour peut avoir plusieurs plages (9h-12h, 14h-18h) ;
 *   - exceptions : une fermeture l'emporte sur tout ; des horaires spéciaux remplacent les plages
 *     habituelles du jour (et peuvent ouvrir un jour normalement fermé) ;
 *   - la durée bloquée (« occupation ») = durée max + options + tampon, calculée par policy.js ;
 *   - un RDV court tient dans une seule plage. Un RDV long (≥ longServiceMinutes, 4 h par défaut)
 *     peut traverser la pause : il commence dans une plage et finit avant la dernière fermeture ;
 *   - aucun chevauchement avec un RDV ou un blocage (intervalles [début, fin[ : contigus acceptés) ;
 *   - délai minimum (en heures, depuis maintenant) et horizon (en jours, date locale incluse) ;
 *   - durées réelles : un RDV de 3 h dure 3 h, même la nuit du changement d'heure.
 */
import { addDays, daysBetween, isLocalDate, utcToZoned, zonedToUtc } from '../../lib/zoned-time.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;
/** Période maximale calculable d'un coup (protège le serveur contre des requêtes énormes). */
export const MAX_RANGE_DAYS = 92;

/**
 * @typedef {object} WeeklyHours
 * @property {number} staffId
 * @property {number} weekday  1 = lundi … 7 = dimanche
 * @property {string} opens    « HH:MM » local
 * @property {string} closes
 *
 * @typedef {object} Closure
 * @property {number|null} staffId  null = tout le salon
 * @property {'closed'|'special_hours'} kind
 * @property {string} startsOn  « AAAA-MM-JJ » (inclus)
 * @property {string} endsOn    (inclus)
 * @property {string} [opens]   horaires spéciaux uniquement
 * @property {string} [closes]
 *
 * @typedef {object} BusyInterval  RDV qui occupe le planning ou blocage manuel
 * @property {number} staffId
 * @property {Date} startsAt
 * @property {Date} endsAt
 *
 * @typedef {object} AvailabilityInput
 * @property {string} timeZone
 * @property {string} from  première date locale (incluse)
 * @property {string} to    dernière date locale (incluse)
 * @property {Date} now
 * @property {number} occupationMinutes  durée bloquée au planning (tampon compris)
 * @property {number} stepMinutes        pas entre deux débuts de créneau
 * @property {number} minNoticeHours
 * @property {number} horizonDays
 * @property {number} longServiceMinutes  seuil à partir duquel un RDV peut traverser une pause
 * @property {number[]} staffIds          praticiennes qui réalisent la prestation
 * @property {WeeklyHours[]} weeklyHours
 * @property {Closure[]} closures
 * @property {BusyInterval[]} busy
 *
 * @typedef {{ startsAt: string, endsAt: string, staffIds: number[] }} Slot
 * @typedef {{ date: string, slots: Slot[] }} DayAvailability
 */

/** @param {unknown} value @param {number} min */
const isInt = (value, min) => Number.isInteger(value) && /** @type {number} */ (value) >= min;

/** @param {AvailabilityInput} input */
function validate(input) {
  const problems = [];
  if (!isLocalDate(input.from) || !isLocalDate(input.to)) problems.push('dates');
  else if (daysBetween(input.from, input.to) < 0) problems.push('from > to');
  else if (daysBetween(input.from, input.to) >= MAX_RANGE_DAYS)
    problems.push('période trop longue');
  if (!isInt(input.occupationMinutes, 1)) problems.push('occupationMinutes');
  if (!isInt(input.stepMinutes, 5)) problems.push('stepMinutes');
  if (!isInt(input.longServiceMinutes, 1)) problems.push('longServiceMinutes');
  if (!(input.minNoticeHours >= 0)) problems.push('minNoticeHours');
  if (!isInt(input.horizonDays, 0)) problems.push('horizonDays');
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) problems.push('now');
  if (problems.length)
    throw new RangeError(`Entrée de disponibilité invalide : ${problems.join(', ')}`);
}

/**
 * Plages d'ouverture (en ms UTC) d'une praticienne pour une date locale.
 * @param {AvailabilityInput} input
 * @param {number} staffId
 * @param {string} date
 * @param {number} weekday
 * @returns {{ start: number, end: number }[]}
 */
function openingRanges(input, staffId, date, weekday) {
  const applicable = input.closures.filter(
    (c) => (c.staffId === null || c.staffId === staffId) && c.startsOn <= date && date <= c.endsOn,
  );
  if (applicable.some((c) => c.kind === 'closed')) return [];
  const special = applicable.filter((c) => c.kind === 'special_hours' && c.opens && c.closes);
  const local = special.length
    ? special.map((c) => ({
        opens: /** @type {string} */ (c.opens),
        closes: /** @type {string} */ (c.closes),
      }))
    : input.weeklyHours.filter((h) => h.staffId === staffId && h.weekday === weekday);
  return local
    .map((h) => ({
      start: zonedToUtc(date, h.opens, input.timeZone).getTime(),
      end: zonedToUtc(date, h.closes, input.timeZone).getTime(),
    }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Créneaux disponibles, jour par jour, de `from` à `to` (dates locales incluses).
 * @param {AvailabilityInput} input
 * @returns {DayAvailability[]}
 */
export function computeAvailability(input) {
  validate(input);
  const nowMs = input.now.getTime();
  const earliest = nowMs + input.minNoticeHours * HOUR;
  const lastDate = addDays(utcToZoned(input.now, input.timeZone).date, input.horizonDays);
  const occupation = input.occupationMinutes * MINUTE;
  const step = input.stepMinutes * MINUTE;
  const isLong = input.occupationMinutes >= input.longServiceMinutes;
  const staffIds = [...new Set(input.staffIds)].sort((a, b) => a - b);

  /** @type {Map<number, { start: number, end: number }[]>} */
  const busyByStaff = new Map();
  for (const b of input.busy) {
    const list = busyByStaff.get(b.staffId) ?? [];
    list.push({ start: b.startsAt.getTime(), end: b.endsAt.getTime() });
    busyByStaff.set(b.staffId, list);
  }

  /** @type {DayAvailability[]} */
  const days = [];
  const count = daysBetween(input.from, input.to);
  for (let i = 0; i <= count; i++) {
    const date = addDays(input.from, i);
    /** @type {Map<number, number[]>} début (ms) → praticiennes libres */
    const byStart = new Map();

    if (date <= lastDate) {
      const weekday = utcToZoned(zonedToUtc(date, '12:00', input.timeZone), input.timeZone).weekday;
      for (const staffId of staffIds) {
        const ranges = openingRanges(input, staffId, date, weekday);
        if (ranges.length === 0) continue;
        const dayEnd = Math.max(...ranges.map((r) => r.end));
        const busy = busyByStaff.get(staffId) ?? [];
        for (const range of ranges) {
          for (let start = range.start; start < range.end; start += step) {
            const end = start + occupation;
            if (end > (isLong ? dayEnd : range.end)) break;
            if (start < earliest) continue;
            if (busy.some((b) => start < b.end && b.start < end)) continue;
            const free = byStart.get(start) ?? [];
            if (!free.includes(staffId)) free.push(staffId);
            byStart.set(start, free);
          }
        }
      }
    }

    days.push({
      date,
      slots: [...byStart.entries()]
        .sort(([a], [b]) => a - b)
        .map(([start, ids]) => ({
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(start + occupation).toISOString(),
          staffIds: ids.sort((a, b) => a - b),
        })),
    });
  }
  return days;
}

/**
 * Revalide un créneau précis au moment de réserver (le client peut avoir attendu, ou tricher).
 * @param {AvailabilityInput} input  from/to sont ignorés : on calcule la journée locale de startsAt
 * @param {Date} startsAt
 * @returns {Slot|null}
 */
export function findSlot(input, startsAt) {
  const { date } = utcToZoned(startsAt, input.timeZone);
  const [day] = computeAvailability({ ...input, from: date, to: date });
  return day.slots.find((s) => s.startsAt === startsAt.toISOString()) ?? null;
}
