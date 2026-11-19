// @ts-check
import { expect, test } from '@playwright/test';

test.describe('styleguide', () => {
  test('se charge sans erreur console ni débordement horizontal', async ({ page }) => {
    const errors = /** @type {string[]} */ ([]);
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/styleguide');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Le style de');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('bascule clair / sombre et mémorise le choix', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/styleguide');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Basculer clair / sombre' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });

  test("le lien d'évitement apparaît au premier Tab", async ({ page }) => {
    await page.goto('/styleguide');
    const skip = page.getByRole('link', { name: 'Aller au contenu' });
    expect((await skip.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    expect((await skip.boundingBox())?.width ?? 0).toBeGreaterThan(40);
  });

  test('les champs en erreur sont reliés à leur message', async ({ page }) => {
    await page.goto('/styleguide');
    const email = page.locator('#sg-email');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAccessibleDescription(/Il manque la fin de l’adresse/);
  });
});

test.describe('menu mobile', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, 'menu réservé au mobile');

  test("s'ouvre, piège le focus et se ferme avec Échap", async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('[data-menu-toggle]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const menu = page.locator('#menu-mobile');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: /Prestations/ })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(menu).toBeHidden();
  });
});
