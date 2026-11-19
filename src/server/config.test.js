// @ts-check
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { SESSION_SECRET: 'x'.repeat(48) };

describe('loadConfig', () => {
  it('applique des valeurs par défaut sûres', () => {
    const config = loadConfig(base);
    expect(config.env).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.booking.provider).toBe('internal');
    expect(config.styleguideEnabled).toBe(true);
  });

  it('désactive le styleguide par défaut en production', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'production' });
    expect(config.isProd).toBe(true);
    expect(config.styleguideEnabled).toBe(false);
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
