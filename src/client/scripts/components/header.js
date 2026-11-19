// @ts-check
/**
 * Header sticky : fond plein une fois la page défilée, masqué au scroll vers le bas,
 * réaffiché au scroll vers le haut ou quand le focus clavier y revient.
 */
const THRESHOLD = 8; // px de défilement ignorés (évite le clignotement)

export function initHeader() {
  const header = /** @type {HTMLElement | null} */ (document.querySelector('[data-site-header]'));
  if (!header) return;

  let lastY = window.scrollY;
  let ticking = false;

  const update = () => {
    const y = window.scrollY;
    header.dataset.scrolled = String(y > 4);
    if (Math.abs(y - lastY) > THRESHOLD) {
      const goingDown = y > lastY && y > header.offsetHeight * 2;
      header.dataset.hidden = String(goingDown && !header.matches(':focus-within'));
      lastY = y;
    }
    ticking = false;
  };

  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    },
    { passive: true },
  );
  header.addEventListener('focusin', () => {
    header.dataset.hidden = 'false';
  });
  update();
}
