// @ts-check
/**
 * Bandeau défilant : l'animation ne tourne que lorsqu'il est visible à l'écran.
 * Mesuré : une animation infinie sous un masque coûte du temps de rendu à chaque image ;
 * la mettre en pause hors écran libère le thread principal (TBT) et la batterie.
 */
export function initMarquees() {
  const marquees = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.marquee'));
  if (!marquees.length || !('IntersectionObserver' in window)) {
    marquees.forEach((m) => (m.dataset.playing = 'true'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      /** @type {HTMLElement} */ (entry.target).dataset.playing = String(entry.isIntersecting);
    }
  });
  marquees.forEach((m) => observer.observe(m));
}
