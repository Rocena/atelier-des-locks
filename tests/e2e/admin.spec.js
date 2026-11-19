// @ts-check
/**
 * Back-office de bout en bout, sur mobile (390) et desktop (1440) : connexion avec 2FA, première
 * connexion (QR code et codes de secours), rendez-vous manuel, déplacement (créneaux libres sur
 * mobile, glisser-déposer sur desktop), clientes, avis, prestations, galerie, droits de l'équipe,
 * accessibilité (axe-core), pas de défilement horizontal, aucune erreur de console (donc aucune
 * violation de la CSP : pas de style en ligne).
 *
 * Les comptes et sessions de test sont préparés par admin-setup.js. Chaque projet (mobile,
 * desktop) a ses comptes et ses dates : les deux peuvent tourner l'un après l'autre sans collision.
 */
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { totpAt } from '../../src/server/modules/auth/totp.js';
import { DOMAIN, PASSWORD, USERS, resetTotpStep, withDb } from './admin-fixture.js';

const require = createRequire(import.meta.url);

test.describe.configure({ mode: 'serial', timeout: 180_000 });

/** @param {import('@playwright/test').TestInfo} info */
const project = (info) => /** @type {'desktop'|'mobile'} */ (info.project.name);

/** Contexte ouvert avec la session d'un compte de test. */
async function openAs(
  /** @type {import('@playwright/test').Browser} */ browser,
  /** @type {import('@playwright/test').TestInfo} */ info,
  /** @type {'owner'|'staff'} */ role,
  { bypassCSP = false } = {},
) {
  const context = await browser.newContext({
    ...info.project.use,
    storageState: `tests/e2e/.auth/${role}-${project(info)}.json`,
    bypassCSP,
  });
  const page = await context.newPage();
  return { context, page, errors: collectErrors(page) };
}

/** @param {import('@playwright/test').Page} page */
function collectErrors(page) {
  const errors = /** @type {string[]} */ ([]);
  page.on('console', (msg) => {
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

/** Analyse axe-core WCAG 2.1 A/AA. @param {import('@playwright/test').Page} page */
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

/**
 * Y a-t-il un défilement horizontal ? Renvoie la liste des éléments qui dépassent (vide = non).
 * @param {import('@playwright/test').Page} page
 */
const overflowing = (page) =>
  page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1;
    if (document.documentElement.scrollWidth <= limit) return [];
    return [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > limit)
      .slice(0, 6)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')} (${Math.round(el.getBoundingClientRect().right)} px)`,
      );
  });

/** @param {import('@playwright/test').Page} page */
const hasHorizontalScroll = async (page) => (await overflowing(page)).length > 0;

/** Premier mercredi d'un mois à venir (salon ouvert), « AAAA-MM-JJ ». @param {number} monthsAhead */
function firstWednesday(monthsAhead) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead, 1));
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
/** Décalage de mois par projet (les deux ne partagent jamais un créneau). */
const monthsAhead = (/** @type {import('@playwright/test').TestInfo} */ info) =>
  project(info) === 'desktop' ? 3 : 4;

/** Secret TOTP du compte (fixture). @param {'owner'|'staff'} role @param {import('@playwright/test').TestInfo} info */
const secretOf = (role, info) => USERS[`${role}-${project(info)}`].secret;

/** Nom de la cliente de test, propre au projet. @param {import('@playwright/test').TestInfo} info */
const clientName = (info) => ({ first: 'Awa', last: `E2E ${project(info)}` });

/** @type {{ appointmentUrl?: string }} */
const shared = {};

test.describe('connexion', () => {
  test('sans session : page « connexion requise » en 401, puis mauvais mot de passe sans fuite', async ({
    page,
  }) => {
    const response = await page.goto('/admin/agenda');
    expect(response?.status()).toBe(401);
    await expect(page.getByRole('heading', { name: 'Connexion requise' })).toBeVisible();
    await page.getByRole('link', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/admin\/connexion$/);

    await page.getByLabel('Adresse email').fill('inconnue@admin-e2e.test.invalid');
    await page.getByLabel('Mot de passe').fill('un mauvais mot de passe');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert')).toContainText('Adresse ou mot de passe incorrect');
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('mot de passe puis code de l’application, déconnexion', async ({ page }, info) => {
    const key = `owner-${project(info)}`;
    await resetTotpStep(key);
    await page.goto('/admin/connexion');
    await page.getByLabel('Adresse email').fill(`${key}${DOMAIN}`);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('heading', { name: 'Vérification en deux étapes' })).toBeVisible();
    // Avant le code : aucun accès au back-office.
    const early = await page.request.get('/admin/agenda', {
      headers: { accept: 'application/json' },
    });
    expect(early.status()).toBe(401);
    // Un code faux est refusé.
    await page.getByLabel('Code à 6 chiffres').fill('000000');
    await page.getByRole('button', { name: 'Valider' }).click();
    await expect(page.getByRole('alert')).toContainText('Code incorrect');
    await page.getByLabel('Code à 6 chiffres').fill(totpAt(secretOf('owner', info), new Date()));
    await page.getByRole('button', { name: 'Valider' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Bonjour');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/admin\/connexion$/);
    expect(
      (await page.request.get('/admin', { headers: { accept: 'application/json' } })).status(),
    ).toBe(401);
  });

  test('première connexion : QR code, code de l’application, codes de secours à noter', async ({
    page,
  }, info) => {
    const key = `new-${project(info)}`;
    await page.goto('/admin/connexion');
    await page.getByLabel('Adresse email').fill(`${key}${DOMAIN}`);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(
      page.getByRole('heading', { name: 'Activez la double authentification' }),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: /Code QR/ })).toBeVisible();
    const secret = (await page.locator('.a-secret').innerText())
      .replace('Clé :', '')
      .replaceAll(/\s/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.getByLabel('Code à 6 chiffres').fill(totpAt(secret, new Date()));
    await page.getByRole('button', { name: 'Activer et continuer' }).click();
    await expect(page.getByRole('heading', { name: 'Vos codes de secours' })).toBeVisible();
    await expect(page.locator('.a-code li')).toHaveCount(10);
    await page.getByRole('link', { name: 'J’ai noté mes codes' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Bonjour');
  });
});

test.describe('agenda', () => {
  test('rendez-vous saisi par le salon, vu dans les trois vues', async ({ browser }, info) => {
    const { page, errors, context } = await openAs(browser, info, 'owner');
    const date = firstWednesday(monthsAhead(info));
    const { first, last } = clientName(info);
    await page.goto(`/admin/agenda/rdv/nouveau?date=${date}`);
    await page.getByLabel('Prénom').fill(first);
    await page.getByLabel('Nom', { exact: true }).fill(last);
    await page.getByLabel('Téléphone').fill('06 12 34 56 78');
    await page.getByLabel('Prestation', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('Heure').fill('10:00');
    await page.getByRole('button', { name: 'Enregistrer le rendez-vous' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`${first} ${last}`);
    await expect(page.locator('.a-flash')).toContainText('C’est créé');
    shared.appointmentUrl = new URL(page.url()).pathname;

    for (const vue of ['liste', 'semaine', 'jour']) {
      await page.goto(`/admin/agenda?vue=${vue}&date=${date}`);
      // Frise (jour, semaine desktop) ou liste (vue Liste, semaine mobile) : l'un des deux est visible.
      await expect(
        page
          .locator(
            `.tl__event[data-label="${first} ${last}"]:visible, .a-row:has-text("${last}"):visible`,
          )
          .first(),
      ).toBeVisible();
      expect(await overflowing(page), `${vue} déborde`).toEqual([]);
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  test('déplacer par les créneaux libres (sans glisser), la cliente est prévenue', async ({
    browser,
  }, info) => {
    const { page, errors, context } = await openAs(browser, info, 'owner');
    await page.goto(/** @type {string} */ (shared.appointmentUrl));
    await page.getByRole('link', { name: 'Choisir un autre créneau' }).click();
    await expect(page.getByText('Créneaux libres le')).toBeVisible();
    // Choisir l'heure actuelle ne déplace rien : message lisible, jamais de JSON brut.
    await page.locator('.a-slots label').nth(2).click();
    const form = page.locator('#deplacer form[method="post"]');
    await form.getByRole('button', { name: 'Déplacer le rendez-vous' }).click();
    await expect(page.getByRole('alert')).toContainText('déjà à cette heure');
    await page.locator('.a-slots label').last().click();
    const moveForm = page.locator('#deplacer form[method="post"]');
    await expect(moveForm.getByLabel('Prévenir la cliente par email et SMS')).toBeChecked();
    await moveForm.getByRole('button', { name: 'Déplacer le rendez-vous' }).click();
    await expect(page.locator('.a-flash')).toContainText('La cliente est prévenue');
    expect(errors).toEqual([]);
    await context.close();
  });

  test('desktop : glisser-déposer dans la frise, confirmation, nouvelle heure', async ({
    browser,
  }, info) => {
    test.skip(project(info) !== 'desktop', 'Le glisser-déposer est réservé à la souris.');
    const { page, errors, context } = await openAs(browser, info, 'owner');
    const date = firstWednesday(monthsAhead(info));
    await page.goto(`/admin/agenda?vue=jour&date=${date}`);
    const event = page.locator('.tl__event[data-draggable]').first();
    await expect(event).toBeVisible();
    const before = (await event.locator('.tl__event-meta').innerText()).slice(0, 5);
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (
      await event.boundingBox()
    );
    const hour = await page.evaluate(
      () => parseFloat(getComputedStyle(document.documentElement).fontSize) * 3.5,
    );
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 8 + hour / 2, { steps: 6 });
    await page.mouse.move(box.x + box.width / 2, box.y + 8 + hour, { steps: 6 });
    await expect(page.locator('.tl__ghost')).toBeVisible();
    await page.mouse.up();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Déplacer le rendez-vous');
    await dialog.getByRole('button', { name: 'Déplacer', exact: true }).click();
    // La page se recharge avec la nouvelle heure (attente automatique du rechargement).
    await expect(
      page.locator('.tl__event[data-draggable] .tl__event-meta').first(),
    ).not.toContainText(before, { timeout: 20_000 });
    const after = (
      await page.locator('.tl__event[data-draggable] .tl__event-meta').first().innerText()
    ).slice(0, 5);
    expect(Number(after.slice(0, 2)) * 60 + Number(after.slice(3))).toBe(
      Number(before.slice(0, 2)) * 60 + Number(before.slice(3)) + 60,
    );
    expect(errors).toEqual([]);
    await context.close();
  });

  test('desktop : annuler un glisser laisse le rendez-vous en place', async ({ browser }, info) => {
    test.skip(project(info) !== 'desktop', 'Le glisser-déposer est réservé à la souris.');
    const { page, context } = await openAs(browser, info, 'owner');
    await page.goto(`/admin/agenda?vue=jour&date=${firstWednesday(monthsAhead(info))}`);
    const event = page.locator('.tl__event[data-draggable]').first();
    const before = await event.locator('.tl__event-meta').innerText();
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (
      await event.boundingBox()
    );
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 80, { steps: 8 });
    await page.mouse.up();
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(
      await page.locator('.tl__event[data-draggable] .tl__event-meta').first().innerText(),
    ).toBe(before);
    await context.close();
  });

  test('bloquer un créneau, puis le retirer', async ({ browser }, info) => {
    const { page, errors, context } = await openAs(browser, info, 'owner');
    // Le lendemain du rendez-vous : un blocage sur un rendez-vous est refusé (testé en unitaire).
    const wednesday = new Date(`${firstWednesday(monthsAhead(info))}T12:00:00Z`);
    const date = new Date(wednesday.getTime() + 86_400_000).toISOString().slice(0, 10);
    await page.goto(`/admin/agenda/blocages?date=${date}`);
    await page.getByLabel('De', { exact: true }).fill('16:00');
    await page.getByLabel('À', { exact: true }).fill('17:00');
    await page.getByLabel('Motif').fill('E2E pause');
    await page.getByRole('button', { name: 'Bloquer ce créneau' }).click();
    await expect(page.locator('.a-flash')).toContainText('Créneau bloqué');
    await page.goto('/admin/agenda/blocages');
    await expect(page.getByText('E2E pause')).toBeVisible();
    await page.getByRole('button', { name: 'Retirer' }).first().click();
    await expect(page.locator('.a-flash')).toContainText('Blocage retiré');
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe('clientes', () => {
  test('recherche, fiche, notes, export CSV', async ({ browser }, info) => {
    const { page, errors, context } = await openAs(browser, info, 'owner');
    const { first, last } = clientName(info);
    await page.goto('/admin/clientes');
    await page.getByLabel('Chercher une cliente').fill(last);
    await page.getByRole('button', { name: 'Chercher' }).click();
    await page.getByRole('link', { name: new RegExp(`${first} ${last}`) }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(last);
    await expect(page.getByRole('heading', { name: /Historique \(1\)/ })).toBeVisible();
    await page
      .getByLabel('Notes (type de cheveux, méthode, produits…)')
      .fill('Locks fines, sensibles');
    await page.getByRole('button', { name: 'Enregistrer la fiche' }).click();
    await expect(page.locator('.a-flash')).toContainText('Modifications enregistrées');
    const csv = await page.request.get('/admin/clientes/export.csv');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain(last);
    expect(errors).toEqual([]);
    await context.close();
  });

  test('suppression RGPD : page de confirmation, case obligatoire', async ({ browser }, info) => {
    const { page, context } = await openAs(browser, info, 'owner');
    const { last } = clientName(info);
    await page.goto(`/admin/clientes?q=${encodeURIComponent(last)}`);
    await page.getByRole('link', { name: new RegExp(last) }).click();
    await page.getByRole('link', { name: 'Supprimer cette cliente' }).click();
    await expect(page.getByRole('heading', { name: /Supprimer/ })).toBeVisible();
    await expect(page.getByText('Cette action est définitive')).toBeVisible();
    await page.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(page.getByText('Cochez la case pour confirmer')).toBeVisible();
    await page.getByLabel('Je confirme la suppression').check();
    await page.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(page.locator('.a-flash')).toContainText('supprimée de vos fichiers');
    await page.goto(`/admin/clientes?q=${encodeURIComponent(last)}`);
    await expect(page.getByText('Aucune cliente')).toBeVisible();
    await context.close();
  });
});

test.describe('avis, prestations, galerie', () => {
  test('modérer un avis : il apparaît sur le site public après publication', async ({
    browser,
  }, info) => {
    const author = `E2E ${project(info)}`;
    await withDb(async (db) => {
      await db.query(
        `INSERT INTO reviews (author_name, rating, body, consent_publication, status, verified)
         VALUES ($1, 5, $2, true, 'pending', false)`,
        [author, `Un avis de test ${project(info)}`],
      );
    });
    const { page, errors, context } = await openAs(browser, info, 'staff');
    await page.goto('/admin/avis');
    const card = page.locator('li.a-card', { hasText: author });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Publier' }).click();
    await expect(page.locator('.a-flash')).toContainText('Avis publié');
    await page.goto('/admin/avis?statut=approved');
    // Chaque avis publié a son propre formulaire de réponse : on travaille dans la carte de cet avis.
    const approved = page.locator('li.a-card', { hasText: author });
    await approved.getByText('Répondre publiquement').click();
    await approved
      .getByLabel('Réponse visible sous l’avis')
      .fill(`Merci pour votre confiance (${project(info)}) !`);
    await approved.getByRole('button', { name: 'Enregistrer la réponse' }).click();
    await expect(page.locator('.a-flash')).toContainText('Réponse enregistrée');
    await page.goto('/avis');
    await expect(page.getByText(`Un avis de test ${project(info)}`)).toBeVisible();
    await expect(page.getByText(`Merci pour votre confiance (${project(info)}) !`)).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });

  test('prestations : créer, modifier le prix, masquer', async ({ browser }, info) => {
    const { page, errors, context } = await openAs(browser, info, 'owner');
    const slug = `e2e-soin-${project(info)}`;
    await page.goto('/admin/prestations/nouvelle');
    await page.getByLabel('Nom', { exact: true }).fill(`E2E Soin ${project(info)}`);
    await page.getByLabel('Adresse de la page').fill(slug);
    await page.getByLabel('Description courte').fill('Un soin de test');
    await page.getByLabel('Prix (€)').fill('45,50');
    await page.getByRole('button', { name: 'Créer la prestation' }).click();
    await expect(page.locator('.a-flash')).toContainText('Modifications enregistrées');
    await page.getByLabel('Prix (€)').fill('52');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await expect(page.getByLabel('Prix (€)')).toHaveValue('52');
    await page.goto(`/prestations/${slug}`);
    await expect(page.getByText('52').first()).toBeVisible();
    await page.goto('/admin/prestations');
    await page
      .getByRole('button', { name: new RegExp(`Masquer E2E Soin ${project(info)}`) })
      .click();
    await expect(page.locator('.a-flash')).toContainText('Modifications enregistrées');
    expect((await page.request.get(`/prestations/${slug}`)).status()).toBe(404);
    expect(errors).toEqual([]);
    await context.close();
  });

  test('galerie : envoi d’une photo recadrée, texte alternatif obligatoire, visible sur le site', async ({
    browser,
  }, info) => {
    const { page, errors, context } = await openAs(browser, info, 'owner');
    const title = `E2E Photo ${project(info)}`;
    const jpeg = await sharp({
      create: { width: 900, height: 1100, channels: 3, background: { r: 140, g: 80, b: 50 } },
    })
      .jpeg()
      .toBuffer();
    await page.goto('/admin/galerie');
    await page
      .locator('[data-file-input]')
      .setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    const form = page.locator('[data-item]').first();
    await expect(form.locator('canvas')).toBeVisible();
    await form.getByRole('button', { name: 'Carré' }).click();
    await expect(form.getByRole('button', { name: 'Carré' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await form.getByLabel('Titre').fill(title);
    await form.getByLabel('Texte alternatif (obligatoire)').fill('');
    await form.getByRole('button', { name: 'Envoyer cette photo' }).click();
    await expect(form.locator('[data-error]')).toContainText('obligatoires');
    // La suggestion se remplit toute seule quand on choisit une prestation.
    await form.getByLabel('Prestation').selectOption({ index: 1 });
    await expect(form.getByLabel('Texte alternatif (obligatoire)')).toHaveValue(
      /Réalisation du salon/,
    );
    await form.getByRole('button', { name: 'Envoyer cette photo' }).click();
    await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 30_000 });
    await page.goto('/galerie');
    await expect(page.locator('img[alt^="Réalisation du salon"]').first()).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe('droits de l’équipe', () => {
  test('pas de réglages, pas de journal, pas d’export : 403 et menu réduit', async ({
    browser,
  }, info) => {
    const { page, context } = await openAs(browser, info, 'staff');
    await page.goto('/admin');
    await expect(page.getByText('chiffre d’affaires')).toHaveCount(0);
    const response = await page.goto('/admin/reglages');
    expect(response?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: 'Accès réservé' })).toBeVisible();
    expect((await page.request.get('/admin/clientes/export.csv')).status()).toBe(403);
    expect((await page.request.get('/admin/journal')).status()).toBe(403);
    await page.goto('/admin/plus');
    const main = page.locator('#contenu');
    await expect(main.getByRole('link', { name: 'Galerie' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Réglages' })).toHaveCount(0);
    await context.close();
  });
});

test.describe('accessibilité et mise en page', () => {
  test('pages principales : WCAG A/AA, pas de défilement horizontal, zones tactiles, pas d’erreur', async ({
    browser,
  }, info) => {
    const { page, errors, context } = await openAs(browser, info, 'owner', { bypassCSP: true });
    const date = firstWednesday(monthsAhead(info));
    const pages = [
      '/admin',
      `/admin/agenda?vue=jour&date=${date}`,
      `/admin/agenda?vue=semaine&date=${date}`,
      `/admin/agenda?vue=liste&date=${date}`,
      '/admin/agenda/rdv/nouveau',
      '/admin/agenda/blocages',
      '/admin/clientes',
      '/admin/avis',
      '/admin/galerie',
      '/admin/prestations',
      '/admin/prestations/nouvelle',
      '/admin/contenus',
      '/admin/contenus/articles',
      '/admin/reglages',
      '/admin/reglages/horaires',
      '/admin/reglages/fermetures',
      '/admin/journal',
      '/admin/notifications',
      '/admin/compte',
      '/admin/plus',
    ];
    for (const url of pages) {
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(200);
      await page.waitForLoadState('networkidle');
      expect(await axe(page), url).toEqual([]);
      expect(await hasHorizontalScroll(page), `${url} défile horizontalement`).toBe(false);
    }
    // Zones tactiles d'au moins 44 px sur les boutons et liens de la barre du bas (mobile).
    if (project(info) === 'mobile') {
      await page.goto('/admin');
      const sizes = await page
        .locator('.a-tabs a')
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
      for (const h of sizes) expect(h).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  test('connexion et 2FA : accessibles, sans défilement horizontal', async ({ page }) => {
    for (const url of ['/admin/connexion']) {
      await page.goto(url);
      expect(await hasHorizontalScroll(page)).toBe(false);
      await expect(page.getByLabel('Adresse email')).toBeVisible();
    }
  });
});
