// @ts-check
import { initCommon, withMotion } from '../common.js';
import { initLightbox } from '../components/lightbox.js';

initCommon();
initLightbox();

/**
 * Filtres instantanés : les vignettes sont masquées sans recharger, l'URL est mise à jour
 * (partageable), le nombre de résultats est annoncé (aria-live).
 */
function initFilters() {
  const form = /** @type {HTMLFormElement | null} */ (
    document.querySelector('[data-gallery-filters]')
  );
  if (!form) return;
  const items = /** @type {HTMLElement[]} */ ([
    ...document.querySelectorAll('[data-gallery-item]'),
  ]);
  const count = document.querySelector('[data-gallery-count]');
  const empty = /** @type {HTMLElement | null} */ (document.querySelector('[data-gallery-empty]'));
  form.querySelector('[data-filters-submit]')?.setAttribute('hidden', '');

  const apply = () => {
    const data = new FormData(form);
    const wanted = {
      category: String(data.get('categorie') ?? ''),
      method: String(data.get('methode') ?? ''),
      size: String(data.get('taille') ?? ''),
    };
    let shown = 0;
    for (const item of items) {
      const ok =
        (!wanted.category || item.dataset.category === wanted.category) &&
        (!wanted.method || item.dataset.method === wanted.method) &&
        (!wanted.size || item.dataset.size === wanted.size);
      item.hidden = !ok;
      if (ok) shown += 1;
    }
    if (count) count.textContent = `${shown} réalisation${shown > 1 ? 's' : ''}`;
    if (empty) empty.hidden = shown > 0;
    const params = new URLSearchParams();
    for (const [key, value] of data) if (value) params.set(key, String(value));
    const query = params.toString();
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
  };

  form.addEventListener('change', apply);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    apply();
  });
  for (const reset of document.querySelectorAll('[data-filters-reset]')) {
    reset.addEventListener('click', (event) => {
      event.preventDefault();
      form.reset();
      for (const select of form.querySelectorAll('select')) select.value = '';
      apply();
    });
  }
}

initFilters();
withMotion((motion) => motion.splitTitles());
