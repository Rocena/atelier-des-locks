// @ts-check
/**
 * Listes réordonnables par glisser-déposer : [data-sortable] contient des éléments [data-id] ;
 * la poignée [data-handle] de chacun lance le glisser. L'ordre est envoyé à data-reorder-url.
 * Les boutons ↑ ↓ restent disponibles (clavier, écrans tactiles, sans JavaScript).
 */
import { postJson } from './admin-http.js';

export function initSortables() {
  for (const list of /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('[data-sortable]')
  )) {
    initList(list);
  }
}

/** @param {HTMLElement} list */
function initList(list) {
  const url = list.dataset.reorderUrl ?? '';

  /** @type {{ item: HTMLElement, pointerId: number, handle: HTMLElement }|null} */
  let drag = null;

  list.addEventListener('pointerdown', (event) => {
    const handle = /** @type {HTMLElement|null} */ (
      /** @type {Element} */ (event.target).closest('[data-handle]')
    );
    const item = /** @type {HTMLElement|null} */ (handle?.closest('[data-id]'));
    if (!handle || !item || !list.contains(item) || event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    item.classList.add('is-dragging');
    drag = { item, pointerId: event.pointerId, handle };
  });

  list.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const under = /** @type {HTMLElement|null} */ (
      document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-id]') ?? null
    );
    if (!under || under === drag.item || under.parentElement !== list) return;
    const items = [...list.children];
    const draggedIndex = items.indexOf(drag.item);
    const targetIndex = items.indexOf(under);
    // On passe de l'autre côté de l'élément survolé.
    if (draggedIndex < targetIndex) under.after(drag.item);
    else under.before(drag.item);
  });

  const end = async (/** @type {PointerEvent} */ event) => {
    if (!drag) return;
    const { item, handle, pointerId } = drag;
    drag = null;
    item.classList.remove('is-dragging');
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    if (event.type === 'pointercancel') return location.reload();
    const ids = [...list.children]
      .map((el) => Number(/** @type {HTMLElement} */ (el).dataset.id))
      .filter(Boolean);
    const result = await postJson(url, { ids });
    if (!result.ok) location.reload();
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}
