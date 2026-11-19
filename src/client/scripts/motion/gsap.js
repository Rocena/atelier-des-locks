// @ts-check
/**
 * GSAP + ScrollTrigger + SplitText, chargés à la demande (jamais dans le JS initial).
 * Relie ScrollTrigger à Lenis quand le défilement doux est actif.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { getLenis } from './smooth.js';

gsap.registerPlugin(ScrollTrigger, SplitText);
getLenis()?.on('scroll', ScrollTrigger.update);

export { gsap, ScrollTrigger, SplitText };

/**
 * Titres révélés ligne par ligne, avec masque ([data-split]).
 * autoSplit : le découpage est refait si la largeur change (polices chargées, rotation).
 * @param {ParentNode} [root]
 */
export function splitTitles(root = document) {
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-split]'))) {
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'split-line',
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, {
          yPercent: 110,
          duration: 0.9,
          ease: 'expo.out',
          stagger: 0.08,
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        }),
    });
  }
}

/**
 * Fil de loc piloté par ScrollTrigger ([data-animate="gsap"]) : il se dessine à mesure
 * que sa zone défile (stroke-dashoffset via --loc-progress).
 * @param {ParentNode} [root]
 */
export function drawThreads(root = document) {
  for (const svg of /** @type {NodeListOf<SVGSVGElement>} */ (
    root.querySelectorAll('.loc-thread[data-animate="gsap"]')
  )) {
    ScrollTrigger.create({
      trigger: svg.closest('[data-thread-scope]') ?? svg,
      start: 'top 75%',
      end: 'bottom 60%',
      scrub: 0.6,
      onUpdate: (self) => svg.style.setProperty('--loc-progress', self.progress.toFixed(4)),
    });
  }
}

/**
 * Léger parallax des visuels dans les arches ([data-parallax="8"] = ±8 %).
 * @param {ParentNode} [root]
 */
export function parallax(root = document) {
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (
    root.querySelectorAll('[data-parallax]')
  )) {
    const amount = Number(el.dataset.parallax) || 8;
    gsap.fromTo(
      el,
      { yPercent: -amount },
      {
        yPercent: amount,
        ease: 'none',
        scrollTrigger: {
          trigger: el.parentElement,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
        },
      },
    );
  }
}
