// ESLint: correctness only, no style.
//
// Style lives in .editorconfig and is enforced by review, because the rules
// here would otherwise have to encode "no semicolons, single quotes, two
// spaces" — and a linter that only polices formatting would not have caught
// anything that actually broke. eslint:recommended is the part that does:
// undefined names, unused variables, unreachable code, mistyped operators.
//
// The environments are listed per kind of file rather than set globally: a
// service worker has `self` and `caches` and not `document`, and the browser
// tests are Node scripts whose `page.evaluate` callbacks are the only part
// that runs in a page. Declaring both everywhere would hide a real mistake in
// either.

import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: [
      'node_modules/',
      'vendor/',
      'test-results/',
      'tests/fixtures/',
    ],
  },

  js.configs.recommended,

  {
    // The app itself: one HTML file, one shell, plain ES modules.
    files: ['app.js', 'lib/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // The File System Access API is in `globals.browser`, but the launch
        // queue is behind a `if ('launchQueue' in window)` guard anyway, so
        // it is declared here rather than assumed present in every browser.
        launchQueue: 'readonly',
      },
    },
  },

  {
    // sw.js runs in the worker scope: no DOM, no window.
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.serviceworker,
    },
  },

  {
    // Node scripts. tests/browser/run.js also evaluates callbacks inside the
    // page, so it gets the browser globals as well — those callbacks are the
    // only code in it that touches `document`.
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
]
