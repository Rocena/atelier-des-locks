// @ts-check
/**
 * Desktop uniquement (pointeur fin, survol possible, mouvement autorisé) :
 * boutons magnétiques subtils ([data-magnetic]) et curseur discret (anneau qui suit).
 * Le curseur natif reste affiché : l'anneau n'est qu'un accompagnement.
 */
const MAX_PULL = 6; // px : attraction maximale d'un bouton magnétique

export function initPointer() {
  const ok = window.matchMedia(
    '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
  );
  if (!ok.matches) return;

  for (const el of /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('[data-magnetic]')
  )) {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2 * MAX_PULL;
      const y = ((e.clientY - r.top) / r.height - 0.5) * 2 * MAX_PULL;
      el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.translate = '';
    });
  }

  const cursor = /** @type {HTMLElement | null} */ (document.querySelector('[data-cursor]'));
  if (!cursor) return;
  cursor.dataset.active = 'true';
  let x = -100;
  let y = -100;
  let cx = x;
  let cy = y;
  let raf = 0;
  const loop = () => {
    // Léger retard (lerp) : l'anneau suit sans coller au pointeur
    cx += (x - cx) * 0.2;
    cy += (y - cy) * 0.2;
    cursor.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
    raf = Math.abs(x - cx) + Math.abs(y - cy) > 0.1 ? requestAnimationFrame(loop) : 0;
  };
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX;
      y = e.clientY;
      cursor.dataset.visible = 'true';
      const target = /** @type {Element} */ (e.target);
      cursor.dataset.hover = String(!!target.closest?.('a, button, summary, label'));
      if (!raf) raf = requestAnimationFrame(loop);
    },
    { passive: true },
  );
  document.documentElement.addEventListener('pointerleave', () => {
    cursor.dataset.visible = 'false';
  });
}
