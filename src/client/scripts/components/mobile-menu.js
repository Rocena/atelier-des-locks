// @ts-check
/**
 * Menu mobile plein écran : ouverture/fermeture animée, Échap pour fermer,
 * focus piégé dans le menu + bouton, retour du focus au bouton à la fermeture.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function initMobileMenu() {
  const toggle = /** @type {HTMLButtonElement | null} */ (
    document.querySelector('[data-menu-toggle]')
  );
  const menu = /** @type {HTMLElement | null} */ (document.querySelector('[data-mobile-menu]'));
  const header = /** @type {HTMLElement | null} */ (document.querySelector('[data-site-header]'));
  if (!toggle || !menu) return;

  const label = toggle.querySelector('.menu-toggle__label');
  const root = document.documentElement;
  const desktop = window.matchMedia('(min-width: 64rem)');
  /** @type {number | undefined} */
  let closeTimer;

  const open = () => {
    window.clearTimeout(closeTimer);
    menu.hidden = false;
    // Laisse le navigateur peindre l'état fermé avant d'animer l'ouverture.
    requestAnimationFrame(() => requestAnimationFrame(() => (menu.dataset.open = 'true')));
    toggle.setAttribute('aria-expanded', 'true');
    if (label) label.textContent = 'Fermer';
    root.dataset.menuOpen = 'true';
    if (header) header.dataset.menuOpen = 'true';
    /** @type {HTMLElement | null} */ (menu.querySelector(FOCUSABLE))?.focus({
      preventScroll: true,
    });
  };

  const close = ({ restoreFocus = true } = {}) => {
    menu.dataset.open = 'false';
    toggle.setAttribute('aria-expanded', 'false');
    if (label) label.textContent = 'Menu';
    delete root.dataset.menuOpen;
    if (header) delete header.dataset.menuOpen;
    closeTimer = window.setTimeout(() => (menu.hidden = true), 320);
    if (restoreFocus) toggle.focus();
  };

  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

  toggle.addEventListener('click', () => (isOpen() ? close() : open()));

  document.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const items = [toggle, ...menu.querySelectorAll(FOCUSABLE)].filter(
        (el) => /** @type {HTMLElement} */ (el).offsetParent !== null,
      );
      const first = /** @type {HTMLElement} */ (items[0]);
      const last = /** @type {HTMLElement} */ (items[items.length - 1]);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  menu.addEventListener('click', (event) => {
    if (/** @type {HTMLElement} */ (event.target).closest('a')) close({ restoreFocus: false });
  });

  desktop.addEventListener('change', (event) => {
    if (event.matches && isOpen()) close({ restoreFocus: false });
  });
}
