// ESLint (flat config) for app/: the Next.js app (TypeScript + React), the Playwright tests, the Node
// scripts and the design mockup's inline <script>. Formatting is Prettier's job;
// eslint-config-prettier turns off the style rules that would fight it.

import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import html from 'eslint-plugin-html';
import globals from 'globals';

// Next's configs are scoped to the app's own source, so its React rules don't apply to tests and scripts.
const appOnly = (configs) => configs.map((c) => ({ ...c, files: ['src/**/*.{ts,tsx}'] }));

const config = [
  {
    ignores: [
      'node_modules/',
      '.next/',
      'out/',
      'next-env.d.ts',
      'test-results/',
      'playwright-report/',
      'blob-report/',
      'supabase/',
    ],
  },

  js.configs.recommended,

  // Next.js app: React, hooks, Next rules and TypeScript.
  ...appOnly(nextVitals),
  ...appOnly(nextTs),
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },

  // The design mockup: browser code inside HTML (a classic script, not a module).
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
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs,html}'],
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },

  prettier,
];

export default config;
