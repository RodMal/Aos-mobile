// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The game core must stay free of the UI and of browser/Node APIs so it runs in a Web Worker,
// in Node tests and in simulations unchanged.
const CORE = ['src/geom/**/*.ts', 'src/engine/**/*.ts', 'src/rules/**/*.ts', 'src/ai/**/*.ts'];
const CORE_MSG =
  'The game core (geom, engine, rules, ai) must not import UI code, React, or Node built-ins.';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.claude/**',
      'dist/**',
      'data/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/*.{ts,tsx}', 'src/worker/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: CORE,
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/ui/**', '**/worker/**'], message: CORE_MSG },
            { group: ['react', 'react-dom', 'zustand', 'zustand/*'], message: CORE_MSG },
            { regex: '^node:', message: CORE_MSG },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: CORE_MSG },
        { name: 'document', message: CORE_MSG },
        { name: 'process', message: CORE_MSG },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in GameState.' },
        { object: 'Date', property: 'now', message: 'The core must be deterministic.' },
      ],
    },
  },
);
