// @ts-check
/**
 * Messages (emails HTML + texte, SMS) : contenu, limites SMS, échappement, canaux indisponibles.
 */
import { describe, expect, it } from 'vitest';
import { QUEUES } from './plan.js';
import { SMS_MAX, buildMessages, toGsm } from './messages.js';
import { createBrevoProvider, createConsoleProvider, maskEmail, maskPhone } from './providers.js';
import { openToken, sealToken } from './seal.js';

const NOW = new Date('2026-11-20T10:00:00Z');
const SITE = {
  name: "L'Atelier des Locks",
  phone: '',
  address: { street: 'Adresse à confirmer', postalCode: '31000', city: 'Toulouse' },
};
const ENV = {
  publicUrl: 'https://atelier-des-locks.example',
  site: SITE,
  ownerEmail: 'proprio@example.test',
  bookingUrl: 'https://atelier-des-locks.example/reserver',
  cancellationHours: 48,
  tips: ['Venez cheveux propres.', 'Gardez votre photo sous la main.'],
};
const CTX = {
  appointmentId: 'a1',
  status: 'confirmed',
  startsAt: new Date('2026-12-01T08:00:00Z'),
  durationMinutes: 150,
  serviceName: 'Resserrage palm rolling',
  options: ['Soin cuir chevelu'],
  price: 80,
  priceFrom: false,
  hairState: 'Locks de plus d’un an',
  clientNotes: null,
  hasPhoto: false,
  firstName: 'Awa',
  lastName: 'Diallo',
  email: 'awa@example.test',
  phone: '+33612345678',
  smsReminders: true,
  anonymized: false,
  hasReview: false,
  updatedAt: NOW,
};
const TOKEN = 'T'.repeat(43);
const LINKS = {
  manageUrl: `${ENV.publicUrl}/rdv/${TOKEN}`,
  reviewUrl: `${ENV.publicUrl}/avis/laisser/${TOKEN}`,
};
const data = (/** @type {object} */ extra = {}) => ({
  appointmentId: 'a1',
  dedupeKey: 'k',
  ...extra,
});
const build = (
  /** @type {string} */ queue,
  /** @type {object} */ ctx = {},
  /** @type {object} */ extra = {},
) =>
  buildMessages({
    queue,
    data: data(extra),
    ctx: { ...CTX, ...ctx },
    env: ENV,
    links: LINKS,
    now: NOW,
  });

describe('SMS', () => {
  const sms = (/** @type {import('./messages.js').OutgoingMessage[]} */ list) =>
    list.filter((m) => m.channel === 'sms');
  const all = [
    build(QUEUES.confirmation).messages,
    build(QUEUES.confirmation, { status: 'pending' }).messages,
    build(QUEUES.change, {}, { kind: 'rescheduled' }).messages,
    build(QUEUES.change, {}, { kind: 'cancelled_by_client' }).messages,
    build(QUEUES.change, {}, { kind: 'cancelled_by_salon' }).messages,
    build(QUEUES.reminderD1).messages,
  ].flatMap(sms);

  it('ne dépasse jamais 160 caractères, même avec un lien à jeton', () => {
    expect(all.length).toBe(6);
    for (const m of all)
      expect(/** @type {any} */ (m.payload).text.length).toBeLessThanOrEqual(SMS_MAX);
  });

  it('reste en alphabet GSM (pas de accent hors GSM, pas de guillemet typographique) et sans STOP', () => {
    for (const m of all) {
      const text = /** @type {any} */ (m.payload).text;
      expect(text).not.toMatch(/[êîôûâëïç’“”…–—]/);
      expect(text).not.toMatch(/stop/i);
      expect(text).toContain(`${ENV.publicUrl}/`);
    }
  });

  it('le lien n’est jamais tronqué, même avec un nom de salon très long', () => {
    const long = buildMessages({
      queue: QUEUES.confirmation,
      data: data(),
      ctx: CTX,
      env: { ...ENV, site: { ...SITE, name: 'Atelier '.repeat(30) } },
      links: LINKS,
      now: NOW,
    });
    const text = /** @type {any} */ (sms(long.messages)[0].payload).text;
    expect(text.length).toBeLessThanOrEqual(SMS_MAX);
    expect(text.endsWith(LINKS.manageUrl)).toBe(true);
  });

  it('toGsm retire les accents absents de GSM et garde les autres', () => {
    expect(toGsm('Ça va très bien, île ô forêt…')).toBe('Ça va très bien, ile o foret...');
    expect(toGsm('L’Atelier « test »')).toBe('L\'Atelier " test "'.replace('" test "', '" test "'));
  });

  it('SMS ignoré avec la raison : opposition, ou pas de téléphone', () => {
    const optOut = build(QUEUES.confirmation, { smsReminders: false });
    expect(sms(optOut.messages)).toEqual([]);
    expect(optOut.skipped).toEqual([
      expect.objectContaining({ channel: 'sms', reason: 'sms_opt_out' }),
    ]);
    expect(build(QUEUES.reminderD1, { phone: null }).skipped[0].reason).toBe('no_phone');
  });
});

describe('emails', () => {
  const first = (/** @type {string} */ queue, ctx = {}, extra = {}) => {
    const m = build(queue, ctx, extra).messages.find((x) => x.channel === 'email');
    return /** @type {any} */ (m).payload;
  };

  it('confirmation : HTML responsive aux couleurs de la marque, lien, détails, .ics joint', () => {
    const p = first(QUEUES.confirmation);
    expect(p.subject).toBe('Votre rendez-vous du mardi 1er décembre 2026 à 9h est confirmé');
    expect(p.html).toContain('<meta name="viewport"');
    expect(p.html).toContain('@media only screen and (max-width: 620px)');
    expect(p.html).toContain('#A9472E'); // terre cuite
    expect(p.html).toContain('#1C1310'); // ébène
    expect(p.html).toContain('Bodoni 72'); // police de secours
    expect(p.html).toContain('Helvetica Neue');
    expect(p.html).toContain(`${ENV.publicUrl}/brand/logo-email.png`);
    expect(p.html).toContain(`href="${LINKS.manageUrl}"`);
    expect(p.html).toContain('Resserrage palm rolling');
    expect(p.html).toContain('Venez cheveux propres.');
    expect(p.html).not.toContain('<script');
    expect(p.text).toContain(LINKS.manageUrl);
    expect(p.attachments[0].name).toMatch(/\.ics$/);
    expect(p.attachments[0].content).toContain('BEGIN:VCALENDAR');
  });

  it('confirmation en attente de validation : message adapté', () => {
    const p = first(QUEUES.confirmation, { status: 'pending' });
    expect(p.subject).toBe('Votre demande de rendez-vous est bien reçue');
  });

  it('échappe le contenu saisi par la cliente (pas d’injection HTML)', () => {
    const p = first(QUEUES.confirmation, {
      firstName: '<img src=x onerror=alert(1)>',
      serviceName: '"><script>x</script>',
    });
    expect(p.html).not.toContain('<img src=x');
    expect(p.html).not.toContain('<script>x');
    expect(p.html).toContain('&lt;img');
  });

  it('J-2 : rappel avec conseils ; annulation : lien pour reprendre rendez-vous', () => {
    expect(first(QUEUES.reminderD2).subject).toMatch(/^Dans 2 jours/);
    const cancel = first(QUEUES.change, {}, { kind: 'cancelled_by_client' });
    expect(cancel.html).toContain(ENV.bookingUrl);
    expect(cancel.attachments).toBeUndefined();
    expect(first(QUEUES.change, {}, { kind: 'rescheduled' }).attachments).toHaveLength(1);
  });

  it('demande d’avis et relance : lien personnel, validité 30 jours', () => {
    for (const q of [QUEUES.reviewRequest, QUEUES.reviewReminder]) {
      const p = first(q, { status: 'completed' });
      expect(p.html).toContain(LINKS.reviewUrl);
      expect(p.text).toContain('30 jours');
    }
  });

  it('alerte propriétaire : envoyée à OWNER_EMAIL avec les coordonnées ; sans adresse, ignorée', () => {
    const owner = build(QUEUES.ownerAlert, {}, { kind: 'created' });
    expect(owner.messages[0].recipient).toBe('proprio@example.test');
    expect(/** @type {any} */ (owner.messages[0].payload).text).toContain('awa@example.test');
    const none = buildMessages({
      queue: QUEUES.ownerAlert,
      data: data(),
      ctx: CTX,
      env: { ...ENV, ownerEmail: '' },
      now: NOW,
    });
    expect(none.messages).toEqual([]);
    expect(none.skipped[0].reason).toBe('no_owner_email');
  });

  it('sans jeton de gestion, aucun bouton mais le message part', () => {
    const r = buildMessages({
      queue: QUEUES.confirmation,
      data: data(),
      ctx: CTX,
      env: ENV,
      now: NOW,
    });
    expect(/** @type {any} */ (r.messages[0].payload).html).not.toContain('Gérer mon rendez-vous');
  });
});

describe('fournisseurs', () => {
  it('console : masque les destinataires et garde une boîte d’envoi', async () => {
    /** @type {string[]} */
    const lines = [];
    const provider = createConsoleProvider({ log: (l) => lines.push(l) });
    await provider.sendEmail({
      to: { email: 'awa@example.test', name: 'Awa' },
      subject: 'S',
      html: '<p>x</p>',
      text: 'x',
    });
    await provider.sendSms({ to: '+33612345678', text: 'salut' });
    expect(lines.join('\n')).not.toContain('awa@example.test');
    expect(lines.join('\n')).not.toContain('+33612345678');
    expect(provider.outbox).toHaveLength(2);
    expect(maskEmail('awa@example.test')).toBe('a***@example.test');
    expect(maskPhone('+33612345678')).toBe('+336****5678');
  });

  /** @param {number} status @param {object} body */
  const fakeFetch = (status, body) => {
    /** @type {{ url: string, init: any }[]} */
    const calls = [];
    const impl = /** @type {typeof fetch} */ (
      async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify(body), { status });
      }
    );
    return { impl, calls };
  };
  const brevo = (/** @type {typeof fetch} */ fetchImpl) =>
    createBrevoProvider({
      apiKey: 'cle-test',
      senderEmail: 'salon@example.test',
      senderName: 'Salon',
      smsSender: 'AtelierLock',
      fetchImpl,
    });

  it('Brevo email : endpoint, clé en en-tête, pièce jointe en base64', async () => {
    const { impl, calls } = fakeFetch(201, { messageId: '<abc@brevo>' });
    const res = await brevo(impl).sendEmail({
      to: { email: 'awa@example.test', name: 'Awa' },
      subject: 'S',
      html: '<p>x</p>',
      text: 'x',
      attachments: [{ name: 'a.ics', contentType: 'text/calendar', content: 'BEGIN' }],
      tag: 'booking_confirmation',
    });
    expect(res.messageId).toBe('<abc@brevo>');
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0].init.headers['api-key']).toBe('cle-test');
    const body = JSON.parse(calls[0].init.body);
    expect(body.sender).toEqual({ email: 'salon@example.test', name: 'Salon' });
    expect(body.attachment[0].content).toBe(Buffer.from('BEGIN').toString('base64'));
    expect(body.tags).toEqual(['booking_confirmation']);
  });

  it('Brevo SMS : expéditeur alphanumérique, numéro sans « + », type transactionnel', async () => {
    const { impl, calls } = fakeFetch(201, { messageId: 42 });
    await brevo(impl).sendSms({ to: '+33612345678', text: 'Bonjour' });
    expect(calls[0].url).toBe('https://api.brevo.com/v3/transactionalSMS/sms');
    expect(JSON.parse(calls[0].init.body)).toMatchObject({
      sender: 'AtelierLock',
      recipient: '33612345678',
      type: 'transactional',
    });
  });

  it('erreurs : 4xx définitive, 429 et 5xx rejouables, réseau rejouable', async () => {
    const msg = { to: { email: 'a@example.test', name: 'A' }, subject: 'S', html: 'h', text: 't' };
    await expect(
      brevo(fakeFetch(400, { message: 'invalid' }).impl).sendEmail(msg),
    ).rejects.toMatchObject({ retryable: false, status: 400 });
    await expect(
      brevo(fakeFetch(401, { message: 'Key not found' }).impl).sendEmail(msg),
    ).rejects.toMatchObject({ retryable: false });
    await expect(brevo(fakeFetch(429, {}).impl).sendEmail(msg)).rejects.toMatchObject({
      retryable: true,
    });
    await expect(brevo(fakeFetch(503, {}).impl).sendEmail(msg)).rejects.toMatchObject({
      retryable: true,
    });
    const down = /** @type {typeof fetch} */ (
      async () => {
        throw new Error('ECONNRESET');
      }
    );
    await expect(brevo(down).sendEmail(msg)).rejects.toMatchObject({ retryable: true });
  });
});

describe('scellement du jeton', () => {
  const secret = 's'.repeat(48);
  it('aller-retour, et le jeton en clair n’apparaît pas dans la charge', () => {
    const sealed = sealToken(TOKEN, secret);
    expect(sealed).not.toContain(TOKEN);
    expect(openToken(sealed, secret)).toBe(TOKEN);
  });
  it('deux scellements du même jeton diffèrent (IV aléatoire)', () => {
    expect(sealToken(TOKEN, secret)).not.toBe(sealToken(TOKEN, secret));
  });
  it('refuse une charge altérée, une autre clé, ou une valeur absente', () => {
    const sealed = sealToken(TOKEN, secret);
    const tampered = `${sealed.slice(0, -2)}${sealed.endsWith('A') ? 'B' : 'A'}A`;
    expect(openToken(tampered, secret)).toBeNull();
    expect(openToken(sealed, 'autre'.repeat(10))).toBeNull();
    expect(openToken(undefined, secret)).toBeNull();
    expect(openToken('court', secret)).toBeNull();
  });
});
