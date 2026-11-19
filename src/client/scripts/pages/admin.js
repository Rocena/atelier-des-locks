// @ts-check
/** Comportements du back-office : frise de l'agenda, listes réordonnables, envoi de photos. */
import { initTimeline } from '../components/admin-agenda.js';
import { initSortables } from '../components/admin-sortable.js';
import { initUploader } from '../components/admin-uploader.js';

document.documentElement.classList.add('js');

initTimeline();
initSortables();
initUploader();

// Nouveau rendez-vous : seules les options de la prestation choisie sont proposées.
const service = /** @type {HTMLSelectElement|null} */ (
  document.querySelector('select[name="service"]')
);
if (service) {
  const sync = () => {
    for (const group of /** @type {NodeListOf<HTMLElement>} */ (
      document.querySelectorAll('[data-options-for]')
    )) {
      const active = group.dataset.optionsFor === service.value;
      group.hidden = !active;
      for (const box of /** @type {NodeListOf<HTMLInputElement>} */ (
        group.querySelectorAll('input')
      )) {
        box.disabled = !active;
        if (!active) box.checked = false;
      }
    }
  };
  service.addEventListener('change', sync);
  sync();
}
