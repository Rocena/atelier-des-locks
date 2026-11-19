// @ts-check
/**
 * Mise en page de l'agenda (jour, semaine) : fonctions pures, heure de Paris.
 * Les minutes sont comptées depuis minuit de la date affichée (un RDV qui déborde sur la nuit
 * dépasse 1440 ; la frise le coupe à sa borne).
 */
import { addDays, daysBetween, utcToZoned, weekdayOf } from '../../lib/zoned-time.js';

/** Plage minimale affichée : 8 h – 19 h (élargie si l'activité déborde). */
const MIN_START = 8 * 60;
const MIN_END = 19 * 60;

/** @param {string} time « HH:MM » */
export const timeToMinutes = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** @param {number} minutes */
export const minutesToTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Minutes écoulées depuis minuit de `date` jusqu'à l'instant (heure locale).
 * @param {Date} instant
 * @param {string} date  « AAAA-MM-JJ »
 * @param {string} timeZone
 */
export function minutesSinceMidnight(instant, date, timeZone) {
  const z = utcToZoned(instant, timeZone);
  return daysBetween(date, z.date) * 1440 + timeToMinutes(z.time);
}

/** Les 7 dates (lundi → dimanche) de la semaine qui contient `date`. @param {string} date */
export function weekDates(date) {
  const monday = addDays(date, 1 - weekdayOf(date));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * Plages d'ouverture d'un jour, en minutes : horaires hebdomadaires, remplacés par une
 * fermeture (aucune plage) ou des horaires spéciaux pour les dates concernées.
 * @param {string} date
 * @param {{ weekday: number, opens: string, closes: string }[]} weeklyHours  d'une praticienne ou de toutes
 * @param {{ kind: string, startsOn: string, endsOn: string, opens?: string, closes?: string }[]} closures
 * @returns {{ from: number, to: number }[]}
 */
export function openRanges(date, weeklyHours, closures) {
  const concerned = closures.filter((c) => c.startsOn <= date && date <= c.endsOn);
  if (concerned.some((c) => c.kind === 'closed')) return [];
  const special = concerned.filter((c) => c.kind === 'special_hours' && c.opens && c.closes);
  if (special.length > 0) {
    return special.map((c) => ({
      from: timeToMinutes(/** @type {string} */ (c.opens)),
      to: timeToMinutes(/** @type {string} */ (c.closes)),
    }));
  }
  const weekday = weekdayOf(date);
  return weeklyHours
    .filter((h) => h.weekday === weekday)
    .map((h) => ({ from: timeToMinutes(h.opens), to: timeToMinutes(h.closes) }))
    .sort((a, b) => a.from - b.from);
}

/**
 * Zones fermées (hachurées) de la frise : ce qui n'est pas dans une plage d'ouverture.
 * @param {{ from: number, to: number }[]} open
 * @param {number} dayStart
 * @param {number} dayEnd
 */
export function closedRanges(open, dayStart, dayEnd) {
  /** @type {{ from: number, to: number }[]} */
  const out = [];
  let cursor = dayStart;
  for (const range of open) {
    if (range.from > cursor) out.push({ from: cursor, to: Math.min(range.from, dayEnd) });
    cursor = Math.max(cursor, range.to);
  }
  if (cursor < dayEnd) out.push({ from: cursor, to: dayEnd });
  return out.filter((r) => r.to > r.from);
}

/**
 * Bornes de la frise : plage minimale élargie à l'activité et aux horaires d'ouverture.
 * @param {{ startMin: number, endMin: number }[]} items
 * @param {{ from: number, to: number }[][]} openByDay
 */
export function timelineBounds(items, openByDay) {
  let start = MIN_START;
  let end = MIN_END;
  for (const item of items) {
    start = Math.min(start, item.startMin);
    end = Math.max(end, item.endMin);
  }
  for (const ranges of openByDay) {
    for (const r of ranges) {
      start = Math.min(start, r.from);
      end = Math.max(end, r.to);
    }
  }
  return {
    dayStart: Math.max(0, Math.floor(start / 60) * 60),
    dayEnd: Math.min(1440, Math.ceil(end / 60) * 60),
  };
}

/**
 * Positionne un rendez-vous ou un blocage sur la journée `date`.
 * @param {{ startsAt: Date, endsAt: Date, bufferMinutes?: number }} item
 * @param {string} date
 * @param {string} timeZone
 */
export function place(item, date, timeZone) {
  const buffer = item.bufferMinutes ?? 0;
  const startMin = minutesSinceMidnight(item.startsAt, date, timeZone);
  const endMin = minutesSinceMidnight(item.endsAt, date, timeZone);
  return { startMin, endMin, spanMin: Math.max(15, endMin - startMin - buffer), bufferMin: buffer };
}

/** Jour local (« AAAA-MM-JJ ») d'un instant. @param {Date} instant @param {string} timeZone */
export const localDate = (instant, timeZone) => utcToZoned(instant, timeZone).date;

/** Libellés de graduation (une par heure). @param {number} dayStart @param {number} dayEnd */
export function hourMarks(dayStart, dayEnd) {
  const marks = [];
  for (let m = dayStart; m <= dayEnd; m += 60) marks.push({ minutes: m, label: `${m / 60} h` });
  return marks;
}
