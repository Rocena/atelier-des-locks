// @ts-check
/**
 * Bascule clair / sombre. Le thème initial est posé avant le rendu par un script inline
 * (layouts/base.eta) ; ici on gère le clic et la mémorisation.
 */
const STORAGE_KEY = 'adl-theme';

/**
 * Met à jour l'état des boutons. Le libellé n'est changé que sur les boutons icônes
 * (ceux qui portent un aria-label) : un bouton avec texte visible garde son texte.
 * @param {'light'|'dark'} theme
 */
function syncButtons(theme) {
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    if (button.hasAttribute('aria-label')) {
      button.setAttribute(
        'aria-label',
        theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre',
      );
    }
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}

/** @param {'light'|'dark'} theme */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  syncButtons(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Stockage indisponible (navigation privée) : le thème vaut pour cette page seulement.
  }
}

export function initThemeToggle() {
  const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  syncButtons(current);
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    button.addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
  }
}
