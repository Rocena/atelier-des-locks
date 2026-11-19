// @ts-check
/**
 * Export CSV des clientes (§9, §14). Compatible Excel français : séparateur « ; », BOM UTF-8,
 * fins de ligne CRLF. Une cellule qui commence par = + - @ (ou une tabulation) serait
 * interprétée comme une formule par Excel : on la préfixe d'une apostrophe (injection CSV).
 */
import { displayEmail } from './placeholder.js';

const SEPARATOR = ';';
/** Marque d'ordre des octets UTF-8 : Excel reconnaît ainsi les accents. */
const BOM = String.fromCharCode(0xfeff);

/** @param {unknown} value */
export function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** @param {Date|null} date */
const day = (date) => (date ? date.toISOString().slice(0, 10) : '');

/**
 * @param {Array<{ firstName: string, lastName: string, email: string, phone: string|null, smsReminders: boolean, newsletter: boolean, newsletterAt: Date|null, createdAt: Date, visits: number, lastVisit: Date|null }>} clients
 */
export function clientsToCsv(clients) {
  const header = [
    'Prénom',
    'Nom',
    'Email',
    'Téléphone',
    'Rappels SMS',
    'Newsletter',
    'Date du consentement newsletter',
    'Nombre de rendez-vous',
    'Dernier rendez-vous',
    'Fiche créée le',
  ];
  const lines = clients.map((c) => [
    c.firstName,
    c.lastName,
    displayEmail(c.email) ?? '',
    c.phone ?? '',
    c.smsReminders ? 'oui' : 'non',
    c.newsletter ? 'oui' : 'non',
    day(c.newsletterAt),
    c.visits,
    day(c.lastVisit),
    day(c.createdAt),
  ]);
  const body = [header, ...lines].map((row) => row.map(csvCell).join(SEPARATOR)).join('\r\n');
  return `${BOM}${body}\r\n`;
}
