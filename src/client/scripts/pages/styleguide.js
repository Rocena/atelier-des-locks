// @ts-check
import { initCommon } from '../common.js';

initCommon();

/** Démo du formulaire : validation au blur et message d'état annoncé (aria-live). */
const form = /** @type {HTMLFormElement | null} */ (document.querySelector('[data-sg-form]'));
const status = form?.querySelector('[data-sg-form-status]');

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const button = /** @type {HTMLButtonElement} */ (form.querySelector('[type="submit"]'));
  button.setAttribute('aria-busy', 'true');
  if (status) status.textContent = 'Envoi en cours…';
  window.setTimeout(() => {
    button.removeAttribute('aria-busy');
    if (status) status.textContent = 'Démonstration : rien n’a été envoyé.';
  }, 1200);
});
