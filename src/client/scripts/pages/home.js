// @ts-check
import { initCommon, showThreadsStatic, withMotion } from '../common.js';
import { initLightbox } from '../components/lightbox.js';

initCommon();
initLightbox();

/**
 * Carrousel des méthodes piloté par le scroll (desktop) : la section est épinglée et la piste
 * glisse horizontalement. Sur mobile, la piste reste glissable au doigt (scroll-snap natif).
 * @param {typeof import('../motion/gsap.js')} motion
 */
function pinMethodsRail({ gsap, ScrollTrigger }) {
  const section = /** @type {HTMLElement | null} */ (document.querySelector('[data-methods-rail]'));
  const track = /** @type {HTMLElement | null} */ (document.querySelector('[data-methods-track]'));
  if (!section || !track) return;

  const mm = gsap.matchMedia();
  mm.add('(min-width: 64rem)', () => {
    section.dataset.pinned = 'true';
    const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);
    const tween = gsap.to(track, {
      x: () => -distance(),
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: () => `+=${distance()}`,
        pin: true,
        scrub: 0.8,
        invalidateOnRefresh: true,
      },
    });
    // Clavier : un panneau qui reçoit le focus est amené à l'écran.
    /** @param {FocusEvent} event */
    const onFocus = (event) => {
      const st = tween.scrollTrigger;
      const panel = /** @type {HTMLElement} */ (event.target).closest('li');
      if (!st || !panel) return;
      const ratio = Math.min(
        1,
        panel.offsetLeft / Math.max(1, track.scrollWidth - window.innerWidth),
      );
      window.scrollTo({ top: st.start + (st.end - st.start) * ratio, behavior: 'instant' });
    };
    track.addEventListener('focusin', onFocus);
    return () => {
      track.removeEventListener('focusin', onFocus);
      delete section.dataset.pinned;
    };
  });
  // Les polices changent les largeurs : on recalcule une fois chargées.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

/**
 * Le soleil du CTA final grandit légèrement au scroll (BRAND.md : motifs).
 * @param {typeof import('../motion/gsap.js')} motion
 */
function growSun({ gsap }) {
  for (const sun of document.querySelectorAll('[data-sun]')) {
    gsap.fromTo(
      sun,
      { scale: 0.85 },
      {
        scale: 1.05,
        ease: 'none',
        scrollTrigger: {
          trigger: sun.parentElement,
          start: 'top bottom',
          end: 'bottom bottom',
          scrub: true,
        },
      },
    );
  }
}

withMotion((motion) => {
  motion.splitTitles();
  motion.drawThreads();
  motion.parallax();
  pinMethodsRail(motion);
  growSun(motion);
}, showThreadsStatic);
