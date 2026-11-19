// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/', 'dist/', 'coverage/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  {
    files: ['src/server/**/*.js', 'scripts/**/*.js', '*.config.js', 'tests/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/client/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  prettier,
];
