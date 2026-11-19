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
});
