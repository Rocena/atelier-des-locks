// @ts-check
/**
 * Dépôt d'avis par lien à jeton, de bout en bout (HTTP, base de test) : formulaire, sécurité
 * (CSRF, pot de miel, usage unique, expiration), photo, modération, affichage public.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../../app.js';
import { testConfig, testPool } from '../../test-helpers.js';
import { createAppointment } from '../booking/service.js';
import { bookingForm } from '../booking/schemas.js';
import { issueReviewToken } from './service.js';
import { hashToken } from '../booking/tokens.js';

const NOW = new Date('2026-12-20T10:00:00Z');
const DOMAIN = '@avis.test.invalid';
const pool = testPool();
/** @type {string} */
let uploadDir;
/** @type {import('fastify').FastifyInstance} */
let app;
let counter = 0;

/** Un RDV « terminé » et son lien d'avis. */
async function completedAppointment(
  /** @type {string} */ startsAt,
  expiresAt = new Date(NOW.getTime() + 30 * 86_400_000),
) {
  const form = bookingForm.parse({
    service: 'resserrage-palm-rolling',
    startsAt,
    firstName: 'Awa',
    lastName: 'Diallo',
    email: `awa${++counter}${DOMAIN}`,
    phone: '0612345678',
    hairState: 'mature_locks',
    policy: 'on',
  });
  const { appointment } = await createAppointment(pool, {
    form,
    photoPath: null,
    now: new Date('2026-11-20T10:00:00Z'),
  });
  await pool.query(`UPDATE appointments SET status = 'completed' WHERE id = $1`, [appointment.id]);
  const { token } = await issueReviewToken(pool, appointment.id, NOW, { expiresAt });
  return { id: appointment.id, token };
}

/** GET du formulaire : cookie et jeton CSRF. @param {string} token */
async function open(token) {
  const res = await app.inject({ url: `/avis/laisser/${token}` });
  return {
    res,
    csrf: /name="_csrf" value="([^"]+)"/.exec(res.body)?.[1] ?? '',
    cookie: res.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
  };
}

/** @type {{ csrf: string, cookie: string } | undefined} */
let shared;
/**
 * @param {string} token
 * @param {{ fields?: Record<string, string|undefined>, photo?: Buffer, csrf?: boolean }} [o]
 */
async function post(token, { fields = {}, photo, csrf = true } = {}) {
  let { csrf: t, cookie } = await open(token);
  if (!t) {
    // Lien fermé (expiré, déjà utilisé) : session d'un formulaire resté ouvert dans l'onglet.
    shared ??= await open((await completedAppointment('2026-12-17T08:00:00.000Z')).token);
    ({ csrf: t, cookie } = shared);
  }
  const form = new FormData();
  const values = {
    _csrf: csrf ? t : 'faux',
    rating: '5',
    body: 'Un travail soigné, un accueil chaleureux.',
    firstName: 'Awa',
    lastInitial: 'd',
    consent: 'on',
    ...fields,
  };
  for (const [k, v] of Object.entries(values)) if (v !== undefined) form.append(k, v);
  if (photo)
    form.append('photo', new Blob([new Uint8Array(photo)], { type: 'image/png' }), 'resultat.png');
  return app.inject({
    method: 'POST',
    url: `/avis/laisser/${token}`,
    payload: form,
    headers: { cookie },
  });
}

const png = () =>
  sharp({ create: { width: 40, height: 40, channels: 3, background: '#a9472e' } })
    .png()
    .toBuffer();
const reviewOf = async (/** @type {string} */ appointmentId) =>
  (await pool.query(`SELECT * FROM reviews WHERE appointment_id = $1`, [appointmentId])).rows[0];

beforeAll(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'adl-avis-'));
  app = await buildApp({
    config: testConfig({
      UPLOAD_DIR: uploadDir,
      BOOKING_RATE_LIMIT: '1000',
      GOOGLE_REVIEW_URL: 'https://g.page/r/exemple/review',
    }),
    logger: false,
    db: pool,
    now: () => NOW,
  });
});
afterAll(async () => {
  const where = `SELECT a.id FROM appointments a JOIN clients c ON c.id = a.client_id WHERE c.email LIKE '%${DOMAIN}'`;
  await pool.query(`DELETE FROM reviews WHERE appointment_id IN (${where})`);
  await pool.query(`DELETE FROM appointments WHERE id IN (${where})`);
  await pool.query(`DELETE FROM clients WHERE email LIKE '%${DOMAIN}'`);
  await app.close();
  await pool.end();
  await rm(uploadDir, { recursive: true, force: true });
});

describe('formulaire /avis/laisser/:token', () => {
  it('affiche le formulaire (prénom prérempli, note, photo facultative, consentement) en no-store, noindex', async () => {
    const { token } = await completedAppointment('2026-12-02T08:00:00.000Z');
    const { res } = await open(token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.body).toContain('name="rating"');
    expect(res.body).toContain('value="Awa"');
    expect(res.body).toContain('type="file"');
    expect(res.body).toContain('name="consent"');
    expect(res.body).toContain('Resserrage au palm rolling');
    expect(res.body).not.toMatch(/ style="/);
  });

  it('lien inconnu, mal formé ou RDV non terminé : même réponse neutre', async () => {
    expect((await app.inject({ url: `/avis/laisser/${'A'.repeat(43)}` })).statusCode).toBe(410);
    expect((await app.inject({ url: '/avis/laisser/court' })).statusCode).toBe(404);
    const { id, token } = await completedAppointment('2026-12-02T14:00:00.000Z');
    await pool.query(`UPDATE appointments SET status = 'confirmed' WHERE id = $1`, [id]);
    expect((await app.inject({ url: `/avis/laisser/${token}` })).statusCode).toBe(410);
  });

  it('lien expiré (30 jours) : message clair, aucun dépôt possible', async () => {
    const { token } = await completedAppointment(
      '2026-12-03T08:00:00.000Z',
      new Date('2026-12-19T00:00:00Z'),
    );
    const res = await app.inject({ url: `/avis/laisser/${token}` });
    expect(res.statusCode).toBe(410);
    expect(res.body).toContain('a expiré');
    expect((await post(token)).statusCode).toBe(410);
  });
});

describe('dépôt d’un avis', () => {
  it('crée un avis « à modérer », vérifié, non publié ; redirige vers le remerciement avec le lien Google', async () => {
    const { id, token } = await completedAppointment('2026-12-03T14:00:00.000Z');
    const res = await post(token);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`/avis/laisser/${token}?envoye=1`);
    const review = await reviewOf(id);
    expect(review).toMatchObject({
      status: 'pending',
      verified: true,
      consent_publication: true,
      rating: 5,
      author_name: 'Awa D.',
      photo_path: null,
    });
    // Pas publié : absent de /avis et de l'API.
    expect((await app.inject({ url: '/api/reviews' })).body).not.toContain('Un travail soigné');
    const thanks = await app.inject({ url: res.headers.location });
    expect(thanks.body).toContain('https://g.page/r/exemple/review');
    expect(thanks.body).toContain('relu par la propriétaire');
  });

  it('usage unique : un second envoi avec le même lien est refusé', async () => {
    const { id, token } = await completedAppointment('2026-12-04T08:00:00.000Z');
    expect((await post(token)).statusCode).toBe(303);
    const again = await post(token, {
      fields: { body: 'Un deuxième avis qui ne doit pas passer.' },
    });
    expect(again.statusCode).toBe(410);
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM reviews WHERE appointment_id = $1`, [id]))
        .rows[0].n,
    ).toBe(1);
    const page = await app.inject({ url: `/avis/laisser/${token}` });
    expect(page.statusCode).toBe(410);
    expect(page.body).toContain('déjà envoyé');
  });

  it('deux envois simultanés : un seul avis', async () => {
    const { id, token } = await completedAppointment('2026-12-04T14:00:00.000Z');
    const codes = (await Promise.all([post(token), post(token), post(token)]))
      .map((r) => r.statusCode)
      .sort();
    expect(codes).toEqual([303, 410, 410]);
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM reviews WHERE appointment_id = $1`, [id]))
        .rows[0].n,
    ).toBe(1);
  });

  it('refuse sans jeton CSRF valide', async () => {
    const { id, token } = await completedAppointment('2026-12-09T08:00:00.000Z');
    expect((await post(token, { csrf: false })).statusCode).toBe(403);
    expect(await reviewOf(id)).toBeUndefined();
  });

  it('valide côté serveur : note, texte trop court, consentement, initiale, prénom', async () => {
    const { id, token } = await completedAppointment('2026-12-09T14:00:00.000Z');
    for (const fields of [
      { rating: '6' },
      { rating: undefined },
      { body: 'court' },
      { consent: undefined },
      { lastInitial: '12' },
      { firstName: '<b>x</b>' },
    ]) {
      const res = await post(token, { fields });
      expect(res.statusCode, JSON.stringify(fields)).toBe(422);
      expect(res.body).toContain('role="alert"');
    }
    expect(await reviewOf(id)).toBeUndefined();
    // Les champs saisis sont conservés et échappés dans la page d'erreur.
    const res = await post(token, {
      fields: { body: '<script>alert(1)</script> trop', rating: undefined },
    });
    expect(res.body).not.toContain('<script>alert(1)');
  });

  it('pot de miel rempli : rien n’est enregistré', async () => {
    const { id, token } = await completedAppointment('2026-12-10T08:00:00.000Z');
    await post(token, { fields: { website: 'http://spam.example' } });
    expect(await reviewOf(id)).toBeUndefined();
  });

  it('photo : ré-encodée en WebP, stockée hors webroot ; fichier non image refusé', async () => {
    const { id, token } = await completedAppointment('2026-12-10T14:00:00.000Z');
    const bad = await post(token, { photo: Buffer.from('<?php echo 1; ?>') });
    expect(bad.statusCode).toBe(422);
    expect(await reviewOf(id)).toBeUndefined();
    const ok = await post(token, { photo: await png() });
    expect(ok.statusCode).toBe(303);
    const review = await reviewOf(id);
    expect(review.photo_path).toMatch(/^reviews\/[0-9a-f-]{36}\.webp$/);
    expect((await readdir(path.join(uploadDir, 'reviews'))).length).toBeGreaterThan(0);
  });
});

describe('affichage public', () => {
  it('une photo n’est servie que si l’avis est approuvé', async () => {
    const { id, token } = await completedAppointment('2026-12-11T08:00:00.000Z');
    await post(token, {
      photo: await png(),
      fields: { body: 'Avis avec photo, très satisfaite du résultat.' },
    });
    const { id: reviewId } = await reviewOf(id);
    expect((await app.inject({ url: `/avis/photos/${reviewId}` })).statusCode).toBe(404);

    await pool.query(
      `UPDATE reviews SET status = 'approved', owner_reply = 'Merci Awa !' WHERE id = $1`,
      [reviewId],
    );
    const photo = await app.inject({ url: `/avis/photos/${reviewId}` });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/webp');
    expect(photo.headers['x-content-type-options']).toBe('nosniff');

    const page = await app.inject({ url: '/avis' });
    expect(page.body).toContain('Avis avec photo');
    expect(page.body).toContain(`/avis/photos/${reviewId}`);
    expect(page.body).toContain('Merci Awa !');
    expect(page.body).toContain('Avis vérifié');
    expect(page.body).toContain('https://g.page/r/exemple/review');
    expect((await app.inject({ url: '/avis/photos/pas-un-uuid' })).statusCode).toBe(404);
  });

  it('refusé = jamais affiché, même avec une photo', async () => {
    const { id, token } = await completedAppointment('2026-12-11T14:00:00.000Z');
    await post(token, {
      photo: await png(),
      fields: { body: 'Avis qui sera refusé par la propriétaire.' },
    });
    const { id: reviewId } = await reviewOf(id);
    await pool.query(`UPDATE reviews SET status = 'rejected' WHERE id = $1`, [reviewId]);
    expect((await app.inject({ url: '/avis' })).body).not.toContain('sera refusé');
    expect((await app.inject({ url: `/avis/photos/${reviewId}` })).statusCode).toBe(404);
  });

  it('la note moyenne tient compte des avis approuvés seulement', async () => {
    const { id, token } = await completedAppointment('2026-12-16T08:00:00.000Z');
    await post(token, { fields: { rating: '1', body: 'Avis en attente, ne doit pas compter.' } });
    const before = (await app.inject({ url: '/api/reviews' })).json().summary;
    await pool.query(`UPDATE reviews SET status = 'approved' WHERE appointment_id = $1`, [id]);
    const after = (await app.inject({ url: '/api/reviews' })).json().summary;
    expect(after.count).toBe(before.count + 1);
    expect(after.average).toBeLessThan(before.average);
  });
});

describe('jeton', () => {
  it('seule l’empreinte SHA-256 est en base', async () => {
    const { id, token } = await completedAppointment('2026-12-16T14:00:00.000Z');
    const { rows } = await pool.query(
      `SELECT token_hash FROM review_tokens WHERE appointment_id = $1`,
      [id],
    );
    expect(rows[0].token_hash.equals(hashToken(token))).toBe(true);
    expect(token).toHaveLength(43);
  });
});
