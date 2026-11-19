// @ts-check
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: 'tests/e2e',
  // Les réservations e2e (emails « @e2e.test.invalid ») sont supprimées avant et après la suite.
  globalSetup: './tests/e2e/cleanup.js',
  globalTeardown: './tests/e2e/cleanup.js',
  fullyParallel: true,
  // En local, un seul worker par défaut : plusieurs Chromium + Vite + PostgreSQL (Docker) en
  // parallèle saturent une machine modeste, et les requêtes de l'API restent sans réponse.
  // E2E_WORKERS=4 npm run test:e2e pour paralléliser sur une machine plus puissante.
  workers: process.env.CI ? undefined : Number(process.env.E2E_WORKERS ?? 1),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'node src/server/index.js',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      NODE_ENV: 'development',
      SESSION_SECRET: 'e2e-'.padEnd(48, 'x'),
      // Les tests réservent plusieurs fois depuis la même adresse.
      BOOKING_RATE_LIMIT: '1000',
      UPLOAD_DIR: 'storage/e2e-uploads',
    },
    timeout: 60_000,
  },
});
