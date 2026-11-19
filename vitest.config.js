// @ts-check
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js', 'scripts/**/*.test.js'],
    environment: 'node',
    globalSetup: ['./src/server/db/test-setup.js'],
    // Les fichiers partagent une base de test : on les exécute l'un après l'autre.
    fileParallelism: false,
    // Tests sur base réelle (transactions, sharp, preuve de travail) : marge pour une machine lente.
    testTimeout: 20_000,
  },
});
