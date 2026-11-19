// @ts-check
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { SESSION_SECRET: 'x'.repeat(48) };
const prod = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'Zq3v9Lk2Pw8TnYb5Hd7Xc1RaE4MjUs6GfIo0VtNiKyBu',
  PUBLIC_URL: 'https://exemple.fr',
  DATABASE_URL: 'postgres://atelier:motdepasse-fort@db:5432/atelier',
  NOTIFICATIONS_PROVIDER: 'brevo',
  BREVO_API_KEY: 'cle',
  BREVO_SENDER_EMAIL: 'salon@exemple.fr',
};

describe('loadConfig', () => {
  it('applique des valeurs par défaut sûres', () => {
    const config = loadConfig(base);
    expect(config.env).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.booking.provider).toBe('internal');
    expect(config.styleguideEnabled).toBe(true);
  });

  it('désactive le styleguide par défaut en production', () => {
    const config = loadConfig({ ...prod });
    expect(config.isProd).toBe(true);
    expect(config.styleguideEnabled).toBe(false);
  });

  it('production : refuse les valeurs d’exemple et de développement', () => {
    expect(() =>
      loadConfig({ ...prod, SESSION_SECRET: 'remplacer-par-un-secret-long-et-aleatoire-00' }),
    ).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...prod, SESSION_SECRET: 'a'.repeat(32) })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...prod, PUBLIC_URL: 'http://exemple.fr' })).toThrow(/PUBLIC_URL/);
    expect(() =>
      loadConfig({ ...prod, DATABASE_URL: 'postgres://atelier:atelier_dev@db/x' }),
    ).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...prod, NOTIFICATIONS_PROVIDER: 'console' })).toThrow(
      /NOTIFICATIONS_PROVIDER/,
    );
  });

  it('proxys de confiance : Caddy local par défaut', () => {
    expect(loadConfig(base).trustProxy).toEqual(['127.0.0.1', '::1']);
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).trustProxy).toEqual([
      '10.0.0.0/8',
      '127.0.0.1',
    ]);
  });

  it('refuse un secret de session trop court', () => {
    expect(() => loadConfig({ SESSION_SECRET: 'court' })).toThrow(/SESSION_SECRET/);
  });

  it('exige le lien Fresha quand le fournisseur est fresha_link', () => {
    expect(() => loadConfig({ ...base, BOOKING_PROVIDER: 'fresha_link' })).toThrow(
      /FRESHA_BOOKING_URL/,
    );
    const config = loadConfig({
      ...base,
      BOOKING_PROVIDER: 'fresha_link',
      FRESHA_BOOKING_URL: 'https://www.fresha.com/exemple',
    });
    expect(config.booking.freshaUrl).toBe('https://www.fresha.com/exemple');
  });

  it('retire la barre finale de PUBLIC_URL', () => {
    expect(loadConfig({ ...base, PUBLIC_URL: 'https://exemple.fr/' }).publicUrl).toBe(
      'https://exemple.fr',
    );
  });

  it('notifications : fournisseur console par défaut, Brevo exige clé et expéditeur', () => {
    const config = loadConfig(base);
    expect(config.notifications.provider).toBe('console');
    expect(config.notifications.smsSender).toBe('AtelierLock');
    expect(() => loadConfig({ ...base, NOTIFICATIONS_PROVIDER: 'brevo' })).toThrow(/BREVO_API_KEY/);
    const brevo = loadConfig({
      ...base,
      NOTIFICATIONS_PROVIDER: 'brevo',
      BREVO_API_KEY: 'xkeysib-test',
      BREVO_SENDER_EMAIL: 'salon@exemple.fr',
    });
    expect(brevo.notifications.brevoApiKey).toBe('xkeysib-test');
  });

  it('expéditeur SMS : 11 caractères alphanumériques au maximum', () => {
    expect(() => loadConfig({ ...base, SMS_SENDER: 'Atelier des Locks' })).toThrow(/SMS_SENDER/);
    expect(() => loadConfig({ ...base, SMS_SENDER: 'AtelierLocks1' })).toThrow(/SMS_SENDER/);
    expect(loadConfig({ ...base, SMS_SENDER: 'AtelierLock' }).notifications.smsSender).toBe(
      'AtelierLock',
    );
  });

  it('lien d’avis Google : URL valide ou vide', () => {
    expect(loadConfig(base).reviews.googleUrl).toBe('');
    expect(() => loadConfig({ ...base, GOOGLE_REVIEW_URL: 'pas une url' })).toThrow(
      /GOOGLE_REVIEW_URL/,
    );
  });
});
