// @ts-check
/**
 * Parcours principaux de l'administration par HTTP, avec une vraie session et un vrai jeton CSRF :
 * tableau de bord, agenda (déplacement par glisser-déposer), clientes (CSV, suppression RGPD),
 * prestations, galerie (envoi, remplacement), avis, contenus, réglages, journaux.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../test-helpers.js';
import { zonedToUtc } from '../../lib/zoned-time.js';
import { createManual } from '../agenda/service.js';
import { manualForm } from '../agenda/schemas.js';
import {
  TEST_NOW,
  cleanupAdminUsers,
  createTestUser,
  csrfFor,
  makeAdminApp,
  openTestSession,
} from './test-helpers.js';

const pool = testPool();
const DOMAIN = '@flows.test.invalid';
/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {Array<{ event: string, args: any }>} */
let events;
/** @type {string} */
let uploadDir;
/** @type {string} */
let serviceSlug;
let counter = 0;

/** Session d'un rôle avec son jeton CSRF. @param {'owner'|'staff'} role */
async function login(role) {
  const user = await createTestUser(pool, { role });
  const { cookie } = await openTestSession(pool, user.id);
  const { token, cookie: jar } = await csrfFor(app, cookie);
  return {
    user,
    /** @param {string} url */
    get: (url) => app.inject({ url, headers: { cookie: jar, accept: 'text/html' } }),
    /** @param {string} url @param {Record<string, string>} [fields] */
    post: (url, fields = {}) =>
      app.inject({
        method: 'POST',
        url,
        headers: {
          cookie: jar,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'text/html',
        },
        payload: new URLSearchParams({ _csrf: token, ...fields }).toString(),
      }),
    /** @param {string} url @param {unknown} body */
    json: (url, body) =>
      app.inject({
        method: 'POST',
        url,
        headers: {
          cookie: jar,
          'x-csrf-token': token,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        payload: JSON.stringify(body),
      }),
    /** @param {string} url @param {Record<string, string>} fields @param {{ name: string, data: Buffer, type: string }} [file] */
    upload: (url, fields, file) => {
      const boundary = '----flows';
      /** @type {Buffer[]} */
      const parts = [];
      for (const [k, v] of Object.entries(fields)) {
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
          ),
        );
      }
      if (file) {
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
          ),
        );
        parts.push(file.data, Buffer.from('\r\n'));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      return app.inject({
        method: 'POST',
        url,
        headers: {
          cookie: jar,
          'x-csrf-token': token,
          accept: 'application/json',
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.concat(parts),
      });
    },
  };
}

/** @param {Record<string, unknown>} [over] */
async function appointment(over = {}) {
  counter += 1;
  return createManual(
    pool,
    { notifications: app.notifications },
    manualForm.parse({
      firstName: 'Awa',
      lastName: `Flux${counter}`,
      email: `flux${counter}${DOMAIN}`,
      phone: '0612345678',
      service: serviceSlug,
      date: '2026-12-01',
      time: '10:00',
      ...over,
    }),
    TEST_NOW,
  );
}

/** Image de test (sharp). @param {number} w @param {number} h */
const image = (w, h) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 60, b: 40 } } })
    .jpeg()
    .toBuffer();

beforeAll(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'adl-flows-'));
  await purge();
  ({ app, events } = await makeAdminApp(pool, { env: { UPLOAD_DIR: uploadDir } }));
  await app.ready();
  const { rows } = await pool.query(
    `SELECT slug FROM services WHERE active AND price_cents IS NOT NULL AND NOT on_quote ORDER BY duration_max_minutes LIMIT 1`,
  );
  serviceSlug = rows[0].slug;
});
/** Supprime toutes les données de la suite (appelé avant et après : une exécution interrompue ne pollue pas la suivante). */
async function purge() {
  const mine = `SELECT id FROM clients WHERE email LIKE '%${DOMAIN}' OR email LIKE 'tel-%@sans-email.invalid' OR (first_name = 'Cliente' AND last_name = 'supprimée')`;
  await pool.query(
    `DELETE FROM reviews WHERE author_name LIKE 'Flux%' OR appointment_id IN (SELECT id FROM appointments WHERE client_id IN (${mine}))`,
  );
  await pool.query(`DELETE FROM notifications_log WHERE client_id IN (${mine})`);
  await pool.query(`DELETE FROM appointments WHERE client_id IN (${mine})`);
  await pool.query(`DELETE FROM clients WHERE id IN (${mine})`);
  await pool.query(`DELETE FROM gallery_items WHERE title LIKE 'Flux %'`);
  await pool.query(`DELETE FROM services WHERE slug LIKE 'flux-%'`);
  await pool.query(`DELETE FROM categories WHERE slug LIKE 'flux-%'`);
  await pool.query(`DELETE FROM faq_items WHERE question LIKE 'Flux %'`);
  await pool.query(`DELETE FROM articles WHERE slug LIKE 'flux-%'`);
  await pool.query(`DELETE FROM closures WHERE reason LIKE 'Flux%'`);
  await pool.query(`DELETE FROM blocks WHERE reason LIKE 'Flux%'`);
  await pool.query(`DELETE FROM settings WHERE key = 'site.contact'`);
}
afterAll(async () => {
  await purge();
  await cleanupAdminUsers(pool);
  await app.close();
  await pool.end();
  await rm(uploadDir, { recursive: true, force: true });
});

describe('tableau de bord', () => {
  it('rendez-vous du jour, de la semaine, chiffre d’affaires pour la propriétaire seulement', async () => {
    await appointment({ date: '2026-11-20', time: '15:00' });
    const owner = await login('owner');
    const page = await owner.get('/admin');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('rendez-vous aujourd’hui');
    expect(page.body).toContain('chiffre d’affaires estimé');
    expect(page.body).toContain('Flux');
    const staff = await login('staff');
    const staffPage = await staff.get('/admin');
    expect(staffPage.statusCode).toBe(200);
    expect(staffPage.body).not.toContain('chiffre d’affaires');
    expect(staffPage.body).toContain('Flux');
  });
});

describe('agenda', () => {
  it('trois vues rendues avec leurs rendez-vous, sans attribut style (CSP)', async () => {
    const { id } = await appointment({ date: '2026-12-01', time: '10:00' });
    const owner = await login('owner');
    for (const vue of ['jour', 'semaine', 'liste']) {
      const res = await owner.get(`/admin/agenda?vue=${vue}&date=2026-12-01`);
      expect(res.statusCode, vue).toBe(200);
      expect(res.body).toContain(id);
      expect(res.body).not.toMatch(/\sstyle="/);
    }
    // Une date ou une vue invalide retombe sur les valeurs par défaut.
    expect((await owner.get('/admin/agenda?vue=trop&date=pas-une-date')).statusCode).toBe(200);
  });

  it('déplace un rendez-vous par glisser-déposer : jour + heure locale, notification', async () => {
    const { id } = await appointment({ date: '2026-12-02', time: '10:00' });
    const owner = await login('owner');
    events.length = 0;
    const res = await owner.json(`/admin/agenda/rdv/${id}/deplacer`, {
      date: '2026-12-02',
      time: '16:15',
      notify: '1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, notified: true });
    const { rows } = await pool.query('SELECT starts_at FROM appointments WHERE id = $1', [id]);
    expect(rows[0].starts_at.toISOString()).toBe(
      zonedToUtc('2026-12-02', '16:15', 'Europe/Paris').toISOString(),
    );
    expect(events.map((e) => e.event)).toEqual(['appointmentRescheduled']);
    // Même demande sans notification.
    events.length = 0;
    const silent = await owner.json(`/admin/agenda/rdv/${id}/deplacer`, {
      date: '2026-12-02',
      time: '17:00',
      notify: '',
    });
    expect(silent.statusCode).toBe(200);
    expect(events).toHaveLength(0);
  });

  it('refuse un déplacement vers un créneau pris, avec un message clair', async () => {
    const a = await appointment({ date: '2026-12-03', time: '10:00' });
    const b = await appointment({ date: '2026-12-03', time: '15:00' });
    const owner = await login('owner');
    const res = await owner.json(`/admin/agenda/rdv/${b.id}/deplacer`, {
      date: '2026-12-03',
      time: '10:00',
      notify: '1',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/déjà occupé/);
    void a;
    const invalid = await owner.json(`/admin/agenda/rdv/${b.id}/deplacer`, {
      date: '2026-02-31',
      time: '10:00',
    });
    expect(invalid.statusCode).toBe(422);
  });

  it('fiche du rendez-vous : statut, notes internes, créneaux libres pour déplacer', async () => {
    const { id } = await appointment({ date: '2026-12-04', time: '10:00' });
    const staff = await login('staff');
    const page = await staff.get(`/admin/agenda/rdv/${id}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Notes internes');
    expect(page.body).toContain('tel:+33612345678');
    const move = await staff.get(`/admin/agenda/rdv/${id}?deplacer=1&date=2026-12-04`);
    expect(move.body).toContain('Créneaux libres');
    expect(move.body).toMatch(/name="startsAt" value="2026-12-04T/);
    const notes = await staff.post(`/admin/agenda/rdv/${id}/notes`, {
      notes: 'Cheveux fins, produit sans silicone',
    });
    expect(notes.statusCode).toBe(303);
    expect((await staff.get(`/admin/agenda/rdv/${id}`)).body).toContain('Cheveux fins');
    const cancelled = await staff.post(`/admin/agenda/rdv/${id}/statut`, {
      status: 'cancelled_by_salon',
      notify: '1',
      reason: 'Imprévu',
    });
    expect(cancelled.statusCode).toBe(303);
    expect((await staff.get(`/admin/agenda/rdv/${id}`)).body).toContain('Annulé par le salon');
  });

  it('formulaire classique : une erreur revient sur la fiche avec un message, jamais du JSON brut', async () => {
    const { id } = await appointment({ date: '2026-12-05', time: '10:00' });
    const staff = await login('staff');
    const early = await staff.post(`/admin/agenda/rdv/${id}/statut`, { status: 'completed' });
    expect(early.statusCode).toBe(303);
    expect(early.headers.location).toBe(`/admin/agenda/rdv/${id}?erreur=too_early`);
    expect((await staff.get(String(early.headers.location))).body).toContain('pas encore eu lieu');
    const same = await staff.post(`/admin/agenda/rdv/${id}/deplacer`, {
      startsAt: zonedToUtc('2026-12-05', '10:00', 'Europe/Paris').toISOString(),
    });
    expect(same.statusCode).toBe(303);
    expect(same.headers.location).toContain('erreur=unchanged');
    expect((await staff.get(String(same.headers.location))).body).toContain('déjà à cette heure');
    // Le glisser-déposer (JSON) garde un code d'erreur et un message.
    const json = await staff.json(`/admin/agenda/rdv/${id}/statut`, { status: 'completed' });
    expect(json.statusCode).toBe(422);
    expect(json.json().message).toMatch(/pas encore eu lieu/);
  });

  it('crée un rendez-vous manuel par le formulaire, signale les erreurs', async () => {
    const owner = await login('owner');
    const empty = await owner.post('/admin/agenda/rdv', {
      firstName: '',
      lastName: '',
      service: '',
      date: '2026-12-09',
      time: '10:00',
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.body).toContain('Indiquez le prénom');
    const ok = await owner.post('/admin/agenda/rdv', {
      firstName: 'Fanta',
      lastName: 'Flux',
      phone: '06 98 76 54 32',
      service: serviceSlug,
      date: '2026-12-09',
      time: '10:00',
      notify: '1',
    });
    expect(ok.statusCode).toBe(303);
    expect(ok.headers.location).toMatch(/^\/admin\/agenda\/rdv\//);
    const again = await owner.post('/admin/agenda/rdv', {
      firstName: 'Fanta',
      lastName: 'Flux',
      phone: '06 98 76 54 32',
      service: serviceSlug,
      date: '2026-12-09',
      time: '10:00',
    });
    expect(again.statusCode).toBe(409);
    expect(again.body).toContain('déjà occupé');
  });

  it('bloque puis débloque un créneau', async () => {
    const owner = await login('owner');
    const bad = await owner.post('/admin/agenda/blocages', {
      date: '2026-12-30',
      startTime: '12:00',
      endTime: '10:00',
    });
    expect(bad.statusCode).toBe(422);
    const ok = await owner.post('/admin/agenda/blocages', {
      date: '2026-12-30',
      startTime: '10:00',
      endTime: '12:00',
      reason: 'Flux pause',
    });
    expect(ok.statusCode).toBe(303);
    const list = await owner.get('/admin/agenda/blocages');
    const blockId = /blocages\/(\d+)\/supprimer/.exec(list.body)?.[1];
    expect(blockId).toBeTruthy();
    expect((await owner.post(`/admin/agenda/blocages/${blockId}/supprimer`)).statusCode).toBe(303);
    expect((await owner.post(`/admin/agenda/blocages/${blockId}/supprimer`)).statusCode).toBe(404);
  });

  it('la photo des cheveux n’est visible que connecté, sous un nom généré', async () => {
    const { id } = await appointment({ date: '2026-12-07', time: '10:00' });
    const name = 'hair/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp';
    await mkdir(path.join(uploadDir, 'hair'), { recursive: true });
    await writeFile(
      path.join(uploadDir, name),
      await sharp(await image(20, 20))
        .webp()
        .toBuffer(),
    );
    await pool.query('UPDATE appointments SET hair_photo_path = $2 WHERE id = $1', [id, name]);
    const staff = await login('staff');
    const res = await staff.get(`/admin/agenda/rdv/${id}/photo`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const anon = await app.inject({
      url: `/admin/agenda/rdv/${id}/photo`,
      headers: { accept: 'application/json' },
    });
    expect(anon.statusCode).toBe(401);
    // Un chemin falsifié en base ne sort jamais du dossier d'envois.
    await pool.query('UPDATE appointments SET hair_photo_path = $2 WHERE id = $1', [
      id,
      '../../secret.webp',
    ]);
    expect((await staff.get(`/admin/agenda/rdv/${id}/photo`)).statusCode).toBe(404);
  });
});

describe('clientes', () => {
  it('recherche par nom, email et téléphone ; fiche avec historique et notes', async () => {
    const { id } = await appointment({
      date: '2026-12-08',
      time: '10:00',
      lastName: 'Recherchable',
    });
    const { rows } = await pool.query('SELECT client_id FROM appointments WHERE id = $1', [id]);
    const clientId = rows[0].client_id;
    const staff = await login('staff');
    for (const q of ['recherch', 'RECHERCHABLE', '0612345678', '06 12 34', '+33612345678']) {
      const res = await staff.get(`/admin/clientes?q=${encodeURIComponent(q)}`);
      expect(res.body, q).toContain(clientId);
    }
    expect((await staff.get('/admin/clientes?q=zzzintrouvablezzz')).body).toContain(
      'Aucune cliente',
    );
    // Les caractères spéciaux de recherche sont littéraux (pas de joker).
    expect((await staff.get('/admin/clientes?q=%25')).body).not.toContain(clientId);
    const fiche = await staff.get(`/admin/clientes/${clientId}`);
    expect(fiche.statusCode).toBe(200);
    expect(fiche.body).toContain('Historique (1)');
    const save = await staff.post(`/admin/clientes/${clientId}`, {
      firstName: 'Awa',
      lastName: 'Recherchable',
      phone: '0612345678',
      notes: 'Locks fines, sensible au tiraillement',
    });
    expect(save.statusCode).toBe(303);
    expect((await staff.get(`/admin/clientes/${clientId}`)).body).toContain('Locks fines');
    const invalid = await staff.post(`/admin/clientes/${clientId}`, {
      firstName: '',
      lastName: 'X',
    });
    expect(invalid.statusCode).toBe(422);
  });

  it('export CSV : propriétaire seulement, journalisé, sans les fiches supprimées', async () => {
    await appointment({ date: '2026-12-11', time: '10:00', lastName: 'Exportable' });
    const owner = await login('owner');
    const res = await owner.get('/admin/clientes/export.csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="clientes-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    expect(res.body).toContain('Exportable');
    const { rows } = await pool.query(
      `SELECT 1 FROM audit_log WHERE action = 'client.export' AND user_id = $1`,
      [owner.user.id],
    );
    expect(rows).toHaveLength(1);
    const staff = await login('staff');
    expect((await staff.get('/admin/clientes/export.csv')).statusCode).toBe(403);
  });

  it('suppression RGPD : confirmation requise, données effacées, historique conservé', async () => {
    const { id } = await appointment({ date: '2026-12-14', time: '10:00', lastName: 'Effacable' });
    const email = (
      await pool.query(
        'SELECT c.email FROM appointments a JOIN clients c ON c.id = a.client_id WHERE a.id = $1',
        [id],
      )
    ).rows[0].email;
    await appointment({ date: '2026-12-14', time: '15:00', lastName: 'Effacable', email });
    const { rows } = await pool.query('SELECT client_id FROM appointments WHERE id = $1', [id]);
    const clientId = rows[0].client_id;
    // Photo, avis et journal d'envois liés à cette cliente.
    const photo = 'hair/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp';
    await mkdir(path.join(uploadDir, 'hair'), { recursive: true });
    await writeFile(path.join(uploadDir, photo), Buffer.from('x'));
    await pool.query(
      `UPDATE appointments SET hair_photo_path = $2, client_notes = 'allergique', internal_notes = 'note' WHERE id = $1`,
      [id, photo],
    );
    await pool.query(
      `UPDATE clients SET internal_notes = 'secret', newsletter_opt_in = true, newsletter_opt_in_at = now() WHERE id = $1`,
      [clientId],
    );
    await pool.query(
      `INSERT INTO notifications_log (appointment_id, client_id, channel, template, recipient, status) VALUES ($1, $2, 'email', 'booking_confirmation', 'effacable@flows.test.invalid', 'sent')`,
      [id, clientId],
    );
    await pool.query(
      `INSERT INTO reviews (appointment_id, author_name, rating, body, consent_publication, status, verified) VALUES ($1, 'Awa E.', 5, 'Super', true, 'approved', true)`,
      [id],
    );

    const staff = await login('staff');
    expect(
      (await staff.post(`/admin/clientes/${clientId}/supprimer`, { confirm: '1' })).statusCode,
    ).toBe(403);
    expect((await staff.get(`/admin/clientes/${clientId}/supprimer`)).statusCode).toBe(403);

    const owner = await login('owner');
    const page = await owner.get(`/admin/clientes/${clientId}/supprimer`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('définitive');
    expect(page.body).toMatch(/rendez-vous à venir seront annulés/);
    // Sans la case cochée : rien ne se passe.
    const refused = await owner.post(`/admin/clientes/${clientId}/supprimer`, {});
    expect(refused.statusCode).toBe(422);
    expect(
      (await pool.query('SELECT anonymized_at FROM clients WHERE id = $1', [clientId])).rows[0]
        .anonymized_at,
    ).toBeNull();

    const done = await owner.post(`/admin/clientes/${clientId}/supprimer`, { confirm: '1' });
    expect(done.statusCode).toBe(303);
    const client = (await pool.query('SELECT * FROM clients WHERE id = $1', [clientId])).rows[0];
    expect(client.first_name).toBe('Cliente');
    expect(client.last_name).toBe('supprimée');
    expect(client.email).toMatch(/@sans-email\.invalid$/);
    expect(client.phone).toBeNull();
    expect(client.internal_notes).toBeNull();
    expect(client.newsletter_opt_in).toBe(false);
    expect(client.anonymized_at).not.toBeNull();
    const appt = (
      await pool.query('SELECT * FROM appointments WHERE client_id = $1 ORDER BY starts_at', [
        clientId,
      ])
    ).rows;
    expect(appt).toHaveLength(2); // l'historique reste (statistiques)
    expect(appt[0].hair_photo_path).toBeNull();
    expect(appt[0].client_notes).toBeNull();
    expect(appt[0].internal_notes).toBeNull();
    expect(appt[0].manage_token_hash).toBeNull();
    expect(appt.every((a) => a.status === 'cancelled_by_salon')).toBe(true);
    await expect(stat(path.join(uploadDir, photo))).rejects.toThrow();
    expect(
      (await pool.query('SELECT recipient FROM notifications_log WHERE client_id = $1', [clientId]))
        .rows[0].recipient,
    ).toBe('');
    expect(
      (await pool.query(`SELECT author_name FROM reviews WHERE appointment_id = $1`, [id])).rows[0]
        .author_name,
    ).toBe('Cliente');
    // La fiche disparaît de l'admin.
    expect((await owner.get(`/admin/clientes/${clientId}`)).statusCode).toBe(404);
    expect((await owner.get('/admin/clientes?q=Effacable')).body).not.toContain(clientId);
    expect((await owner.get('/admin/clientes/export.csv')).body).not.toContain('Effacable');
    // Le journal garde l'action, pas l'identité.
    const log = await pool.query(
      `SELECT details FROM audit_log WHERE action = 'client.anonymize' AND user_id = $1`,
      [owner.user.id],
    );
    expect(JSON.stringify(log.rows)).not.toContain('Effacable');
  });
});

describe('prestations et tarifs', () => {
  it('crée, modifie, active/désactive et réordonne', async () => {
    const owner = await login('owner');
    const bad = await owner.post('/admin/prestations', {
      name: 'Flux test',
      summary: 'Court',
      durationMin: '60',
      durationMax: '30',
      price: '50',
    });
    expect(bad.statusCode).toBe(422);
    const created = await owner.post('/admin/prestations', {
      name: 'Flux Entretien',
      slug: 'flux-entretien',
      summary: 'Un entretien',
      body: 'Intro\n\n## Déroulé\nÉtapes',
      durationMin: '60',
      durationMax: '90',
      bufferAfter: '15',
      price: '85,50',
      active: '1',
      bookableOnline: '1',
      confirmed: '1',
    });
    expect(created.statusCode).toBe(303);
    const { rows } = await pool.query(`SELECT * FROM services WHERE slug = 'flux-entretien'`);
    expect(rows[0]).toMatchObject({
      price_cents: 8550,
      duration_max_minutes: 90,
      buffer_after_minutes: 15,
      active: true,
      is_placeholder: false,
    });
    expect(rows[0].body).toEqual([
      { title: null, paragraphs: ['Intro'] },
      { title: 'Déroulé', paragraphs: ['Étapes'] },
    ]);
    const id = rows[0].id;

    // Adresse déjà prise.
    const dup = await owner.post('/admin/prestations', {
      name: 'Autre',
      slug: 'flux-entretien',
      summary: 'x',
      durationMin: '60',
      durationMax: '60',
      price: '10',
    });
    expect(dup.statusCode).toBe(422);
    expect(dup.body).toContain('déjà utilisée');

    // Édition : devis sans prix.
    const edit = await owner.post(`/admin/prestations/${id}`, {
      name: 'Flux Entretien',
      summary: 'Un entretien',
      durationMin: '60',
      durationMax: '90',
      onQuote: '1',
      active: '1',
    });
    expect(edit.statusCode).toBe(303);
    expect(
      (
        await pool.query(
          'SELECT price_cents, on_quote, is_placeholder FROM services WHERE id = $1',
          [id],
        )
      ).rows[0],
    ).toEqual({ price_cents: null, on_quote: true, is_placeholder: true });

    // Désactivation : la prestation disparaît du site public et de l'API.
    expect((await app.inject({ url: '/api/services/flux-entretien' })).statusCode).toBe(200);
    await owner.post(`/admin/prestations/${id}/actif`, { active: '0' });
    expect(
      (await pool.query('SELECT active FROM services WHERE id = $1', [id])).rows[0].active,
    ).toBe(false);
    expect((await app.inject({ url: '/api/services/flux-entretien' })).statusCode).toBe(404);

    // Options : ajout, modification, suppression.
    await owner.post(`/admin/prestations/${id}/options`, {
      label: 'Longueur +',
      price: '15',
      extraMinutes: '30',
      active: '1',
    });
    const opt = (await pool.query('SELECT * FROM service_options WHERE service_id = $1', [id]))
      .rows[0];
    expect(opt).toMatchObject({ label: 'Longueur +', price_cents: 1500, extra_minutes: 30 });
    await owner.post(`/admin/prestations/options/${opt.id}`, {
      label: 'Longueur ++',
      price: '20',
      extraMinutes: '45',
      active: '1',
    });
    expect(
      (await pool.query('SELECT price_cents, label FROM service_options WHERE id = $1', [opt.id]))
        .rows[0],
    ).toEqual({ price_cents: 2000, label: 'Longueur ++' });
    expect((await owner.get(`/admin/prestations/${id}`)).body).toContain('Longueur ++');
    await owner.post(`/admin/prestations/options/${opt.id}/supprimer`);
    expect(
      (await pool.query('SELECT 1 FROM service_options WHERE id = $1', [opt.id])).rows,
    ).toHaveLength(0);

    // Ordre : flèches et glisser-déposer.
    const before = (await pool.query('SELECT id FROM services ORDER BY position, id')).rows.map(
      (r) => Number(r.id),
    );
    const last = before.at(-1);
    await owner.post(`/admin/prestations/${last}/deplacer`, { direction: 'up' });
    const after = (await pool.query('SELECT id, category_id FROM services ORDER BY position, id'))
      .rows;
    expect(after.map((r) => Number(r.id))).not.toEqual(before);
    const group = after
      .filter((r) => r.category_id === after.at(-1)?.category_id || true)
      .slice(0, 3)
      .map((r) => Number(r.id));
    const drag = await owner.json('/admin/prestations/ordre/services', {
      ids: [...group].reverse(),
    });
    expect(drag.statusCode).toBe(200);
    expect((await owner.json('/admin/prestations/ordre/services', { ids: [] })).statusCode).toBe(
      422,
    );
    expect((await owner.json('/admin/prestations/ordre/pirate', { ids: [1] })).statusCode).toBe(
      404,
    );
  });

  it('catégories et méthodes : création et validation', async () => {
    const owner = await login('owner');
    expect((await owner.post('/admin/prestations/categories', { name: 'Flux' })).statusCode).toBe(
      422,
    );
    const ok = await owner.post('/admin/prestations/categories', {
      name: 'Flux Cat',
      slug: 'flux-cat',
      headline: 'Le *titre*',
      summary: 'R',
      intro: 'I',
      mediaLabel: 'M',
      active: '1',
    });
    expect(ok.statusCode).toBe(303);
    expect(
      (await pool.query(`SELECT active FROM categories WHERE slug = 'flux-cat'`)).rows[0].active,
    ).toBe(true);
    expect((await owner.get('/admin/prestations')).body).toContain('Flux Cat');
  });
});

describe('galerie', () => {
  it('envoie une photo recadrée : ré-encodée, deux tailles, servie publiquement, alt obligatoire', async () => {
    const owner = await login('owner');
    const data = await image(1200, 1500);
    const noAlt = await owner.upload(
      '/admin/galerie/photos',
      { title: 'Flux sans alt', alt: '' },
      { name: 'a.jpg', data, type: 'image/jpeg' },
    );
    expect(noAlt.statusCode).toBe(422);
    expect(noAlt.json().fields.alt).toMatch(/obligatoire/);
    const noPhoto = await owner.upload('/admin/galerie/photos', {
      title: 'Flux sans photo',
      alt: 'Une photo de locks',
    });
    expect(noPhoto.statusCode).toBe(422);
    const fake = await owner.upload(
      '/admin/galerie/photos',
      { title: 'Flux faux', alt: 'Une photo de locks' },
      { name: 'a.jpg', data: Buffer.from('<?php echo 1; ?>'), type: 'image/jpeg' },
    );
    expect(fake.statusCode).toBe(422);
    expect(fake.json().fields.photo).toMatch(/JPEG, PNG ou WebP/);

    const res = await owner.upload(
      '/admin/galerie/photos',
      { title: 'Flux locks fines', alt: 'Locks fines, racines fraîches', featured: '1' },
      { name: 'Mon Fichier.JPG', data, type: 'image/jpeg' },
    );
    expect(res.statusCode).toBe(201);
    const { rows } = await pool.query('SELECT * FROM gallery_items WHERE id = $1', [res.json().id]);
    expect(rows[0]).toMatchObject({
      ratio: 'portrait',
      featured: true,
      active: true,
      is_placeholder: false,
    });
    expect(rows[0].image_path).toMatch(/^gallery\/[0-9a-f-]{36}\.webp$/);
    const file = path.basename(rows[0].image_path);
    // Nom aléatoire, jamais celui du fichier envoyé.
    expect(file).not.toContain('Fichier');
    const full = await readFile(path.join(uploadDir, 'gallery', file));
    expect((await sharp(full).metadata()).format).toBe('webp');
    expect(
      (
        await sharp(
          await readFile(path.join(uploadDir, 'gallery', file.replace('.webp', '-600.webp'))),
        ).metadata()
      ).width,
    ).toBe(600);

    // Diffusion publique : cache long, noms stricts.
    const pub = await app.inject({ url: `/media/galerie/${file}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.headers['content-type']).toBe('image/webp');
    expect(pub.headers['cache-control']).toContain('immutable');
    expect((await app.inject({ url: '/media/galerie/..%2F..%2F.env' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/media/galerie/passwd' })).statusCode).toBe(404);
    expect(
      (await app.inject({ url: '/media/galerie/00000000-0000-4000-8000-000000000000.webp' }))
        .statusCode,
    ).toBe(404);

    // La page publique affiche la photo avec son texte alternatif.
    const page = await app.inject({ url: '/galerie' });
    expect(page.body).toContain(file.replace('.webp', '-600.webp'));
    expect(page.body).toContain('Locks fines, racines fraîches');
  });

  it('modifie les étiquettes, exige l’alt, remplace la photo ; suppression réservée à la propriétaire', async () => {
    const owner = await login('owner');
    const created = await owner.upload(
      '/admin/galerie/photos',
      { title: 'Flux carré', alt: 'Un carré de locks' },
      { name: 'a.png', data: await image(800, 800), type: 'image/png' },
    );
    const id = created.json().id;
    expect(
      (await pool.query('SELECT ratio FROM gallery_items WHERE id = $1', [id])).rows[0].ratio,
    ).toBe('square');
    const staff = await login('staff');
    expect(
      (await staff.post(`/admin/galerie/${id}`, { title: 'Flux carré', alt: '' })).statusCode,
    ).toBe(422);
    const upd = await staff.post(`/admin/galerie/${id}`, {
      title: 'Flux carré 2',
      alt: 'Un carré de locks, vue de dessus',
      featured: '1',
      active: '1',
    });
    expect(upd.statusCode).toBe(303);
    expect(
      (await pool.query('SELECT title, alt_text, featured FROM gallery_items WHERE id = $1', [id]))
        .rows[0],
    ).toEqual({
      title: 'Flux carré 2',
      alt_text: 'Un carré de locks, vue de dessus',
      featured: true,
    });
    expect((await staff.get(`/admin/galerie/${id}`)).body).toContain('Remplacer la photo');
    expect((await staff.get('/admin')).statusCode).toBe(200);
    expect((await staff.post(`/admin/galerie/${id}/supprimer`)).statusCode).toBe(403);
    const before = (await pool.query('SELECT image_path FROM gallery_items WHERE id = $1', [id]))
      .rows[0].image_path;
    expect((await owner.post(`/admin/galerie/${id}/supprimer`)).statusCode).toBe(303);
    expect((await pool.query('SELECT 1 FROM gallery_items WHERE id = $1', [id])).rows).toHaveLength(
      0,
    );
    await expect(stat(path.join(uploadDir, before))).rejects.toThrow();
  });

  it('réordonne par glisser-déposer', async () => {
    const owner = await login('owner');
    const ids = [];
    for (const n of [1, 2, 3]) {
      const r = await owner.upload(
        '/admin/galerie/photos',
        { title: `Flux ordre ${n}`, alt: `Photo numéro ${n}` },
        { name: 'a.jpg', data: await image(400, 500), type: 'image/jpeg' },
      );
      ids.push(r.json().id);
    }
    const all = (await pool.query('SELECT id FROM gallery_items ORDER BY position, id')).rows.map(
      (r) => Number(r.id),
    );
    const reordered = [...ids].reverse();
    const res = await owner.json('/admin/galerie/ordre', { ids: reordered });
    expect(res.statusCode).toBe(200);
    const now = (
      await pool.query('SELECT id FROM gallery_items WHERE id = ANY($1) ORDER BY position, id', [
        ids,
      ])
    ).rows.map((r) => Number(r.id));
    expect(now).toEqual(reordered);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect((await owner.json('/admin/galerie/ordre', { ids: [999999999] })).statusCode).toBe(422);
  });
});

describe('avis', () => {
  /** @param {Record<string, unknown>} [over] */
  async function review(over = {}) {
    const values = { author: 'Flux A.', consent: true, status: 'pending', ...over };
    const { rows } = await pool.query(
      `INSERT INTO reviews (author_name, rating, body, consent_publication, status, verified) VALUES ($1, 5, 'Très bien', $2, $3, false) RETURNING id`,
      [values.author, values.consent, values.status],
    );
    return /** @type {string} */ (rows[0].id);
  }

  it('modère : publier, refuser, mettre en avant, répondre', async () => {
    const id = await review();
    const staff = await login('staff');
    const list = await staff.get('/admin/avis');
    expect(list.body).toContain('Flux A.');
    expect((await staff.post(`/admin/avis/${id}/vedette`, { featured: '1' })).statusCode).toBe(409);
    expect((await staff.post(`/admin/avis/${id}/approuver`)).statusCode).toBe(303);
    expect(
      (await pool.query('SELECT status FROM reviews WHERE id = $1', [id])).rows[0].status,
    ).toBe('approved');
    // Publié : visible sur le site public.
    expect((await app.inject({ url: '/avis' })).body).toContain('Très bien');
    expect((await staff.post(`/admin/avis/${id}/vedette`, { featured: '1' })).statusCode).toBe(303);
    expect(
      (await pool.query('SELECT featured FROM reviews WHERE id = $1', [id])).rows[0].featured,
    ).toBe(true);
    expect(
      (await staff.post(`/admin/avis/${id}/reponse`, { reply: 'Merci beaucoup !' })).statusCode,
    ).toBe(303);
    expect((await app.inject({ url: '/avis' })).body).toContain('Merci beaucoup');
    // Refus : disparaît du site, la mise en avant tombe.
    expect((await staff.post(`/admin/avis/${id}/refuser`)).statusCode).toBe(303);
    expect(
      (await pool.query('SELECT status, featured FROM reviews WHERE id = $1', [id])).rows[0],
    ).toEqual({ status: 'rejected', featured: false });
    expect((await app.inject({ url: '/avis' })).body).not.toContain('Merci beaucoup');
  });

  it('ne publie jamais un avis sans l’accord de la cliente', async () => {
    const id = await review({ consent: false });
    const owner = await login('owner');
    const res = await owner.post(`/admin/avis/${id}/approuver`);
    expect(res.statusCode).toBe(409);
    expect(
      (await pool.query('SELECT status FROM reviews WHERE id = $1', [id])).rows[0].status,
    ).toBe('pending');
  });

  it('la réponse vide retire la réponse ; un avis inconnu donne 404', async () => {
    const id = await review({ status: 'approved' });
    const owner = await login('owner');
    await owner.post(`/admin/avis/${id}/reponse`, { reply: 'Merci' });
    await owner.post(`/admin/avis/${id}/reponse`, { reply: '' });
    expect(
      (await pool.query('SELECT owner_reply, replied_at FROM reviews WHERE id = $1', [id])).rows[0],
    ).toEqual({ owner_reply: null, replied_at: null });
    expect(
      (await owner.post('/admin/avis/00000000-0000-4000-8000-000000000000/approuver')).statusCode,
    ).toBe(404);
    expect(
      (await owner.post(`/admin/avis/${id}/reponse`, { reply: 'x'.repeat(1001) })).statusCode,
    ).toBe(422);
  });

  it('le texte d’un avis est échappé dans l’admin', async () => {
    const { rows } = await pool.query(
      `INSERT INTO reviews (author_name, rating, body, consent_publication, status, verified) VALUES ('Flux X.', 4, '<script>alert(1)</script>', true, 'pending', false) RETURNING id`,
    );
    const owner = await login('owner');
    const page = await owner.get('/admin/avis');
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.body).toContain('&lt;script&gt;');
    void rows;
  });
});

describe('réglages', () => {
  it('délais de réservation : appliqués à la réservation en ligne', async () => {
    const owner = await login('owner');
    const bad = await owner.post('/admin/reglages/reservation', {
      minNoticeHours: '-4',
      horizonDays: '60',
      cancellationHours: '48',
      slotStepMinutes: '30',
      longServiceMinutes: '240',
      policyText: 'Politique de test assez longue.',
    });
    expect(bad.statusCode).toBe(422);
    const saved = (await pool.query(`SELECT key, value FROM settings WHERE key LIKE 'booking.%'`))
      .rows;
    const original = Object.fromEntries(saved.map((r) => [r.key, r.value]));
    try {
      const ok = await owner.post('/admin/reglages/reservation', {
        minNoticeHours: '12',
        horizonDays: '45',
        cancellationHours: '24',
        slotStepMinutes: '15',
        longServiceMinutes: '300',
        manualValidation: '1',
        policyText: 'Annulation gratuite jusqu’à 24 h avant, merci.',
      });
      expect(ok.statusCode).toBe(303);
      const now = Object.fromEntries(
        (await pool.query(`SELECT key, value FROM settings WHERE key LIKE 'booking.%'`)).rows.map(
          (r) => [r.key, r.value],
        ),
      );
      expect(now).toMatchObject({
        'booking.min_notice_hours': 12,
        'booking.horizon_days': 45,
        'booking.slot_step_minutes': 15,
        'booking.manual_validation': true,
      });
    } finally {
      for (const [key, value] of Object.entries(original)) {
        await pool.query('UPDATE settings SET value = $2::jsonb WHERE key = $1', [
          key,
          JSON.stringify(value),
        ]);
      }
    }
  });

  it('horaires : refuse une grille vide, accepte et applique une grille valide', async () => {
    const owner = await login('owner');
    const empty = await owner.post('/admin/reglages/horaires', {});
    expect(empty.statusCode).toBe(422);
    expect(empty.body).toContain('au moins une plage');
    const before = (
      await pool.query(
        'SELECT staff_id, weekday, opens_at, closes_at FROM opening_hours ORDER BY staff_id, weekday, opens_at',
      )
    ).rows;
    expect(before.length).toBeGreaterThan(0);
    try {
      const inverted = await owner.post('/admin/reglages/horaires', { d2a: '18:00', d2b: '09:00' });
      expect(inverted.statusCode).toBe(422);
      const ok = await owner.post('/admin/reglages/horaires', {
        d2a: '10:00',
        d2b: '13:00',
        d2c: '15:00',
        d2d: '19:00',
        d6a: '09:00',
        d6b: '12:00',
      });
      expect(ok.statusCode).toBe(303);
      const now = (
        await pool.query(
          `SELECT weekday, to_char(opens_at, 'HH24:MI') AS o, to_char(closes_at, 'HH24:MI') AS c FROM opening_hours ORDER BY weekday, opens_at`,
        )
      ).rows;
      expect(now).toEqual([
        { weekday: 2, o: '10:00', c: '13:00' },
        { weekday: 2, o: '15:00', c: '19:00' },
        { weekday: 6, o: '09:00', c: '12:00' },
      ]);
      expect((await owner.get('/admin/reglages/horaires')).body).toContain('value="15:00"');
    } finally {
      await pool.query('DELETE FROM opening_hours');
      for (const r of before) {
        await pool.query(
          'INSERT INTO opening_hours (staff_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4)',
          [r.staff_id, r.weekday, r.opens_at, r.closes_at],
        );
      }
    }
  });

  it('congés : ajout, avertissement si des rendez-vous existent, suppression', async () => {
    await appointment({ date: '2027-01-12', time: '10:00' });
    const owner = await login('owner');
    const res = await owner.post('/admin/reglages/fermetures', {
      kind: 'closed',
      startsAt: '',
      startsOn: '2027-01-11',
      endsOn: '2027-01-13',
      reason: 'Flux congés',
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toContain('impact=1');
    const page = await owner.get(String(res.headers.location));
    expect(page.body).toContain('1 rendez-vous déjà posé');
    // Le rendez-vous n'est jamais annulé automatiquement.
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM appointments a JOIN clients c ON c.id = a.client_id WHERE c.email LIKE $1 AND a.status = 'confirmed' AND a.starts_at::date = '2027-01-12'`,
          [`%${DOMAIN}`],
        )
      ).rows[0].n,
    ).toBe(1);
    const id = (await pool.query(`SELECT id FROM closures WHERE reason = 'Flux congés'`)).rows[0]
      .id;
    expect((await owner.post(`/admin/reglages/fermetures/${id}/supprimer`)).statusCode).toBe(303);
    expect(
      (
        await owner.post('/admin/reglages/fermetures', {
          kind: 'special_hours',
          startsOn: '2027-01-11',
        })
      ).statusCode,
    ).toBe(422);
  });

  it('coordonnées : affichées sur le site public', async () => {
    const owner = await login('owner');
    const bad = await owner.post('/admin/reglages/coordonnees', {
      street: '12 rue des Arts',
      postalCode: '31000',
      city: 'Toulouse',
      phone: 'abc',
    });
    expect(bad.statusCode).toBe(422);
    const ok = await owner.post('/admin/reglages/coordonnees', {
      street: '12 rue des Arts',
      postalCode: '31000',
      city: 'Toulouse',
      phone: '05 61 00 00 00',
      hours: 'Mardi | 9h – 18h',
    });
    expect(ok.statusCode).toBe(303);
    expect((await owner.get('/admin/reglages/coordonnees')).body).toContain('12 rue des Arts');
  });
});

describe('contenus', () => {
  it('bandeau : nouvel identifiant quand le message change', async () => {
    const owner = await login('owner');
    const original = (
      await pool.query(`SELECT value FROM settings WHERE key = 'site.announcement'`)
    ).rows[0].value;
    try {
      expect(
        (await owner.post('/admin/contenus/bandeau', { enabled: '1', text: '' })).statusCode,
      ).toBe(422);
      expect(
        (
          await owner.post('/admin/contenus/bandeau', {
            enabled: '1',
            text: 'x',
            href: 'javascript:alert(1)',
          })
        ).statusCode,
      ).toBe(422);
      await owner.post('/admin/contenus/bandeau', {
        enabled: '1',
        text: 'Fermé le 24 décembre',
        href: '/contact',
        linkLabel: 'Nous écrire',
      });
      const first = (await pool.query(`SELECT value FROM settings WHERE key = 'site.announcement'`))
        .rows[0].value;
      expect(first).toMatchObject({
        enabled: true,
        text: 'Fermé le 24 décembre',
        href: '/contact',
      });
      await owner.post('/admin/contenus/bandeau', {
        enabled: '1',
        text: 'Fermé le 24 décembre',
        href: '/contact',
        linkLabel: 'Nous écrire',
      });
      expect(
        (await pool.query(`SELECT value FROM settings WHERE key = 'site.announcement'`)).rows[0]
          .value.id,
      ).toBe(first.id);
      await owner.post('/admin/contenus/bandeau', {
        enabled: '1',
        text: 'Fermé aussi le 31',
        href: '/contact',
      });
      expect(
        (await pool.query(`SELECT value FROM settings WHERE key = 'site.announcement'`)).rows[0]
          .value.id,
      ).not.toBe(first.id);
    } finally {
      await pool.query(`UPDATE settings SET value = $1::jsonb WHERE key = 'site.announcement'`, [
        JSON.stringify(original),
      ]);
    }
  });

  it('FAQ : ajout, modification, suppression', async () => {
    const owner = await login('owner');
    const group = (await pool.query('SELECT id FROM faq_groups ORDER BY id LIMIT 1')).rows[0].id;
    expect(
      (
        await owner.post('/admin/contenus/faq', {
          groupId: String(group),
          question: '',
          answer: 'x',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await owner.post('/admin/contenus/faq', {
          groupId: String(group),
          question: 'Flux question ?',
          answer: 'Flux réponse.',
        })
      ).statusCode,
    ).toBe(303);
    const item = (await pool.query(`SELECT id FROM faq_items WHERE question = 'Flux question ?'`))
      .rows[0].id;
    expect((await app.inject({ url: '/faq' })).body).toContain('Flux réponse.');
    await owner.post(`/admin/contenus/faq/${item}`, {
      groupId: String(group),
      question: 'Flux question ?',
      answer: 'Flux réponse modifiée.',
    });
    expect((await app.inject({ url: '/faq' })).body).toContain('Flux réponse modifiée.');
    await owner.post(`/admin/contenus/faq/${item}/supprimer`);
    expect((await app.inject({ url: '/faq' })).body).not.toContain('Flux réponse modifiée.');
  });

  it('articles : brouillon invisible, publication, titre en italique', async () => {
    const owner = await login('owner');
    const article = {
      title: 'Astuce mémorable : *protéger* ses locks',
      slug: 'flux-astuce',
      excerpt: 'Un résumé',
      body: 'Premier paragraphe.\n\n## Suite\nDeuxième.',
    };
    expect(
      (await owner.post('/admin/contenus/articles', { ...article, title: '', status: 'draft' }))
        .statusCode,
    ).toBe(422);
    const draft = await owner.post('/admin/contenus/articles', { ...article, status: 'draft' });
    expect(draft.statusCode).toBe(303);
    // Un brouillon reste invisible du public.
    expect((await app.inject({ url: '/conseils' })).body).not.toContain('Astuce mémorable');
    const { id } = (await pool.query(`SELECT id FROM articles WHERE slug = 'flux-astuce'`)).rows[0];
    expect((await app.inject({ url: '/conseils/flux-astuce' })).statusCode).toBe(404);
    expect(
      (
        await owner.post(`/admin/contenus/articles/${id}`, {
          ...article,
          status: 'published',
          publishedOn: '2026-11-01',
        })
      ).statusCode,
    ).toBe(303);
    expect(
      (
        await pool.query(
          'SELECT status, plain_title, reading_minutes FROM articles WHERE id = $1',
          [id],
        )
      ).rows[0],
    ).toEqual({
      status: 'published',
      plain_title: 'Astuce mémorable : protéger ses locks',
      reading_minutes: 1,
    });
    expect((await app.inject({ url: '/conseils' })).body).toContain('Astuce mémorable');
    const page = await app.inject({ url: '/conseils/flux-astuce' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<em>protéger</em>');
    expect((await owner.get(`/admin/contenus/articles/${id}`)).body).toContain('Deuxième.');
  });

  it('étapes d’une loc : mises à jour, au moins une', async () => {
    const owner = await login('owner');
    const original = (
      await pool.query(`SELECT body FROM content_blocks WHERE key = 'methods.stages'`)
    ).rows[0].body;
    try {
      expect((await owner.post('/admin/contenus/etapes', {})).statusCode).toBe(422);
      expect(
        (
          await owner.post('/admin/contenus/etapes', {
            name1: 'Bébé loc',
            period1: '0–3 mois',
            text1: 'Fragile.',
          })
        ).statusCode,
      ).toBe(303);
      expect(
        (await pool.query(`SELECT body FROM content_blocks WHERE key = 'methods.stages'`)).rows[0]
          .body,
      ).toEqual([{ name: 'Bébé loc', period: '0–3 mois', text: 'Fragile.' }]);
    } finally {
      await pool.query(`UPDATE content_blocks SET body = $1::jsonb WHERE key = 'methods.stages'`, [
        JSON.stringify(original),
      ]);
    }
  });
});

describe('journaux', () => {
  it('journal d’activité : qui a fait quoi, rien de sensible', async () => {
    const owner = await login('owner');
    await owner.post('/admin/agenda/blocages', {
      date: '2026-12-31',
      startTime: '10:00',
      endTime: '11:00',
      reason: 'Flux journal',
    });
    const page = await owner.get('/admin/journal');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Créneau bloqué');
    expect(page.body).toContain('Propriétaire Test');
    expect((await owner.get('/admin/journal?zone=block')).body).toContain('Créneau bloqué');
    expect((await owner.get('/admin/journal?zone=inconnue')).body).toContain('Rien à afficher');
    expect((await owner.get('/admin/journal?zone=%27%3B--&page=-3')).statusCode).toBe(200);
  });

  it('journal d’audit en ajout seul : aucune modification possible', async () => {
    const owner = await login('owner');
    await owner.post('/admin/agenda/blocages', {
      date: '2026-12-31',
      startTime: '12:00',
      endTime: '13:00',
      reason: 'Flux audit',
    });
    await expect(
      pool.query(`UPDATE audit_log SET action = 'truqué' WHERE user_id = $1`, [owner.user.id]),
    ).rejects.toThrow(/ajout seul/);
  });

  it('messages envoyés : adresses masquées, filtres par état', async () => {
    const { id } = await appointment({ date: '2026-12-21', time: '10:00', lastName: 'Notif' });
    const clientId = (await pool.query('SELECT client_id FROM appointments WHERE id = $1', [id]))
      .rows[0].client_id;
    await pool.query(
      `INSERT INTO notifications_log (appointment_id, client_id, channel, template, recipient, status, error) VALUES ($1, $2, 'email', 'booking_confirmation', 'awa.notif@exemple.fr', 'failed', 'adresse refusée'), ($1, $2, 'sms', 'reminder_d1', '+33612345678', 'sent', NULL)`,
      [id, clientId],
    );
    const owner = await login('owner');
    const page = await owner.get('/admin/notifications');
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('awa.notif@exemple.fr');
    expect(page.body).not.toContain('+33612345678');
    expect(page.body).toContain('a***@exemple.fr');
    expect(page.body).toContain('adresse refusée');
    const failed = await owner.get('/admin/notifications?statut=failed');
    expect(failed.body).toContain('adresse refusée');
    expect((await owner.get('/admin/notifications?statut=pirate')).statusCode).toBe(200);
    await pool.query('DELETE FROM notifications_log WHERE appointment_id = $1', [id]);
  });
});

describe('mon compte', () => {
  it('chaque compte voit son compte ; la page « Plus » filtre par rôle', async () => {
    const staff = await login('staff');
    const compte = await staff.get('/admin/compte');
    expect(compte.statusCode).toBe(200);
    expect(compte.body).toContain('Équipe');
    const plus = await staff.get('/admin/plus');
    expect(plus.body).toContain('Galerie');
    expect(plus.body).not.toContain('Réglages');
    const owner = await login('owner');
    expect((await owner.get('/admin/plus')).body).toContain('Réglages');
  });
});
