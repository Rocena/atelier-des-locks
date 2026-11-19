// @ts-check
/**
 * Conversions heure locale du salon ↔ instant UTC, sans dépendance (Intl).
 * Les horaires sont saisis en heure locale (« 09:00 » à Paris) ; les rendez-vous sont stockés en UTC.
 * Changements d'heure :
 *   - heure inexistante (passage à l'heure d'été, 2h30) : décalée vers l'avant (3h30) ;
 *   - heure ambiguë (passage à l'heure d'hiver, 2h30 deux fois) : première occurrence.
 * C'est le comportement « compatible » de Temporal et des agendas courants.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;
const MINUTE = 60_000;
const DAY = 86_400_000;

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();

/** @param {string} timeZone */
function formatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * Champs locaux d'un instant.
 * @param {number} epochMs
 * @param {string} timeZone
 */
function localParts(epochMs, timeZone) {
  /** @type {Record<string, number>} */
  const parts = {};
  for (const { type, value } of formatter(timeZone).formatToParts(new Date(epochMs))) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return parts;
}

/**
 * Décalage (en minutes) du fuseau par rapport à UTC à un instant donné (+60 l'hiver à Paris).
 * @param {number} epochMs
 * @param {string} timeZone
 */
function offsetMinutes(epochMs, timeZone) {
  const p = localParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / MINUTE);
}

/**
 * Décompose une date locale « AAAA-MM-JJ » (validée).
 * @param {string} date
 */
function parseDate(date) {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Date invalide : ${date}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Date invalide : ${date}`);
  }
  return { y, mo, d };
}

/**
 * Instant UTC correspondant à une date et une heure locales.
 * « 24:00 » désigne la fin de la journée (minuit du lendemain).
 * @param {string} date  « AAAA-MM-JJ »
 * @param {string} time  « HH:MM »
 * @param {string} timeZone
 * @returns {Date}
 */
export function zonedToUtc(date, time, timeZone) {
  const { y, mo, d } = parseDate(date);
  const t = TIME_RE.exec(time);
  if (!t || (t[1] === '24' && t[2] !== '00')) throw new RangeError(`Heure invalide : ${time}`);
  const wall = Date.UTC(y, mo - 1, d, Number(t[1]), Number(t[2]));
  // Les deux décalages possibles autour de cette heure (identiques hors changement d'heure).
  const before = offsetMinutes(wall - DAY, timeZone);
  const after = offsetMinutes(wall + DAY, timeZone);
  const candidates = [...new Set([before, after])]
    .map((offset) => wall - offset * MINUTE)
    .filter((instant) => {
      const p = localParts(instant, timeZone);
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall;
    })
    .sort((a, b) => a - b);
  if (candidates.length > 0) return new Date(candidates[0]);
  // Heure inexistante (trou du passage à l'heure d'été) : décalage d'avant le saut → instant plus tardif.
  return new Date(wall - Math.min(before, after) * MINUTE);
}

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');

/**
 * Date, heure et jour ISO (1 = lundi … 7 = dimanche) locaux d'un instant.
 * @param {Date} instant
 * @param {string} timeZone
 * @returns {{ date: string, time: string, weekday: number }}
 */
export function utcToZoned(instant, timeZone) {
  const p = localParts(instant.getTime(), timeZone);
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return { date, time: `${pad(p.hour)}:${pad(p.minute)}`, weekday: weekdayOf(date) };
}

/**
 * Ajoute n jours calendaires à une date locale.
 * @param {string} date
 * @param {number} days
 */
export function addDays(date, days) {
  const { y, mo, d } = parseDate(date);
  const next = new Date(Date.UTC(y, mo - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/**
 * Jour de la semaine ISO 8601 d'une date locale (1 = lundi … 7 = dimanche).
 * @param {string} date
 */
export function weekdayOf(date) {
  const { y, mo, d } = parseDate(date);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay() || 7;
}

/**
 * Nombre de jours entre deux dates locales (b - a).
 * @param {string} a
 * @param {string} b
 */
export function daysBetween(a, b) {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.mo - 1, pb.d) - Date.UTC(pa.y, pa.mo - 1, pa.d)) / DAY);
}

/** @param {string} value */
export const isLocalDate = (value) => {
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
};
