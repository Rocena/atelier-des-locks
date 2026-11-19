// @ts-check
/**
 * Captures du back-office (revue visuelle design-craft §10) : mobile 390 et desktop 1440.
 * Désactivé par défaut : ADMIN_SHOTS=1 npx playwright test tests/e2e/admin-shots.spec.js
 * Écrit dans docs/screenshots/admin-<page>-<projet>-top.png (vues au-dessus de la ligne de flottaison).
 */
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { withDb } from './admin-fixture.js';

test.skip(!process.env.ADMIN_SHOTS, 'Captures sur demande (ADMIN_SHOTS=1).');
test.describe.configure({ timeout: 240_000 });

/** @param {Date} d */
const iso = (d) => d.toISOString().slice(0, 10);

test('captures de l’espace pro', async ({ browser }, info) => {
  const name = info.project.name;
  const context = await browser.newContext({
    ...info.project.use,
    storageState: `tests/e2e/.auth/owner-${name}.json`,
  });
  const page = await context.newPage();
  await mkdir('docs/screenshots', { recursive: true });
  const today = iso(new Date());
  // Premier mercredi du mois prochain : les rendez-vous de démonstration y sont posés.
  const d = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth() + (name === 'desktop' ? 3 : 4),
      1,
    ),
  );
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  const wednesday = iso(d);
  // Données de démonstration (supprimées par admin-teardown.js) : quelques rendez-vous, un blocage, un avis.
  await page.goto('/admin');
  const token = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  const people = [
    ['Awa', 'Diop', '09:30'],
    ['Mariama', 'Sow', '11:15'],
    ['Fatou', 'Ndiaye', '14:00'],
    ['Inès', 'Bah', '16:00'],
  ];
  for (const [index, [first, last, time]] of people.entries()) {
    const res = await page.request.post('/admin/agenda/rdv', {
      form: {
        _csrf: token ?? '',
        firstName: first,
        lastName: `${last} E2E`,
        phone: '06 12 34 56 7' + index,
        service: await page.evaluate(async (i) => {
          const html = await (await fetch('/admin/agenda/rdv/nouveau')).text();
          const slugs = [...html.matchAll(/<option value="([a-z0-9-]+)"/g)].map((m) => m[1]);
          return slugs[(i % (slugs.length - 1)) + 1] ?? '';
        }, index),
        date: wednesday,
        time,
        notify: '',
      },
      maxRedirects: 0,
    });
    const html = await res.text();
    const problems = [...html.matchAll(/(?:field__message|a-alert)[^>]*>([^<]+)</g)].map(
      (m) => m[1],
    );
    expect([303, 409], problems.join(' | ')).toContain(res.status());
  }
  await withDb(async (db) => {
    await db.query(
      `INSERT INTO reviews (author_name, rating, body, consent_publication, status, verified)
       VALUES ('E2E Aminata D.', 5, 'Un accueil chaleureux et des locks parfaitement posées. Je recommande !', true, 'pending', false)`,
    );
  });
  const pages = /** @type {Array<[string, string]>} */ ([
    ['tableau-de-bord', '/admin'],
    ['agenda-jour', `/admin/agenda?vue=jour&date=${wednesday}`],
    ['agenda-semaine', `/admin/agenda?vue=semaine&date=${wednesday}`],
    ['agenda-liste', `/admin/agenda?vue=liste&date=${today}`],
    ['rdv-nouveau', `/admin/agenda/rdv/nouveau?date=${wednesday}`],
    ['clientes', '/admin/clientes'],
    ['avis', '/admin/avis'],
    ['galerie', '/admin/galerie'],
    ['prestations', '/admin/prestations'],
    ['reglages', '/admin/reglages'],
    ['horaires', '/admin/reglages/horaires'],
    ['contenus', '/admin/contenus'],
    ['messages', '/admin/notifications'],
    ['journal', '/admin/journal'],
    ['compte', '/admin/compte'],
    ['plus', '/admin/plus'],
    ['connexion-publique', '/admin/connexion'],
  ]);
  // ADMIN_SHOTS_ONLY=reglages,plus : ne refaire que certaines captures.
  const only = process.env.ADMIN_SHOTS_ONLY?.split(',');
  for (const [label, url] of pages) {
    if (only && !only.includes(label)) continue;
    if (label === 'connexion-publique') await context.clearCookies();
    const response = await page.goto(url);
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `docs/screenshots/admin-${label}-${name}-top.png` });
  }
  await context.close();
});
