// @ts-check
/** Briques pures de la réservation : jetons, anti-bot, iCalendar, photo, validation. */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TOKEN_RE, generateToken, hashToken, safeEqual } from './tokens.js';
import { createChallenge, createVerifier, encodeSolution, solveChallenge } from './anti-bot.js';
import { buildCalendar, escapeText, foldLine, googleCalendarUrl, icsDate } from './ics.js';
import {
  MAX_PHOTO_BYTES,
  UploadError,
  detectImageType,
  removePhoto,
  sanitizePhoto,
  storePhoto,
} from './upload.js';
import { bookingForm, normalizePhone } from './schemas.js';

describe('jetons « Gérer mon RDV »', () => {
  it('32 octets aléatoires en base64url, empreinte SHA-256', () => {
    const { token, hash } = generateToken();
    expect(token).toMatch(TOKEN_RE);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toEqual(hashToken(token));
    expect(hash).toHaveLength(32);
    expect(generateToken().token).not.toBe(token);
  });

  it('safeEqual compare sans fuite de longueur', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcdef')).toBe(false);
  });
});

describe('anti-bot (preuve de travail)', () => {
  const key = 'k'.repeat(32);
  const now = new Date('2026-12-01T10:00:00Z');
  const solved = () => {
    const c = createChallenge({ key, now, maxNumber: 2000 });
    return encodeSolution(c, /** @type {number} */ (solveChallenge(c)));
  };

  it('accepte une solution valide, une seule fois', () => {
    const verify = createVerifier({ key });
    const payload = solved();
    expect(verify(payload, now)).toBe(true);
    expect(verify(payload, now)).toBe(false);
  });

  it('refuse un défi expiré, une signature d’une autre clé, un mauvais nombre, du bruit', () => {
    const verify = createVerifier({ key });
    expect(verify(solved(), new Date(now.getTime() + 21 * 60_000))).toBe(false);
    expect(createVerifier({ key: 'autre'.repeat(8) })(solved(), now)).toBe(false);
    const c = createChallenge({ key, now, maxNumber: 2000 });
    expect(verify(encodeSolution(c, /** @type {number} */ (solveChallenge(c)) + 1), now)).toBe(
      false,
    );
    for (const junk of ['', 'pas du base64', Buffer.from('{}').toString('base64'), 42, null]) {
      expect(verify(junk, now)).toBe(false);
    }
  });

  it('refuse un sel modifié pour repousser l’expiration', () => {
    const verify = createVerifier({ key });
    const c = createChallenge({ key, now, maxNumber: 2000 });
    const forged = { ...c, salt: c.salt.replace(/expires=\d+/, 'expires=9999999999') };
    expect(verify(encodeSolution(forged, /** @type {number} */ (solveChallenge(c))), now)).toBe(
      false,
    );
  });
});

describe('iCalendar', () => {
  it('dates UTC, échappement et pliage à 75 octets', () => {
    expect(icsDate(new Date('2026-12-01T08:00:00.000Z'))).toBe('20261201T080000Z');
    expect(escapeText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
    const folded = foldLine(`DESCRIPTION:${'é'.repeat(80)}`);
    for (const line of folded.split('\r\n'))
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(
      folded
        .split('\r\n')
        .slice(1)
        .every((l) => l.startsWith(' ')),
    ).toBe(true);
  });

  it('produit un calendrier valide (CRLF, un VEVENT par RDV)', () => {
    const ics = buildCalendar({
      name: 'L’Atelier des Locks',
      now: new Date('2026-11-20T10:00:00Z'),
      events: [
        {
          uid: 'abc@atelier',
          startsAt: new Date('2026-12-01T08:00:00Z'),
          endsAt: new Date('2026-12-01T14:00:00Z'),
          summary: 'Création de locks, L’Atelier des Locks',
          location: '1 rue X, Toulouse',
        },
      ],
    });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261201T080000Z');
    expect(ics).toContain('LOCATION:1 rue X\\, Toulouse');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });

  it('le lien Google Agenda porte les dates UTC', () => {
    const url = new URL(
      googleCalendarUrl({
        title: 'RDV',
        startsAt: new Date('2026-12-01T08:00:00Z'),
        endsAt: new Date('2026-12-01T09:00:00Z'),
        details: 'Venez cheveux propres',
        location: 'Toulouse',
      }),
    );
    expect(url.hostname).toBe('calendar.google.com');
    expect(url.searchParams.get('dates')).toBe('20261201T080000Z/20261201T090000Z');
  });
});

describe('photo des cheveux', () => {
  const png = () =>
    sharp({ create: { width: 40, height: 30, channels: 3, background: '#a0522d' } })
      .png()
      .toBuffer();

  it('détecte le type réel par les magic bytes', async () => {
    expect(detectImageType(await png())).toBe('png');
    expect(
      detectImageType(
        await sharp(await png())
          .jpeg()
          .toBuffer(),
      ),
    ).toBe('jpeg');
    expect(
      detectImageType(
        await sharp(await png())
          .webp()
          .toBuffer(),
      ),
    ).toBe('webp');
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull();
  });

  it('ré-encode en WebP et supprime les métadonnées EXIF', async () => {
    const withExif = await sharp(await png())
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret', ImageDescription: 'GPS ici' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const clean = await sanitizePhoto(withExif);
    const meta = await sharp(clean).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
  });

  it('réduit les grandes images à 2000 px', async () => {
    const big = await sharp({
      create: { width: 4000, height: 1000, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer();
    expect((await sharp(await sanitizePhoto(big)).metadata()).width).toBe(2000);
  });

  it('refuse un faux fichier image, un fichier tronqué et un fichier trop lourd', async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('<script>')]);
    await expect(sanitizePhoto(Buffer.from('#!/bin/sh\nrm -rf /'))).rejects.toMatchObject({
      code: 'bad_type',
    });
    await expect(sanitizePhoto(fake)).rejects.toMatchObject({ code: 'unreadable' });
    await expect(sanitizePhoto(Buffer.alloc(MAX_PHOTO_BYTES + 1))).rejects.toBeInstanceOf(
      UploadError,
    );
  });

  it('stocke sous un nom aléatoire, hors webroot, et sait le supprimer', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'adl-upload-'));
    try {
      const relative = await storePhoto(dir, await sanitizePhoto(await png()));
      expect(relative).toMatch(/^hair\/[0-9a-f-]{36}\.webp$/);
      expect(await readdir(path.join(dir, 'hair'))).toHaveLength(1);
      await removePhoto(dir, '../../etc/passwd'); // chemin refusé, sans effet
      await removePhoto(dir, relative);
      expect(await readdir(path.join(dir, 'hair'))).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('validation du formulaire', () => {
  it.each([
    ['06 12 34 56 78', '+33612345678'],
    ['06.12.34.56.78', '+33612345678'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['+33 (0)6 12 34 56 78', '+33612345678'],
    ['0033612345678', '+33612345678'],
    ['+32 470 12 34 56', '+32470123456'],
    ['+1 (514) 555-0199', '+15145550199'],
  ])('normalise %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(['', '12', '06 12 34', '+33 6 12 34 56 78 9', 'abc', '+0612345678'])(
    'refuse « %s »',
    (raw) => {
      expect(normalizePhone(raw)).toBeNull();
    },
  );

  const valid = {
    service: 'creation-locks',
    options: ['3', '3', '4'],
    startsAt: '2026-12-01T08:00:00.000Z',
    firstName: ' Awa ',
    lastName: 'Diallo',
    email: 'Awa@Exemple.FR',
    phone: '06 12 34 56 78',
    hairState: 'natural',
    policy: 'on',
    smsReminders: 'on',
  };

  it('accepte un formulaire complet et normalise', () => {
    const data = bookingForm.parse(valid);
    expect(data).toMatchObject({
      options: [3, 4],
      firstName: 'Awa',
      email: 'awa@exemple.fr',
      phone: '+33612345678',
      policy: true,
      smsReminders: true,
      newsletter: false,
    });
    expect(data.startsAt).toEqual(new Date('2026-12-01T08:00:00Z'));
  });

  it('exige la politique de RDV, un état de cheveux connu, un email valide', () => {
    expect(bookingForm.safeParse({ ...valid, policy: undefined }).success).toBe(false);
    expect(bookingForm.safeParse({ ...valid, hairState: 'autre' }).success).toBe(false);
    expect(bookingForm.safeParse({ ...valid, email: 'awa@' }).success).toBe(false);
    expect(bookingForm.safeParse({ ...valid, startsAt: 'demain' }).success).toBe(false);
    expect(bookingForm.safeParse({ ...valid, options: ['1; DROP TABLE'] }).success).toBe(false);
  });
});
