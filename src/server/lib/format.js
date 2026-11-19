// @ts-check
/**
 * Formatage pour les templates (fonctions pures, testées dans format.test.js).
 * Convention de contenu : un mot entre astérisques (*loc*) devient le mot en italique
 * terre cuite des grands titres (BRAND.md). Le texte est échappé AVANT la conversion.
 */

/** @param {string} value */
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * « Faire naître vos *locks* » → « Faire naître vos <em>locks</em> » (HTML sûr).
 * @param {string} text
 */
export function accent(text) {
  return escapeHtml(text).replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Retire les marqueurs d'accent (balises title, meta, aria). @param {string} text */
export function plain(text) {
  return String(text).replace(/\*([^*]+)\*/g, '$1');
}

const euro = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/** @param {number} amount */
export function formatEuro(amount) {
  return euro.format(amount).replace(/\u202f|\u00a0/g, '\u00a0');
}

/**
 * Prix affiché d'une prestation : « Sur devis », « à partir de 60 € » ou « 45 € ».
 * @param {{ price: number|null, priceFrom: boolean, onQuote: boolean }} service
 */
export function formatPrice(service) {
  if (service.onQuote || service.price == null) return 'Sur devis';
  return `${service.priceFrom ? 'à partir de ' : ''}${formatEuro(service.price)}`;
}

/** 90 → « 1 h 30 », 45 → « 45 min », 120 → « 2 h ». @param {number} minutes */
export function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}\u00a0min`;
  return m ? `${h}\u00a0h\u00a0${String(m).padStart(2, '0')}` : `${h}\u00a0h`;
}

/**
 * Fourchette de durée : « 1 h 30 – 2 h 30 », ou une seule valeur si min = max.
 * @param {number} min @param {number} max
 */
export function formatDuration(min, max) {
  if (!max || max === min) return formatMinutes(min);
  // Mêmes heures pleines : « 3 – 6 h » plutôt que « 3 h – 6 h »
  if (min % 60 === 0 && max % 60 === 0) return `${min / 60}\u00a0–\u00a0${max / 60}\u00a0h`;
  return `${formatMinutes(min)}\u00a0–\u00a0${formatMinutes(max)}`;
}

const longDate = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Paris',
});

/** « 2026-10-14 » → « 14 octobre 2026 ». @param {string} isoDate */
export function formatDate(isoDate) {
  return longDate.format(new Date(`${isoDate}T12:00:00Z`));
}

const weekdayDate = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Paris',
});
const hourMinute = new Intl.DateTimeFormat('fr-FR', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
});

/** Instant → « mardi 1 décembre 2026 » (heure de Paris). @param {Date|string} instant */
export function formatDay(instant) {
  return weekdayDate.format(new Date(instant)).replace(/^(\S+) 1 /, '$1 1er ');
}

/** Instant → « 9h », « 14h30 » (heure de Paris). @param {Date|string} instant */
export function formatTime(instant) {
  const [h, m] = hourMinute.format(new Date(instant)).split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
}

/** 4.875 → « 4,9 ». @param {number} value */
export function formatRating(value) {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export const fmt = {
  accent,
  plain,
  formatEuro,
  formatPrice,
  formatMinutes,
  formatDuration,
  formatDate,
  formatDay,
  formatTime,
  formatRating,
};
