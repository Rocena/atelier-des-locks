// @ts-check
/**
 * Affichage de l'administration : libellés, dates en heure de Paris, montants.
 * Fonctions pures, partagées par les templates (`it.a`).
 */
import { formatEuro } from '../../lib/format.js';

const TZ = 'Europe/Paris';

/** Statuts de rendez-vous (anglais en base, français à l'écran). */
export const STATUS_LABELS = /** @type {Record<string, string>} */ ({
  pending: 'À valider',
  confirmed: 'Confirmé',
  completed: 'Terminé',
  cancelled_by_client: 'Annulé par la cliente',
  cancelled_by_salon: 'Annulé par le salon',
  no_show: 'Absence',
});

/** Teinte du point de statut (jamais la couleur seule : le libellé est toujours affiché). */
export const STATUS_TONE = /** @type {Record<string, string>} */ ({
  pending: 'warning',
  confirmed: 'success',
  completed: 'success',
  cancelled_by_client: 'error',
  cancelled_by_salon: 'error',
  no_show: 'error',
});

/** Statuts qui occupent encore le planning. */
export const ACTIVE_STATUSES = ['pending', 'confirmed', 'completed', 'no_show'];

const dayFmt = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: TZ,
});
const shortDayFmt = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TZ,
});
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TZ,
});
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: TZ });

/** « mardi 24 novembre » pour une date locale « 2026-11-24 ». @param {string} isoDate */
export const dayLabel = (isoDate) => dayFmt.format(new Date(`${isoDate}T12:00:00Z`));
/** « mar. 24 nov. » @param {string} isoDate */
export const shortDayLabel = (isoDate) => shortDayFmt.format(new Date(`${isoDate}T12:00:00Z`));
/** « 14:30 » @param {Date|string} instant */
export const timeLabel = (instant) =>
  timeFmt
    .format(new Date(instant))
    .replace(':', ' h ')
    .replace(/ h 00$/, ' h');
/** « 14:30 » en 24 h strict, pour les champs et les données. @param {Date|string} instant */
export const hhmm = (instant) => timeFmt.format(new Date(instant));
/** « 24 nov. 2026, 14:30 » @param {Date|string|null} instant */
export const dateTimeLabel = (instant) => (instant ? dateTimeFmt.format(new Date(instant)) : '');
/** « novembre 2026 » @param {Date} instant */
export const monthLabel = (instant) => monthFmt.format(instant);

/** Montant en euros, ou tiret. @param {number|null|undefined} euros */
export const money = (euros) => (euros == null ? '—' : formatEuro(euros));

/** @param {number} cents */
export const moneyFromCents = (cents) => formatEuro(cents / 100);

/** Destinataire masqué : « a***@gmail.com », « +33 6 ** ** ** 12 ». @param {string} value */
export function maskRecipient(value) {
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return value.length > 4 ? `${value.slice(0, 3)}••••${value.slice(-2)}` : '••••';
}

/** Valeur d'une durée en minutes : « 2 h 30 ». @param {number} minutes */
export function minutesLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

export const admin = {
  STATUS_LABELS,
  STATUS_TONE,
  dayLabel,
  shortDayLabel,
  timeLabel,
  hhmm,
  dateTimeLabel,
  monthLabel,
  money,
  moneyFromCents,
  maskRecipient,
  minutesLabel,
};
