// @ts-check
/** Comportements partagés par toutes les pages publiques. */
import { initThemeToggle } from './components/theme-toggle.js';
import { initHeader } from './components/header.js';
import { initMobileMenu } from './components/mobile-menu.js';
import { initReveal, initLocThreads } from './components/reveal.js';

export function initCommon() {
  initThemeToggle();
  initHeader();
  initMobileMenu();
  initReveal();
  initLocThreads();
}
