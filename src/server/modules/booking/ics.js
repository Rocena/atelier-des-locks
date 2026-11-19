// @ts-check
/**
 * Génération iCalendar (RFC 5545) : fichier .ics d'un RDV et flux privé de la propriétaire.
 * Fonctions pures. Heures en UTC (suffixe Z) : chaque agenda les affiche dans son fuseau.
 */

/**
 * @typedef {object} CalendarEvent
 * @property {string} uid
 * @property {Date} startsAt
 * @property {Date} endsAt
 * @property {string} summary
 * @property {string} [description]
 * @property {string} [location]
 * @property {string} [url]
 * @property {'CONFIRMED'|'TENTATIVE'|'CANCELLED'} [status]
 * @property {Date} [updatedAt]
 */

/** 20261201T080000Z @param {Date} date */
export function icsDate(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Échappement des valeurs texte (RFC 5545 §3.3.11). @param {string} value */
export function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Plie les lignes à 75 octets (RFC 5545 §3.1), sans couper un caractère UTF-8.
 * @param {string} line
 */
export function foldLine(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    const limit = parts.length === 0 ? 75 : 74; // les lignes de continuation commencent par une espace
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * @param {CalendarEvent} event
 * @param {Date} now  horodatage DTSTAMP
 */
function eventLines(event, now) {
  return [
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${icsDate(event.updatedAt ?? now)}`,
    `DTSTART:${icsDate(event.startsAt)}`,
    `DTEND:${icsDate(event.endsAt)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    `STATUS:${event.status ?? 'CONFIRMED'}`,
    'END:VEVENT',
  ];
}

/**
 * Calendrier complet (CRLF, lignes pliées).
 * @param {{ name: string, events: CalendarEvent[], now: Date, method?: 'PUBLISH' }} options
 */
export function buildCalendar({ name, events, now, method = 'PUBLISH' }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//L'Atelier des Locks//Reservation//FR",
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:Europe/Paris',
    ...events.flatMap((e) => eventLines(e, now)),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * Lien « Ajouter à Google Agenda ». N'y mettez jamais le lien à jeton : il partirait chez Google.
 * @param {{ title: string, startsAt: Date, endsAt: Date, details: string, location: string }} e
 */
export function googleCalendarUrl(e) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${icsDate(e.startsAt)}/${icsDate(e.endsAt)}`,
    details: e.details,
    location: e.location,
    ctz: 'Europe/Paris',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
