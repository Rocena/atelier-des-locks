// @ts-check
import { expect, test } from '@playwright/test';

const PAGES = [
  '/',
  '/le-salon',
  '/prestations',
  '/prestations/creation-locks',
  '/methodes',
  '/galerie',
  '/tarifs',
  '/avis',
  '/reserver',
  '/conseils',
  '/conseils/laver-ses-locks',
  '/contact',
  '/faq',
  '/mentions-legales',
];

test.describe('pages publiques', () => {
  for (const url of PAGES) {
    test(`${url} : sans erreur console ni défilement horizontal`, async ({ page }) => {
      const errors = /** @type {string[]} */ ([]);
      page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Fait défiler jusqu'en bas (déclenche le chargement de GSAP / Lenis)
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('méga-menu (desktop)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'desktop uniquement');

  test('s’ouvre au clavier et se ferme avec Échap', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('[data-mega-toggle]');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator('#mega-prestations');
    await expect(panel.getByRole('link', { name: 'Bain détox' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });
});

test.describe('barre Réserver (mobile)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, 'mobile uniquement');

  test('apparaît après le premier écran', async ({ page }) => {
    await page.goto('/prestations');
    const bar = page.locator('[data-book-bar]');
    await expect(bar).toHaveAttribute('data-visible', 'false');
    await page.evaluate(() => window.scrollTo(0, window.innerHeight));
    await expect(bar).toHaveAttribute('data-visible', 'true');
    await expect(bar.getByRole('link', { name: 'Réserver' })).toBeVisible();
  });
});

test.describe('galerie', () => {
  test('filtre sans recharger et annonce le nombre de résultats', async ({ page }) => {
    await page.goto('/galerie');
    const visible = page.locator('[data-gallery-item]:not([hidden])');
    const total = await visible.count();
    await page.getByLabel('Prestation').selectOption('coiffure');
    await expect(page.locator('[data-gallery-count]')).toContainText('réalisation');
    const filtered = await visible.count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(total);
    await expect(page).toHaveURL(/categorie=coiffure/);
  });

  test('ouvre la lightbox et la ferme avec Échap', async ({ page }) => {
    await page.goto('/galerie');
    await page.locator('[data-lightbox-item]').first().click();
    const dialog = page.locator('[data-lightbox]');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.locator('[data-lightbox-counter]')).toHaveText(/^2 \//);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test.describe('mouvement réduit', () => {
  test.use({ reducedMotion: 'reduce' });

  test('pas de loader, fil de loc affiché entier, aucun défilement doux', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveClass(/has-intro/);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(400);
    await expect(page.locator('html')).not.toHaveClass(/lenis/);
    const progress = await page
      .locator('.manifesto__thread')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--loc-progress').trim());
    expect(progress).toBe('1');
  });
});
