// @ts-check
/**
 * Aides communes aux tests qui touchent la base (base « _test » préparée par db/test-setup.js).
 */
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';

/**
 * Configuration de test : mêmes réglages que la prod, base de test.
 * @param {Record<string, string>} [overrides]
 */
export function testConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'x'.repeat(48),
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
    ...overrides,
  });
}

/** Pool sur la base de test (à fermer avec pool.end()). */
export function testPool() {
  return createPool(testConfig().databaseUrl);
}
