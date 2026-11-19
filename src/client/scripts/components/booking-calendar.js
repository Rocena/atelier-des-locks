// @ts-check
/**
 * Calendrier mensuel accessible (boutons dans un tableau, navigation au clavier façon « grille » ARIA) : flèches, Début/Fin (semaine),
 * Page préc./suiv. (mois), Entrée/Espace pour choisir. Un seul jour est tabulable à la fois.
 * Les jours sans créneau restent atteignables au clavier (aria-disabled) pour garder un
 * déplacement prévisible, mais ne se choisissent pas.
 */

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');

/** @param {string} date « AAAA-MM-JJ » @param {number} days */
export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** @param {string} month « AAAA-MM » @param {number} delta */
export function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`;
}

/** Dernier jour du mois. @param {string} month */
export function monthEnd(month) {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

/** 1 = lundi … 7 = dimanche. @param {string} date */
const weekday = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
};

const monthFormat = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** @param {string} month */
export const monthLabel = (month) => monthFormat.format(new Date(`${month}-01T12:00:00Z`));
/** « mardi 1er décembre » @param {string} date */
export const dayLabel = (date) =>
  dayFormat.format(new Date(`${date}T12:00:00Z`)).replace(/^(\S+) 1 /, '$1 1er ');

/**
 * @typedef {object} CalendarOptions
 * @property {HTMLElement} tbody
 * @property {string} today
 * @property {(date: string) => void} onSelect
 * @property {(month: string, focusDate: string) => void} onMonthChange  navigation clavier hors du mois
 */

/** @param {CalendarOptions} options */
export function createCalendar({ tbody, today, onSelect, onMonthChange }) {
  /** @type {string} */
  let month = today.slice(0, 7);
  /** @type {Set<string>} */
  let available = new Set();
  /** @type {string|null} */
  let selected = null;
  /** @type {string} */
  let focusDate = today;

  /** @param {string} date */
  const cell = (date) =>
    /** @type {HTMLButtonElement|null} */ (tbody.querySelector(`[data-date="${date}"]`));

  function render() {
    const first = `${month}-01`;
    const last = monthEnd(month);
    const start = addDays(first, 1 - weekday(first));
    const rows = [];
    for (let row = 0, date = start; date <= last; row++) {
      const cells = [];
      for (let col = 0; col < 7; col++, date = addDays(date, 1)) {
        if (date.slice(0, 7) !== month) {
          cells.push('<td></td>');
          continue;
        }
        const isAvailable = available.has(date);
        const classes = [
          'calendar__day',
          isAvailable ? 'is-available' : '',
          date === today ? 'is-today' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const label = `${dayLabel(date)}${isAvailable ? ', créneaux disponibles' : ', complet ou fermé'}`;
        cells.push(
          `<td><button type="button" class="${classes}" data-date="${date}" tabindex="-1" aria-label="${label}" aria-pressed="${date === selected}"${isAvailable ? '' : ' aria-disabled="true"'}>${Number(date.slice(8))}</button></td>`,
        );
      }
      rows.push(`<tr>${cells.join('')}</tr>`);
    }
    tbody.innerHTML = rows.join('');
    const target = cell(focusDate) ?? cell(selected ?? '') ?? cell(first);
    if (target) target.tabIndex = 0;
  }

  /** @param {string} date @param {boolean} [moveFocus] */
  function focus(date, moveFocus = true) {
    if (date.slice(0, 7) !== month) {
      focusDate = date;
      onMonthChange(date.slice(0, 7), date);
      return;
    }
    tbody.querySelectorAll('[tabindex="0"]').forEach((el) => {
      /** @type {HTMLElement} */ (el).tabIndex = -1;
    });
    const target = cell(date);
    if (!target) return;
    focusDate = date;
    target.tabIndex = 0;
    if (moveFocus) target.focus();
  }

  /** @param {string} date */
  function select(date) {
    if (!available.has(date)) return;
    selected = date;
    tbody
      .querySelectorAll('[aria-pressed="true"]')
      .forEach((el) => el.setAttribute('aria-pressed', 'false'));
    cell(date)?.setAttribute('aria-pressed', 'true');
    focus(date, false);
    onSelect(date);
  }

  tbody.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-date]');
    if (button instanceof HTMLElement && button.dataset.date) select(button.dataset.date);
  });

  tbody.addEventListener('keydown', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-date]');
    if (!(button instanceof HTMLElement) || !button.dataset.date) return;
    const date = button.dataset.date;
    /** @type {Record<string, () => string>} */
    const moves = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, 1 - weekday(date)),
      End: () => addDays(date, 7 - weekday(date)),
      PageUp: () => `${addMonths(date.slice(0, 7), -1)}-${date.slice(8)}`,
      PageDown: () => `${addMonths(date.slice(0, 7), 1)}-${date.slice(8)}`,
    };
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(date);
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    let next = move();
    // 31 → mois de 30 jours : on se cale sur le dernier jour.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next.slice(5, 7) !== addDays(next, 0).slice(5, 7)) {
      next = monthEnd(next.slice(0, 7));
    }
    focus(next);
  });

  return {
    /**
     * Affiche un mois (squelette si `loading`).
     * @param {string} m
     * @param {{ available?: string[], focus?: string }} [opts]
     */
    show(m, opts = {}) {
      month = m;
      available = new Set(opts.available ?? []);
      if (opts.focus) focusDate = opts.focus;
      else if (focusDate.slice(0, 7) !== m) focusDate = `${m}-01`;
      render();
    },
    select,
    /** @param {string} date */
    focus: (date) => focus(date),
    get selected() {
      return selected;
    },
    clearSelection() {
      selected = null;
    },
  };
}
