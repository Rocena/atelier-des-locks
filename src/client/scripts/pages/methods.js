// @ts-check
import { initCommon, showThreadsStatic, withMotion } from '../common.js';

initCommon();

/** Sommaire : la section en cours de lecture est signalée (aria-current). */
function initTocSpy() {
  const links = /** @type {HTMLAnchorElement[]} */ ([
    ...document.querySelectorAll('.guide__toc a[href^="#"]'),
  ]);
  const targets = links
    .map((a) => document.getElementById(a.hash.slice(1)))
    .filter((el) => el !== null);
  if (!targets.length || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const a of links) {
          if (a.hash === `#${entry.target.id}`) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        }
      }
    },
    { rootMargin: '-30% 0px -60% 0px' },
  );
  targets.forEach((t) => observer.observe(t));
}

initTocSpy();
withMotion((motion) => {
  motion.splitTitles();
  motion.drawThreads();
  motion.parallax();
}, showThreadsStatic);
