// @ts-check
/**
 * Défilement doux (Lenis), chargé à la demande : desktop à pointeur fin, mouvement autorisé.
 * Module partagé : le premier appel crée l'instance, les suivants la renvoient.
 */
import Lenis from 'lenis';

/** @type {Lenis | null} */
let lenis = null;

export function startSmooth() {
  if (lenis) return lenis;
  const instance = new Lenis({ autoRaf: true, anchors: true, lerp: 0.12 });
  lenis = instance;
  // Menu mobile ouvert : la page sous-jacente ne défile pas.
  new MutationObserver(() => {
    if (document.documentElement.dataset.menuOpen === 'true') instance.stop();
    else instance.start();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-menu-open'] });
  return instance;
}

export function getLenis() {
  return lenis;
}
