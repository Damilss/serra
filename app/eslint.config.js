// ESLint (flat config) for app/: the mockup's inline <script>, the Playwright tests and the
// Node scripts. Formatting is Prettier's job; eslint-config-prettier turns off the style rules
// that would fight it.

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import html from 'eslint-plugin-html';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'test-results/', 'playwright-report/', 'blob-report/', 'supabase/'] },

  js.configs.recommended,

  // Browser code inside HTML files (a classic script, not a module).
  {
    files: ['**/*.html'],
    plugins: { html },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: globals.browser },
  },

  // Node: config files, scripts and tests.
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },

  // Playwright tests also run functions inside the page (page.evaluate), so allow browser globals.
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },

  prettier,
];
