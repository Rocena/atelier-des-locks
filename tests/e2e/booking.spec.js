// @ts-check
/**
 * Tunnel de réservation /reserver et « Gérer mon RDV », sur mobile (390) et desktop (1440).
 * Les tests réservent de vrais créneaux dans la base de développement (nettoyée par cleanup.js).
 * Pour que les projets mobile et desktop, exécutés en parallèle, ne visent jamais le même
 * créneau, chacun réserve dans un mois différent.
 */
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const require = createRequire(import.meta.url);

// Parcours longs (serveur de dev, preuve de travail anti-robot) : marge confortable.
test.describe.configure({ timeout: 240_000 });

/** Décalage en mois propre à chaque projet (évite les collisions entre tests parallèles). */
const monthOffset = (/** @type {string} */ project) => (project === 'desktop' ? 1 : 2);

/** @param {import('@playwright/test').Page} page */
function collectErrors(page) {
  const errors = /** @type {string[]} */ ([]);
  page.on('console', (msg) => {
    // Le client Vite (HMR) peut se plaindre d'un websocket en e2e : sans rapport avec la page.
    if (
      msg.type() === 'error' &&
      !/vite|WebSocket|ViewTransition|Transition was/i.test(msg.text())
    ) {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    if (!/Transition was/i.test(err.message)) errors.push(err.message);
  });
  return errors;
}

/** @param {import('@playwright/test').Page} page */
async function waitCalendar(page) {
  // Large délai : au démarrage à froid, le serveur de dev transforme tous les modules (Vite)
  // pour plusieurs navigateurs à la fois ; sur un disque lent (OneDrive), les premières
  // réponses de l'API peuvent prendre près d'une minute. Ensuite, elles prennent < 1 s.
  await expect(page.locator('[data-calendar-body]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 90_000,
  });
}

/**
 * Étapes 1 et 2 : prestation, puis le premier jour disponible du mois visé, puis le k-ième horaire.
 * @param {import('@playwright/test').Page} page
 * @param {{ service: string, months: number, slotIndex?: number }} opts
 */
async function pickServiceAndSlot(page, { service, months, slotIndex = 0 }) {
  await page.goto('/reserver');
  await page.locator(`input[name="service"][value="${service}"]`).check();
  await page.getByRole('button', { name: 'Choisir un créneau' }).click();
  await expect(page.getByRole('heading', { name: /Choisissez votre créneau/ })).toBeFocused({
    timeout: 15_000,
  });
  await waitCalendar(page);
  for (let i = 0; i < months; i++) {
    await page.locator('[data-month-next]').click();
    await waitCalendar(page);
  }
  const slots = page.locator('input[name="startsAt"]');
  await expect(slots.first()).toBeAttached();
  const slot = slots.nth(slotIndex);
  const value = /** @type {string} */ (await slot.getAttribute('value'));
  await slot.check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: /Faisons connaissance/ })).toBeFocused({
    timeout: 15_000,
  });
  return value;
}

/**
 * Étape 3 : coordonnées valides.
 * @param {import('@playwright/test').Page} page
 * @param {string} email
 */
async function fillDetails(page, email) {
  await page.getByLabel('Prénom').fill('Aminata');
  await page.getByLabel('Nom', { exact: true }).fill('Test');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Téléphone').fill('06 12 34 56 78');
  await page.getByLabel('État actuel de vos cheveux').selectOption('mature_locks');
  await page.getByLabel('J’accepte la politique de rendez-vous.').check();
}

/** Analyse axe-core (WCAG 2.1 A/AA) de la page courante. @param {import('@playwright/test').Page} page */
async function axe(page) {
  await page.addScriptTag({ path: require.resolve('axe-core') });
  return page.evaluate(async () => {
    // @ts-expect-error axe est injecté dans la page
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return result.violations.map(
      (/** @type {any} */ v) =>
        `${v.id}: ${v.nodes.map((/** @type {any} */ n) => n.target).join(', ')}`,
    );
  });
}

test.describe('tunnel de réservation', () => {
  test('parcours complet : prestation, créneau, coordonnées et photo, confirmation, gestion', async ({
    page,
  }, testInfo) => {
    const errors = collectErrors(page);
    const email = `parcours-${testInfo.project.name}@e2e.test.invalid`;
    await pickServiceAndSlot(page, {
      service: 'bain-detox',
      months: monthOffset(testInfo.project.name),
    });

    // Récapitulatif mis à jour en direct.
    await expect(page.locator('[data-sum-price]')).toHaveText('45 €');
    await expect(page.locator('[data-sum-date]')).not.toHaveText('À choisir');

    await fillDetails(page, email);
    const photo = await sharp({
      create: { width: 120, height: 90, channels: 3, background: '#7a4a2b' },
    })
      .png()
      .toBuffer();
    await page
      .locator('#resa-photo')
      .setInputFiles({ name: 'cheveux.png', mimeType: 'image/png', buffer: photo });
    await expect(page.locator('[data-photo-preview]')).toBeVisible();
    await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click();

    // Étape 4.
    await expect(page.getByRole('heading', { name: /C’est noté, Aminata/ })).toBeFocused({
      timeout: 20_000,
    });
    await expect(page.locator('[data-progress-item="4"]')).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('[data-done-tips] li')).toHaveCount(4);
    const ics = page.getByRole('link', { name: 'Ajouter à mon agenda (.ics)' });
    await expect(ics).toHaveAttribute('href', /^\/rdv\/[A-Za-z0-9_-]{43}\/rdv\.ics$/);
    await expect(page.getByRole('link', { name: /Google Agenda/ })).toHaveAttribute(
      'href',
      /^https:\/\/calendar\.google\.com\//,
    );
    // Le bouton retour du navigateur ne ramène pas dans le formulaire envoyé.
    await page.goBack();
    await expect(page.locator('[data-step="4"]')).toBeVisible();

    // Gérer mon RDV.
    const manage = /** @type {string} */ (
      await page.getByRole('link', { name: 'Gérer mon rendez-vous' }).first().getAttribute('href')
    );
    await page.goto(manage);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Aminata');
    await expect(page.getByText('Confirmé', { exact: true })).toBeVisible();

    // Déplacer : quelques semaines plus loin, pour ne pas croiser l'autre projet.
    await page.getByRole('link', { name: 'Déplacer le rendez-vous' }).click();
    const weeks = testInfo.project.name === 'desktop' ? 3 : 4;
    for (let i = 0; i < weeks; i++)
      await page.getByRole('link', { name: /Semaine suivante/i }).click();
    const target = page.locator('input[name="startsAt"]').last();
    await target.check();
    await page.getByRole('button', { name: 'Déplacer à ce créneau' }).click();
    await expect(page.getByText('Votre rendez-vous a bien été déplacé.')).toBeVisible();

    // Annuler (avec confirmation explicite).
    await page.getByText('Annuler le rendez-vous', { exact: true }).click();
    await page.getByRole('button', { name: 'Oui, annuler mon rendez-vous' }).click();
    await expect(page.getByText('Votre rendez-vous est annulé.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('annulé');
    await expect(page.getByRole('link', { name: 'Déplacer le rendez-vous' })).toHaveCount(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('erreurs de saisie : résumé relié aux champs, puis correction', async ({
    page,
  }, testInfo) => {
    await page.route('**/api/booking/appointments', (route) => route.abort()); // jamais envoyé ici
    await pickServiceAndSlot(page, {
      service: 'bain-detox',
      months: monthOffset(testInfo.project.name),
    });
    await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click();
    const summary = page.locator('[data-form-error]');
    await expect(summary).toBeFocused({ timeout: 15_000 });
    await expect(summary.getByRole('link')).toHaveCount(6);
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
    await summary.getByRole('link', { name: /adresse email/ }).click();
    await expect(page.getByLabel('Email')).toBeFocused({ timeout: 15_000 });
    await page.getByLabel('Email').fill('aminata@exemple.fr');
    await expect(page.getByLabel('Email')).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('créneau pris entre-temps : retour au calendrier avec un message', async ({
    page,
  }, testInfo) => {
    await page.route('**/api/booking/appointments', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'slot_taken',
          message: 'Ce créneau vient d’être pris. Choisissez-en un autre.',
        }),
      }),
    );
    await pickServiceAndSlot(page, {
      service: 'bain-detox',
      months: monthOffset(testInfo.project.name),
    });
    await fillDetails(page, 'pris@e2e.test.invalid');
    await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click();
    await expect(page.getByRole('heading', { name: /Choisissez votre créneau/ })).toBeFocused({
      timeout: 20_000,
    });
    await expect(page.getByRole('alert').filter({ hasText: 'vient d’être pris' })).toBeVisible();
    await expect(page.locator('[data-sum-date]')).toHaveText('À choisir');
  });

  test('états du calendrier : chargement, erreur avec « Réessayer », mois sans créneau', async ({
    page,
  }) => {
    let mode = 'error';
    await page.route('**/api/booking/slots?*', async (route) => {
      if (mode === 'error') return route.fulfill({ status: 500, body: '{}' });
      const url = new URL(route.request().url());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ days: [{ date: url.searchParams.get('from'), slots: [] }] }),
      });
    });
    await page.goto('/reserver');
    await page.locator('input[name="service"][value="bain-detox"]').check();
    await page.getByRole('button', { name: 'Choisir un créneau' }).click();
    const retry = page.getByRole('button', { name: 'Réessayer' });
    await expect(retry).toBeVisible();
    mode = 'empty';
    await retry.click();
    await expect(page.getByText(/Plus aucun créneau disponible en/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Voir / })).toBeVisible();
  });

  test('sans prestation choisie, on ne passe pas à l’étape 2', async ({ page }) => {
    await page.goto('/reserver');
    await page.getByRole('button', { name: 'Choisir un créneau' }).click();
    await expect(page.getByText('Choisissez une prestation pour continuer.')).toBeVisible();
    await expect(page.locator('[data-step="2"]')).toBeHidden();
  });

  test('une prestation sur devis n’est pas réservable en ligne', async ({ page }) => {
    await page.goto('/reserver');
    await expect(
      page.locator('input[name="service"][value="coiffure-mariage-evenement"]'),
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Sur devis : nous écrire/ }).first()).toBeVisible();
  });

  test('lien depuis une prestation : elle est présélectionnée', async ({ page }) => {
    await page.goto('/prestations/bain-detox');
    await page.getByRole('link', { name: 'Réserver cette prestation' }).first().click();
    await expect(page).toHaveURL(/\/reserver\?prestation=bain-detox/);
    await expect(page.locator('input[name="service"][value="bain-detox"]')).toBeChecked();
    await expect(page.locator('[data-sum-service]')).toHaveText('Bain détox');
  });

  test('photo refusée côté navigateur si elle n’est pas une image', async ({ page }, testInfo) => {
    await page.route('**/api/booking/appointments', (route) => route.abort());
    await pickServiceAndSlot(page, {
      service: 'bain-detox',
      months: monthOffset(testInfo.project.name),
    });
    await page.locator('#resa-photo').setInputFiles({
      name: 'script.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4'),
    });
    await expect(page.getByText('La photo doit être au format JPEG, PNG ou WebP.')).toBeVisible();
    await expect(page.locator('[data-photo-preview]')).toBeHidden();
  });
});

test.describe('accessibilité du tunnel', () => {
  test.use({ bypassCSP: true }); // pour injecter axe-core

  test('aucune violation WCAG A/AA aux étapes 1, 2 et 3', async ({ page }, testInfo) => {
    await page.route('**/api/booking/appointments', (route) => route.abort());
    await page.goto('/reserver');
    expect(await axe(page)).toEqual([]);
    await pickServiceAndSlot(page, {
      service: 'bain-detox',
      months: monthOffset(testInfo.project.name),
    });
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: 'Confirmer le rendez-vous' }).click(); // erreurs affichées
    expect(await axe(page)).toEqual([]);
  });

  test('tout le parcours au clavier jusqu’à l’étape 3', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'clavier : desktop');
    await page.goto('/reserver');
    const radio = page.locator('input[name="service"][value="bain-detox"]');
    await radio.focus();
    await page.keyboard.press('Space');
    await expect(radio).toBeChecked();
    await page.getByRole('button', { name: 'Choisir un créneau' }).focus();
    await page.keyboard.press('Enter');
    await waitCalendar(page);
    // Atteindre la grille : le jour tabulable porte tabindex=0.
    await page.locator('[data-calendar-days] [tabindex="0"]').focus();
    await page.keyboard.press('PageDown');
    await waitCalendar(page);
    const focused = await page.evaluate(
      () => /** @type {HTMLElement} */ (document.activeElement).dataset.date,
    );
    expect(focused).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Aller au premier jour disponible du mois et le choisir avec Entrée.
    const firstAvailable = page.locator('[data-calendar-days] .is-available').first();
    await firstAvailable.focus();
    await page.keyboard.press('Enter');
    await expect(firstAvailable).toHaveAttribute('aria-pressed', 'true');
    // Horaires : boutons radio natifs (flèches entre options).
    const slot = page.locator('input[name="startsAt"]').first();
    await slot.focus();
    await page.keyboard.press('Space');
    await expect(slot).toBeChecked();
    await page.getByRole('button', { name: 'Continuer' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /Faisons connaissance/ })).toBeFocused({
      timeout: 15_000,
    });
  });
});

test.describe('gérer mon RDV', () => {
  test('lien invalide : page dédiée, non indexée', async ({ page }) => {
    const res = await page.goto(`/rdv/${'A'.repeat(43)}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('plus valable');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});
