// @ts-check
/**
 * Révélations à l'apparition ([data-reveal]) et fil de loc piloté par le scroll ([data-animate]).
 * Phase 2 : GSAP ScrollTrigger prendra le relais pour les séquences complexes ;
 * ce module reste la base légère (IntersectionObserver, sans dépendance).
 */
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;
  if (reducedMotion() || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-revealed'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
  );
  targets.forEach((el) => observer.observe(el));
}

/** Le fil se dessine à mesure que son SVG traverse la fenêtre. */
export function initLocThreads() {
  const threads = /** @type {NodeListOf<SVGSVGElement>} */ (
    document.querySelectorAll('.loc-thread[data-animate]')
  );
  if (!threads.length || reducedMotion()) return;

  let ticking = false;
  const update = () => {
    const vh = window.innerHeight;
    for (const svg of threads) {
      const rect = svg.getBoundingClientRect();
      // 0 quand le haut du fil entre par le bas de l'écran, 1 quand son bas atteint 35 % de la hauteur
      const progress = (vh - rect.top) / (rect.height + vh * 0.65);
      svg.style.setProperty('--loc-progress', String(Math.min(1, Math.max(0, progress))));
    }
    ticking = false;
  };
  const onScroll = () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}
