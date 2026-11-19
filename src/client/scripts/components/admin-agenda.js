// @ts-check
/**
 * Frise horaire de l'agenda : positionnement (variables CSS posées par CSSOM, compatible CSP),
 * ligne « maintenant », glisser-déposer d'un rendez-vous avec confirmation et notification.
 * Souris et stylet : glisser. Au doigt, un rendez-vous s'ouvre (fiche, bouton « Déplacer »),
 * parce que le défilement et le glisser se contredisent sur écran tactile.
 */
import { postJson } from './admin-http.js';

const SNAP_MINUTES = 15;
const DRAG_THRESHOLD_PX = 6;

/** @param {number} minutes */
const fmtTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** @param {string} isoDate */
const fmtDay = (isoDate) =>
  new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T12:00:00Z`));

export function initTimeline() {
  const tl = /** @type {HTMLElement|null} */ (document.querySelector('[data-timeline]'));
  if (!tl) return;
  const dayStart = Number(tl.dataset.dayStart);
  const dayEnd = Number(tl.dataset.dayEnd);
  const span = dayEnd - dayStart;
  tl.style.setProperty('--day-start', String(dayStart));
  tl.style.setProperty('--day-span', String(span));
  tl.style.setProperty('--cols', tl.dataset.cols ?? '1');

  for (const el of /** @type {NodeListOf<HTMLElement>} */ (tl.querySelectorAll('.tl__hour'))) {
    el.style.setProperty('--m', el.dataset.minutes ?? '0');
  }
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (tl.querySelectorAll('.tl__closed'))) {
    el.style.setProperty('--from', el.dataset.from ?? '0');
    el.style.setProperty('--to', el.dataset.to ?? '0');
  }
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (tl.querySelectorAll('.tl__event'))) {
    el.style.setProperty('--start', el.dataset.start ?? '0');
    el.style.setProperty('--span', el.dataset.span ?? '30');
    // Un lien se « glisse » nativement (aperçu, annulation des événements du pointeur) : on le désactive.
    el.draggable = false;
    const buffer = Number(el.dataset.buffer ?? 0);
    if (buffer > 0 && el.parentElement) {
      const hatch = document.createElement('span');
      hatch.className = 'tl__buffer';
      hatch.setAttribute('aria-hidden', 'true');
      hatch.style.setProperty('--start', el.dataset.start ?? '0');
      hatch.style.setProperty('--span', el.dataset.span ?? '0');
      hatch.style.setProperty('--buffer', String(buffer));
      el.parentElement.append(hatch);
    }
  }
  const now = tl.dataset.now;
  const today = tl.querySelector('.tl__day-title[aria-current="date"]');
  if (now && today) {
    const index = [...tl.querySelectorAll('.tl__day-title')].indexOf(today);
    const column = tl.querySelectorAll('.tl__col')[index];
    if (column) {
      const line = document.createElement('span');
      line.className = 'tl__now';
      line.setAttribute('aria-hidden', 'true');
      line.style.setProperty('--now', now);
      column.append(line);
    }
  }

  initDrag(tl, dayStart, span);
}

/**
 * @param {HTMLElement} tl
 * @param {number} dayStart
 * @param {number} span
 */
function initDrag(tl, dayStart, span) {
  const found = /** @type {HTMLDialogElement|null} */ (
    document.querySelector('[data-move-dialog]')
  );
  if (!found) return;
  /** @type {HTMLDialogElement} */
  const dialog = found;
  const columns = /** @type {HTMLElement[]} */ ([...tl.querySelectorAll('.tl__col')]);
  const summary = /** @type {HTMLElement} */ (dialog.querySelector('[data-move-summary]'));
  const errorBox = /** @type {HTMLElement} */ (dialog.querySelector('[data-move-error]'));
  const notify = /** @type {HTMLInputElement} */ (dialog.querySelector('input[name="notify"]'));
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));

  /** @type {{ el: HTMLElement, startX: number, startY: number, originMinutes: number, originCol: HTMLElement, spanMin: number, moved: boolean, ghost: HTMLElement|null, target: { col: HTMLElement, minutes: number }|null }|null} */
  let drag = null;
  let suppressClick = false;

  /** @param {number} clientX */
  const columnAt = (clientX) =>
    columns.find((c) => {
      const r = c.getBoundingClientRect();
      return clientX >= r.left && clientX < r.right;
    });

  tl.addEventListener('dragstart', (event) => event.preventDefault());

  tl.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    const el = /** @type {HTMLElement|null} */ (
      /** @type {Element} */ (event.target).closest('.tl__event[data-draggable]')
    );
    if (!el || !el.parentElement) return;
    drag = {
      el,
      startX: event.clientX,
      startY: event.clientY,
      originMinutes: Number(el.dataset.start),
      originCol: el.parentElement,
      spanMin: Number(el.dataset.span),
      moved: false,
      ghost: null,
      target: null,
    };
    el.setPointerCapture(event.pointerId);
  });

  tl.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.el.classList.add('is-dragging');
      drag.ghost = document.createElement('span');
      drag.ghost.className = 'tl__ghost';
      drag.ghost.setAttribute('aria-hidden', 'true');
    }
    const col = columnAt(event.clientX) ?? drag.originCol;
    const pxPerMinute = drag.originCol.getBoundingClientRect().height / span;
    const raw = drag.originMinutes + dy / pxPerMinute;
    const minutes = Math.min(
      dayStart + span - 15,
      Math.max(dayStart, Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES),
    );
    drag.target = { col, minutes };
    drag.el.style.setProperty('--start', String(minutes));
    if (drag.ghost) {
      drag.ghost.style.setProperty('--start', String(minutes));
      drag.ghost.style.setProperty('--span', String(drag.spanMin));
      col.append(drag.ghost);
    }
    // L'événement suit la colonne visée en semaine.
    if (col !== drag.el.parentElement) col.append(drag.el);
  });

  const finish = (/** @type {PointerEvent} */ event) => {
    if (!drag) return;
    const current = drag;
    drag = null;
    current.ghost?.remove();
    current.el.classList.remove('is-dragging');
    if (current.el.hasPointerCapture(event.pointerId))
      current.el.releasePointerCapture(event.pointerId);
    if (!current.moved || !current.target) return;
    suppressClick = true;
    const { col, minutes } = current.target;
    const date = col.dataset.date ?? '';
    const changed = col !== current.originCol || minutes !== current.originMinutes;
    const revert = () => {
      current.originCol.append(current.el);
      current.el.style.setProperty('--start', String(current.originMinutes));
    };
    if (!changed) return revert();
    openDialog(current.el, date, minutes, revert);
  };
  tl.addEventListener('pointerup', finish);
  tl.addEventListener('pointercancel', finish);

  // Un glisser ne doit pas ouvrir la fiche du rendez-vous.
  tl.addEventListener(
    'click',
    (event) => {
      if (suppressClick) {
        event.preventDefault();
        suppressClick = false;
      }
    },
    true,
  );

  /** @type {{ el: HTMLElement, date: string, minutes: number, revert: () => void }|null} */
  let pending = null;

  dialog.addEventListener('close', async () => {
    const current = pending;
    if (!current) return;
    if (dialog.returnValue !== 'confirm') {
      pending = null;
      return current.revert();
    }
    const url = (tl.dataset.moveUrl ?? '').replace(':id', current.el.dataset.id ?? '');
    const result = await postJson(url, {
      date: current.date,
      time: fmtTime(current.minutes),
      notify: notify.checked ? '1' : '',
    });
    if (result.ok) return location.reload();
    errorBox.textContent = result.data?.message ?? 'Le déplacement a échoué. Réessayez.';
    errorBox.hidden = false;
    dialog.returnValue = '';
    dialog.showModal();
  });

  /**
   * @param {HTMLElement} el
   * @param {string} date
   * @param {number} minutes
   * @param {() => void} revert
   */
  function openDialog(el, date, minutes, revert) {
    pending = { el, date, minutes, revert };
    errorBox.hidden = true;
    summary.textContent = `${el.dataset.label ?? 'Ce rendez-vous'} : ${fmtDay(date)}, ${fmtTime(minutes).replace(':', ' h ')}.`;
    form.reset();
    dialog.returnValue = '';
    dialog.showModal();
  }
}
