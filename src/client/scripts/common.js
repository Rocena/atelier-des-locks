// @ts-check
/** Comportements partagés par toutes les pages publiques. */
import { initThemeToggle } from './components/theme-toggle.js';
import { initHeader } from './components/header.js';
import { initMobileMenu } from './components/mobile-menu.js';
import { initNavigation } from './components/navigation.js';
import { initPointer } from './components/pointer.js';
import { initMarquees } from './components/marquee.js';
import { initReveal, initLocThreads } from './components/reveal.js';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Résolue à la première interaction (défilement, pointeur, clavier, toucher).
 * La couche d'animation (Lenis, GSAP) n'est chargée qu'à ce moment : le premier écran
 * (hero en CSS pur) n'en a pas besoin, et le thread principal reste libre au chargement.
 * @type {Promise<void>}
 */
const firstInteraction = new Promise((resolve) => {
  const events = ['scroll', 'wheel', 'pointerdown', 'pointermove', 'keydown', 'touchstart'];
  const done = () => {
    events.forEach((e) => window.removeEventListener(e, done));
    resolve();
  };
  events.forEach((e) => window.addEventListener(e, done, { passive: true, once: true }));
  // Arrivée sur une ancre ou après rechargement en milieu de page : on n'attend pas.
  if (window.scrollY > 0 || location.hash) done();
});

/** Défilement doux : seulement avec une souris/un trackpad et le mouvement autorisé. */
async function initSmoothScroll() {
  if (reducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
  await firstInteraction;
  try {
    const { startSmooth } = await import('./motion/smooth.js');
    startSmooth();
  } catch {
    // Défilement natif : rien à faire.
  }
}

/**
 * Charge GSAP à la demande (après le défilement doux, pour les relier) et lance `run`.
 * En mouvement réduit, ou si le chargement échoue, `fallback` affiche l'état final.
 * @param {(motion: typeof import('./motion/gsap.js')) => void} run
 * @param {() => void} [fallback]
 */
export async function withMotion(run, fallback) {
  if (reducedMotion()) return fallback?.();
  try {
    await firstInteraction;
    await smoothReady;
    run(await import('./motion/gsap.js'));
  } catch (error) {
    console.warn('Animations indisponibles', error);
    fallback?.();
  }
}

/** Fil de loc piloté par GSAP : affiché entier si GSAP n'est pas là. */
export function showThreadsStatic() {
  for (const svg of /** @type {NodeListOf<SVGSVGElement>} */ (
    document.querySelectorAll('.loc-thread[data-animate="gsap"]')
  )) {
    svg.style.setProperty('--loc-progress', '1');
  }
}

/** @type {Promise<void>} */
let smoothReady = Promise.resolve();

export function initCommon() {
  initThemeToggle();
  initHeader();
  initMobileMenu();
  initNavigation();
  initReveal();
  initLocThreads();
  initPointer();
  initMarquees();
  smoothReady = initSmoothScroll();
}
