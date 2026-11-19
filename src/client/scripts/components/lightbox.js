// @ts-check
/**
 * Lightbox de galerie sur <dialog> natif (focus piégé, Échap, retour du focus gérés par le
 * navigateur). Déclencheurs : boutons [data-lightbox-item] avec data-title, data-meta et
 * data-ratio ; le visuel affiché est une copie du contenu [data-lightbox-media] du bouton.
 * Flèches ← → pour naviguer parmi les éléments visibles.
 */
export function initLightbox() {
  const dialog = /** @type {HTMLDialogElement | null} */ (
    document.querySelector('[data-lightbox]')
  );
  if (!dialog) return;
  const media = /** @type {HTMLElement} */ (dialog.querySelector('[data-lightbox-target]'));
  const title = /** @type {HTMLElement} */ (dialog.querySelector('[data-lightbox-title]'));
  const meta = /** @type {HTMLElement} */ (dialog.querySelector('[data-lightbox-meta]'));
  const counter = /** @type {HTMLElement} */ (dialog.querySelector('[data-lightbox-counter]'));
  /** @type {HTMLElement[]} */ let items = [];
  let index = 0;

  const visibleItems = () =>
    /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-lightbox-item]')]).filter(
      (el) => !el.closest('[hidden]'),
    );

  /** @param {number} i */
  const show = (i) => {
    index = (i + items.length) % items.length;
    const item = items[index];
    const source = item.querySelector('[data-lightbox-media]');
    media.replaceChildren(...(source ? [source.cloneNode(true)] : []));
    media.style.setProperty('--lightbox-ratio', item.dataset.ratio ?? '4 / 5');
    title.textContent = item.dataset.title ?? '';
    meta.textContent = item.dataset.meta ?? '';
    counter.textContent = `${index + 1} / ${items.length}`;
  };

  document.addEventListener('click', (event) => {
    const trigger = /** @type {HTMLElement | null} */ (
      /** @type {Element} */ (event.target).closest('[data-lightbox-item]')
    );
    if (!trigger) return;
    items = visibleItems();
    show(items.indexOf(trigger));
    dialog.showModal();
  });

  dialog.querySelector('[data-lightbox-prev]')?.addEventListener('click', () => show(index - 1));
  dialog.querySelector('[data-lightbox-next]')?.addEventListener('click', () => show(index + 1));
  dialog.querySelector('[data-lightbox-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') show(index - 1);
    if (event.key === 'ArrowRight') show(index + 1);
  });
  // Clic sur le fond (hors de la boîte) : fermeture
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
