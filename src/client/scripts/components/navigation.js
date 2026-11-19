// @ts-check
/**
 * Navigation : méga-menu « Prestations » (desktop), bandeau d'annonce masquable,
 * barre « Réserver » collante (mobile, apparaît après le premier écran).
 */

/** Méga-menu : ouverture au survol (avec délai d'intention) ou au clic sur le chevron. */
function initMegaMenu() {
  const item = /** @type {HTMLElement | null} */ (document.querySelector('[data-mega]'));
  const toggle = /** @type {HTMLButtonElement | null | undefined} */ (
    item?.querySelector('[data-mega-toggle]')
  );
  const panel = /** @type {HTMLElement | null | undefined} */ (
    item?.querySelector('[data-mega-panel]')
  );
  if (!item || !toggle || !panel) return;
  const header = /** @type {HTMLElement | null} */ (document.querySelector('[data-site-header]'));
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');
  /** @type {number | undefined} */ let timer;
  /** @type {number | undefined} */ let hideTimer;

  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  const open = () => {
    window.clearTimeout(hideTimer);
    panel.hidden = false;
    requestAnimationFrame(() => (panel.dataset.open = 'true'));
    toggle.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    if (!isOpen()) return;
    panel.dataset.open = 'false';
    toggle.setAttribute('aria-expanded', 'false');
    hideTimer = window.setTimeout(() => (panel.hidden = true), 200);
  };

  toggle.addEventListener('click', () => (isOpen() ? close() : open()));
  item.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' || !canHover.matches) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(open, 120);
  });
  item.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(timer);
    timer = window.setTimeout(close, 180);
  });
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      close();
      toggle.focus();
    }
  });
  item.addEventListener('focusout', (e) => {
    const next = /** @type {Node | null} */ (e.relatedTarget);
    if (next && !item.contains(next)) close();
  });
  // Le header se masque au scroll vers le bas : le panneau se ferme avec lui.
  if (header) {
    new MutationObserver(() => {
      if (header.dataset.hidden === 'true') close();
    }).observe(header, { attributes: true, attributeFilter: ['data-hidden'] });
  }
}

/** Bandeau d'annonce : la fermeture est mémorisée pour cette annonce (son id). */
function initAnnouncement() {
  const button = document.querySelector('[data-announce-close]');
  button?.addEventListener('click', () => {
    const root = document.documentElement;
    root.classList.add('announce-closed');
    try {
      localStorage.setItem('adl-announce', root.dataset.announce ?? '');
    } catch {
      // Stockage indisponible : le bandeau reviendra à la page suivante.
    }
    /** @type {HTMLElement | null} */ (document.querySelector('#contenu'))?.focus({
      preventScroll: true,
    });
  });
}

/** Barre « Réserver » : visible après 60 % du premier écran, masquée en bas de page. */
function initBookBar() {
  const bar = /** @type {HTMLElement | null} */ (document.querySelector('[data-book-bar]'));
  if (!bar) return;
  const legal = document.querySelector('.site-footer__legal');
  let nearEnd = false;
  let ticking = false;
  const update = () => {
    bar.dataset.visible = String(window.scrollY > window.innerHeight * 0.6 && !nearEnd);
    ticking = false;
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  if (legal && 'IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      nearEnd = entry.isIntersecting;
      update();
    }).observe(legal);
  }
  update();
}

export function initNavigation() {
  initMegaMenu();
  initAnnouncement();
  initBookBar();
}
