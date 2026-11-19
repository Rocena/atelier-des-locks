// @ts-check
/**
 * Réservation de bout en bout côté serveur (base de test) : créneaux, création, sécurité
 * (CSRF, pot de miel, anti-bot, limitation de débit, upload), double réservation,
 * « Gérer mon RDV », calendriers et adaptateur BOOKING_PROVIDER.
 * Horloge figée au vendredi 20 novembre 2026, 10h UTC ; RDV posés en décembre 2026.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../../app.js';
import { testConfig, testPool } from '../../test-helpers.js';
import { solveChallenge, encodeSolution } from './anti-bot.js';
import { createAppointment } from './service.js';
import { bookingForm } from './schemas.js';
import { hashToken } from './tokens.js';

const NOW = new Date('2026-11-20T10:00:00Z');
const EMAIL_DOMAIN = '@resa.test.invalid';
const FEED_TOKEN = 'f'.repeat(40);

const pool = testPool();
/** @type {string} */
let uploadDir;

/** @param {Record<string, string>} [env] */
async function makeApp(env = {}) {
  return buildApp({
    config: testConfig({
      UPLOAD_DIR: uploadDir,
      ICAL_FEED_TOKEN: FEED_TOKEN,
      BOOKING_RATE_LIMIT: '50',
      ...env,
    }),
    logger: false,
    db: pool,
    now: () => NOW,
  });
}

/**
 * Ouvre /reserver comme un navigateur : cookie CSRF + jeton.
 * @param {import('fastify').FastifyInstance} app
 */
async function session(app) {
  const res = await app.inject({ url: '/reserver' });
  const token = /data-csrf="([^"]+)"/.exec(res.body)?.[1] ?? '';
  const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { token, cookie };
}

/** @param {import('fastify').FastifyInstance} app */
async function altcha(app) {
  const challenge = (await app.inject({ url: '/api/booking/challenge' })).json();
  return encodeSolution(challenge, /** @type {number} */ (solveChallenge(challenge)));
}

let emailCounter = 0;
/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ fields?: Record<string, string|string[]|undefined>, photo?: Buffer, photoType?: string, csrf?: boolean, pow?: string }} [opts]
 */
async function book(app, { fields = {}, photo, photoType = 'image/png', csrf = true, pow } = {}) {
  const { token, cookie } = await session(app);
  const form = new FormData();
  const values = {
    service: 'resserrage-palm-rolling',
    startsAt: '2026-12-01T08:00:00.000Z', // mardi 1er décembre, 9h Paris
    firstName: 'Awa',
    lastName: 'Diallo',
    email: `awa${++emailCounter}${EMAIL_DOMAIN}`,
    phone: '06 12 34 56 78',
    hairState: 'mature_locks',
    notes: 'Cuir chevelu sensible',
    policy: 'on',
    smsReminders: 'on',
    altcha: pow ?? (await altcha(app)),
    ...fields,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) form.append(key, v);
  }
  if (photo)
    form.append('photo', new Blob([new Uint8Array(photo)], { type: photoType }), 'cheveux.png');
  return app.inject({
    method: 'POST',
    url: '/api/booking/appointments',
    payload: form,
    headers: { cookie, ...(csrf ? { 'x-csrf-token': token } : {}) },
  });
}

/** Jeton du lien « Gérer mon RDV » renvoyé à la création. @param {any} body */
const tokenOf = (body) => String(body.manageUrl).split('/rdv/')[1];

beforeAll(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'adl-resa-'));
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM appointments WHERE client_id IN (SELECT id FROM clients WHERE email LIKE $1)`,
    [`%${EMAIL_DOMAIN}`],
  );
  await pool.query(`DELETE FROM clients WHERE email LIKE $1`, [`%${EMAIL_DOMAIN}`]);
  await pool.end();
  await rm(uploadDir, { recursive: true, force: true });
});

describe('créneaux', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(() => app.close());

  it('/reserver affiche le tunnel avec ses données et un jeton CSRF', async () => {
    const res = await app.inject({ url: '/reserver' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id="booking-data"');
    expect(res.body).toMatch(/data-csrf="[^"]{20,}"/);
    expect(res.cookies.some((c) => c.name === '_csrf' && c.httpOnly)).toBe(true);
  });

  it('renvoie les créneaux réels (mardi 1er décembre, 2h30 + 15 min de tampon)', async () => {
    const res = await app.inject({
      url: '/api/booking/slots?service=resserrage-palm-rolling&from=2026-11-30&to=2026-12-06',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.booking.occupationMinutes).toBe(165);
    const tuesday = body.days.find((/** @type {any} */ d) => d.date === '2026-12-01');
    expect(tuesday.slots[0]).toEqual({
      startsAt: '2026-12-01T08:00:00.000Z', // 9h : 2h45 tiennent dans la matinée (3 h)
      endsAt: '2026-12-01T10:45:00.000Z',
    });
    // Dernier départ du matin : 9h15 n'est pas sur la grille de 30 min, donc 9h seulement.
    expect(tuesday.slots.map((/** @type {any} */ s) => s.startsAt)).not.toContain(
      '2026-12-01T08:30:00.000Z',
    );
    expect(body.days.find((/** @type {any} */ d) => d.date === '2026-11-30').slots).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('staff');
  });

  it('les options rallongent la durée et sont contrôlées', async () => {
    const services = await pool.query(
      `SELECT o.id FROM service_options o JOIN services s ON s.id = o.service_id
        WHERE s.slug = 'resserrage-palm-rolling' ORDER BY o.position, o.id`,
    );
    const ok = await app.inject({
      url: `/api/booking/slots?service=resserrage-palm-rolling&options=${services.rows[0].id}&from=2026-12-01&to=2026-12-01`,
    });
    expect(ok.statusCode).toBe(200);
    const foreign = await app.inject({
      url: '/api/booking/slots?service=resserrage-palm-rolling&options=999999&from=2026-12-01&to=2026-12-01',
    });
    expect(foreign.statusCode).toBe(422);
  });

  it.each([
    ['service inconnu', 'service=inconnu&from=2026-12-01&to=2026-12-01', 404],
    ['sur devis', 'service=coiffure-mariage-evenement&from=2026-12-01&to=2026-12-01', 422],
    ['après consultation', 'service=micro-locks&from=2026-12-01&to=2026-12-01', 422],
    ['période trop longue', 'service=bain-detox&from=2026-12-01&to=2027-02-01', 400],
    ['date invalide', 'service=bain-detox&from=2026-13-01&to=2026-12-01', 400],
    ['paramètre inconnu', 'service=bain-detox&from=2026-12-01&to=2026-12-01&x=1', 400],
    ['injection', "service=bain-detox'--&from=2026-12-01&to=2026-12-01", 400],
  ])('refuse : %s', async (_label, query, status) => {
    expect((await app.inject({ url: `/api/booking/slots?${query}` })).statusCode).toBe(status);
  });
});

describe('création d’un rendez-vous', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(() => app.close());

  it('crée le RDV, stocke le jeton haché et la photo nettoyée hors webroot', async () => {
    const photo = await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#5a3' },
    })
      .jpeg()
      .withExif({ IFD0: { ImageDescription: 'GPS 43.6,1.44' } })
      .toBuffer();
    const res = await book(app, {
      fields: { startsAt: '2026-12-02T13:00:00.000Z', newsletter: 'on' },
      photo,
      photoType: 'image/jpeg',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('confirmed');
    expect(body.manageUrl).toMatch(/\/rdv\/[A-Za-z0-9_-]{43}$/);
    expect(body.appointment).toMatchObject({
      serviceName: expect.any(String),
      dayLabel: 'mercredi 2 décembre 2026',
      timeLabel: '14h',
    });

    const { rows } = await pool.query(
      `SELECT a.*, c.phone, c.newsletter_opt_in, c.newsletter_opt_in_at
         FROM appointments a JOIN clients c ON c.id = a.client_id
        WHERE a.manage_token_hash = $1`,
      [hashToken(tokenOf(body))],
    );
    expect(rows).toHaveLength(1);
    const a = rows[0];
    expect(a.status).toBe('confirmed');
    expect(a.phone).toBe('+33612345678');
    expect(a.newsletter_opt_in).toBe(true);
    expect(a.newsletter_opt_in_at).not.toBeNull();
    expect(a.ends_at.toISOString()).toBe('2026-12-02T15:45:00.000Z');
    expect(a.manage_token_expires_at.getTime()).toBeGreaterThan(a.ends_at.getTime());
    // Le jeton en clair n'est jamais stocké.
    expect(JSON.stringify(rows)).not.toContain(tokenOf(body));
    expect(a.hair_photo_path).toMatch(/^hair\/[0-9a-f-]{36}\.webp$/);
    const stored = await sharp(await readFile(path.join(uploadDir, a.hair_photo_path))).metadata();
    expect(stored.format).toBe('webp');
    expect(stored.exif).toBeUndefined();
  });

  it('un tiers ne peut pas écraser la fiche d’une cliente en réservant avec son email', async () => {
    const email = `victime${++emailCounter}${EMAIL_DOMAIN}`;
    expect(
      (await book(app, { fields: { email, startsAt: '2026-12-08T08:00:00.000Z' } })).statusCode,
    ).toBe(201);
    const attack = await book(app, {
      fields: {
        email,
        firstName: 'Pirate',
        lastName: 'Intrus',
        phone: '0699999999',
        startsAt: '2026-12-09T08:00:00.000Z',
      },
    });
    expect(attack.statusCode).toBe(201);
    const { rows } = await pool.query(
      'SELECT first_name, last_name, phone FROM clients WHERE email = $1',
      [email],
    );
    expect(rows[0]).toMatchObject({ first_name: 'Awa', last_name: 'Diallo' });
    expect(rows[0].phone).not.toContain('99999999');
  });

  it('refuse l’adresse réservée aux fiches sans email', async () => {
    const res = await book(app, { fields: { email: 'tel-0612345678@sans-email.invalid' } });
    expect(res.statusCode).toBe(422);
  });

  it('plafonne les rendez-vous à venir par email (429)', async () => {
    const email = `plafond${++emailCounter}${EMAIL_DOMAIN}`;
    const days = ['10', '11', '15', '16'];
    const codes = [];
    for (const d of days) {
      codes.push(
        (await book(app, { fields: { email, startsAt: `2026-12-${d}T08:00:00.000Z` } })).statusCode,
      );
    }
    expect(codes).toEqual([201, 201, 201, 429]);
  });

  it('refuse le même créneau une seconde fois (409)', async () => {
    const startsAt = '2026-12-03T13:00:00.000Z';
    expect((await book(app, { fields: { startsAt } })).statusCode).toBe(201);
    const second = await book(app, { fields: { startsAt } });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('slot_taken');
  });

  it('double réservation simultanée : une seule passe (transaction + contrainte d’exclusion)', async () => {
    const base = {
      service: 'bain-detox',
      startsAt: '2026-12-04T08:00:00.000Z',
      firstName: 'Fatou',
      lastName: 'Sow',
      phone: '0700000000',
      hairState: 'unsure',
      policy: 'on',
    };
    const forms = [1, 2, 3].map((i) =>
      bookingForm.parse({ ...base, email: `concurrent${i}${EMAIL_DOMAIN}` }),
    );
    const results = await Promise.allSettled(
      forms.map((form) => createAppointment(pool, { form, photoPath: null, now: NOW })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect(/** @type {PromiseRejectedResult} */ (r).reason.code).toBe('slot_taken');
    }
  });

  it('refuse un créneau hors grille, passé, trop proche ou fermé', async () => {
    for (const startsAt of [
      '2026-12-01T08:10:00.000Z', // 9h10 : hors grille
      '2026-11-20T13:00:00.000Z', // aujourd'hui
      '2026-11-21T13:00:00.000Z', // samedi demain, à moins de 24 h ? non : +27 h, mais 2h45 tient
      '2026-12-07T09:00:00.000Z', // lundi : fermé
      '2027-03-01T09:00:00.000Z', // au-delà de l'horizon de 60 jours
    ].filter((s) => s !== '2026-11-21T13:00:00.000Z')) {
      const res = await book(app, { fields: { startsAt } });
      expect(res.statusCode, startsAt).toBe(409);
    }
  });

  it('valide chaque champ côté serveur et renvoie les erreurs par champ', async () => {
    const res = await book(app, {
      fields: { email: 'pas-un-email', phone: '12', policy: undefined, hairState: 'inconnu' },
    });
    expect(res.statusCode).toBe(422);
    expect(Object.keys(res.json().fields).sort()).toEqual([
      'email',
      'hairState',
      'phone',
      'policy',
    ]);
  });

  it('refuse une prestation non réservable en ligne', async () => {
    const res = await book(app, { fields: { service: 'micro-locks' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('not_bookable');
  });
});

describe('protections du formulaire', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(() => app.close());

  it('CSRF : refusé sans jeton', async () => {
    const res = await book(app, { csrf: false });
    expect(res.statusCode).toBe(403);
  });

  it('pot de miel rempli : refusé', async () => {
    const res = await book(app, { fields: { website: 'https://spam.example' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('rejected');
  });

  it('anti-bot : solution absente, fausse ou réutilisée refusée', async () => {
    expect((await book(app, { pow: '' })).json().error).toBe('bot_check');
    expect(
      (await book(app, { pow: Buffer.from('{"number":1}').toString('base64') })).json().error,
    ).toBe('bot_check');
    const pow = await altcha(app);
    expect(
      (await book(app, { pow, fields: { startsAt: '2026-12-09T13:00:00.000Z' } })).statusCode,
    ).toBe(201);
    expect(
      (await book(app, { pow, fields: { startsAt: '2026-12-10T13:00:00.000Z' } })).json().error,
    ).toBe('bot_check');
  });

  it('upload : faux fichier image refusé, rien n’est stocké', async () => {
    const before = await readdir(path.join(uploadDir, 'hair')).catch(() => []);
    const res = await book(app, {
      photo: Buffer.from('<?php system($_GET["c"]); ?>'),
      photoType: 'image/png',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().fields.photo).toMatch(/JPEG, PNG ou WebP/);
    const after = await readdir(path.join(uploadDir, 'hair')).catch(() => []);
    expect(after).toEqual(before);
  });

  it('upload : fichier trop lourd refusé (413)', async () => {
    const res = await book(app, { photo: Buffer.alloc(9 * 1024 * 1024, 1) });
    expect(res.statusCode).toBe(413);
  });

  it('limitation de débit sur la création', async () => {
    const limited = await makeApp({ BOOKING_RATE_LIMIT: '2' });
    try {
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await book(limited, { csrf: false })).statusCode);
      expect(statuses).toEqual([403, 403, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('gérer mon RDV', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  /** @type {string} */
  let token;
  beforeAll(async () => {
    app = await makeApp();
    const res = await book(app, { fields: { startsAt: '2026-12-11T13:00:00.000Z' } });
    token = tokenOf(res.json());
  });
  afterAll(() => app.close());

  /** Session (cookie + jeton CSRF) prise sur la page du RDV. */
  async function manageSession() {
    const res = await app.inject({ url: `/rdv/${token}` });
    return {
      res,
      csrf: /name="_csrf" value="([^"]+)"/.exec(res.body)?.[1] ?? '',
      cookie: res.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    };
  }

  it('affiche le RDV, sans cache, sans indexation, sans Referer', async () => {
    const { res } = await manageSession();
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.body).toContain('vendredi 11 décembre 2026');
    expect(res.body).toContain('Déplacer le rendez-vous');
  });

  it('lien invalide, inconnu ou expiré : page 404', async () => {
    for (const url of ['/rdv/court', `/rdv/${'A'.repeat(43)}`]) {
      const res = await app.inject({ url });
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain('plus valable');
    }
  });

  it('fichier .ics du RDV', async () => {
    const res = await app.inject({ url: `/rdv/${token}/rdv.ics` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.body).toContain('DTSTART:20261211T130000Z');
    expect(res.body).toContain('DTEND:20261211T153000Z'); // sans le tampon de 15 min
  });

  it('propose des créneaux de déplacement (le RDV lui-même ne bloque pas)', async () => {
    const res = await app.inject({ url: `/rdv/${token}/deplacer?semaine=2026-12-07` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('value="2026-12-11T13:30:00.000Z"'); // chevauche l'actuel : proposé
  });

  it('déplacer sans CSRF est refusé, avec CSRF le RDV bouge', async () => {
    const refused = await app.inject({
      method: 'POST',
      url: `/rdv/${token}/deplacer`,
      payload: { startsAt: '2026-12-11T13:30:00.000Z' },
    });
    expect(refused.statusCode).toBe(403);

    const { csrf, cookie } = await manageSession();
    const res = await app.inject({
      method: 'POST',
      url: `/rdv/${token}/deplacer`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf,
        startsAt: '2026-12-11T13:30:00.000Z',
      }).toString(),
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`/rdv/${token}?fait=deplace`);
    const { rows } = await pool.query(
      'SELECT starts_at FROM appointments WHERE manage_token_hash = $1',
      [hashToken(token)],
    );
    expect(rows[0].starts_at.toISOString()).toBe('2026-12-11T13:30:00.000Z');
  });

  it('déplacer vers un créneau pris renvoie au choix avec un message', async () => {
    const other = await book(app, { fields: { startsAt: '2026-12-16T13:00:00.000Z' } });
    expect(other.statusCode).toBe(201);
    const { csrf, cookie } = await manageSession();
    const res = await app.inject({
      method: 'POST',
      url: `/rdv/${token}/deplacer`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: csrf,
        startsAt: '2026-12-16T13:00:00.000Z',
      }).toString(),
    });
    expect(res.headers.location).toBe(`/rdv/${token}/deplacer?erreur=pris`);
  });

  it('annuler libère le créneau', async () => {
    const { csrf, cookie } = await manageSession();
    const res = await app.inject({
      method: 'POST',
      url: `/rdv/${token}/annuler`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ _csrf: csrf, reason: 'Empêchement' }).toString(),
    });
    expect(res.statusCode).toBe(303);
    const page = await app.inject({ url: `/rdv/${token}?fait=annule` });
    expect(page.body).toContain('Votre rendez-vous est annulé');
    expect(page.body).not.toContain('Déplacer le rendez-vous');
    // Le créneau est de nouveau réservable.
    expect((await book(app, { fields: { startsAt: '2026-12-11T13:30:00.000Z' } })).statusCode).toBe(
      201,
    );
  });

  it('à moins de 48 h, plus de libre-service', async () => {
    const res = await book(app, { fields: { startsAt: '2026-12-17T13:00:00.000Z' } });
    const late = await buildApp({
      config: testConfig({ UPLOAD_DIR: uploadDir }),
      logger: false,
      db: pool,
      now: () => new Date('2026-12-16T14:00:00Z'), // 23 h avant
    });
    try {
      const lateToken = tokenOf(res.json());
      const page = await late.inject({ url: `/rdv/${lateToken}` });
      expect(page.body).toContain('Contacter le salon');
      expect(page.body).not.toContain('Déplacer le rendez-vous');
      const csrf = /name="_csrf" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
      const cookie = page.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      await late.inject({
        method: 'POST',
        url: `/rdv/${lateToken}/annuler`,
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ _csrf: csrf }).toString(),
      });
      const { rows } = await pool.query(
        'SELECT status FROM appointments WHERE manage_token_hash = $1',
        [hashToken(lateToken)],
      );
      expect(rows[0].status).toBe('confirmed');
      expect((await late.inject({ url: `/rdv/${lateToken}/deplacer` })).statusCode).toBe(303);
    } finally {
      await late.close();
    }
  });
});

describe('flux iCal privé', () => {
  it('404 sans jeton configuré ou avec un mauvais jeton, données minimales sinon', async () => {
    const off = await makeApp({ ICAL_FEED_TOKEN: '' });
    const on = await makeApp();
    try {
      expect((await off.inject({ url: `/agenda/${FEED_TOKEN}.ics` })).statusCode).toBe(404);
      expect((await on.inject({ url: `/agenda/${'g'.repeat(40)}.ics` })).statusCode).toBe(404);
      const res = await on.inject({ url: `/agenda/${FEED_TOKEN}.ics` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.body).toContain('BEGIN:VEVENT');
      expect(res.body).toContain('Awa D.');
      expect(res.body).not.toContain(EMAIL_DOMAIN);
      expect(res.body).not.toContain('+336');
    } finally {
      await off.close();
      await on.close();
    }
  });
});

describe('adaptateur BOOKING_PROVIDER=fresha_link', () => {
  it('redirige /reserver vers Fresha, coupe l’API, et les boutons pointent vers Fresha', async () => {
    const fresha = 'https://www.fresha.com/book-now/atelier-des-locks';
    const app = await makeApp({ BOOKING_PROVIDER: 'fresha_link', FRESHA_BOOKING_URL: fresha });
    try {
      const res = await app.inject({ url: '/reserver' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(fresha);
      expect(
        (
          await app.inject({
            url: '/api/booking/slots?service=bain-detox&from=2026-12-01&to=2026-12-01',
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ method: 'POST', url: '/api/booking/appointments' })).statusCode,
      ).toBe(404);
      const home = await app.inject({ url: '/' });
      expect(home.body).toContain(`href="${fresha}"`);
      expect(home.body).not.toContain('href="/reserver"');
      expect((await app.inject({ url: '/sitemap.xml' })).body).not.toContain('/reserver');
    } finally {
      await app.close();
    }
  }, 30_000);
});
