// The shell is precached so the app opens with no network. The vendored
// libraries are not: pdf.js and its worker are 1.7 MB together, and most visits
// never open a PDF. They are cached the first time they are actually fetched, so
// the second PDF opens offline. The QR encoder is the same: a session that only
// types never asks for it.
//
// Bump VERSION whenever anything in SHELL changes. The fetch handler answers
// from the cache before it asks the network, so a returning tab keeps the
// index.html it installed until the name of the cache changes underneath it.

const VERSION = 'v24'
const SHELL_CACHE = `textarea-shell-${VERSION}`
const VENDOR_CACHE = `textarea-vendor-${VERSION}`
// Deliberately not derived from VERSION: the model is 241 MB, and a cache
// name that changed on every release would delete it on every release. The
// chunks carry their own versioning - their names are pinned in
// models/manifest.json, and a new model ships under new names - so a
// cache-first answer here is never stale, and never worth re-paying for.
const MODELS_CACHE = 'textarea-models'

const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/lib/appearance.js',
  '/lib/backlinks-panel.js',
  '/lib/backlinks.js',
  '/lib/backup.js',
  '/lib/clipboard.js',
  '/lib/dialog.js',
  '/lib/encryption-panel.js',
  '/lib/export-panel.js',
  '/lib/export.js',
  '/lib/file-links.js',
  '/lib/find-panel.js',
  '/lib/find.js',
  '/lib/folder-sync.js',
  '/lib/fonts.js',
  '/lib/formats.js',
  '/lib/front-matter.js',
  '/lib/gemma.js',
  '/lib/glass.js',
  '/lib/library-panel.js',
  '/lib/library.js',
  '/lib/markdown.js',
  '/lib/open.js',
  '/lib/pdf-layout.js',
  '/lib/pdf.js',
  '/lib/qr-panel.js',
  '/lib/qr.js',
  '/lib/save.js',
  '/lib/settings-panel.js',
  '/lib/share.js',
  '/lib/stats-panel.js',
  '/lib/stats.js',
  '/lib/style.js',
  '/lib/switcher.js',
  '/lib/tasks-panel.js',
  '/lib/theme.js',
  '/lib/writing-tools.js',
  '/lib/zip.js',
]

const isVendored = (url) => url.pathname.startsWith('/vendor/')

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // One missing file must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  const current = [SHELL_CACHE, VENDOR_CACHE, MODELS_CACHE]
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => !current.includes(name)).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== location.origin) return

  if (isVendored(url)) {
    // Cache first: these files carry a version in their path only by convention,
    // so re-downloading them on every open would waste megabytes.
    event.respondWith(
      caches.open(VENDOR_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        // Range requests must not be cached; the responses are not complete.
        if (response.ok && response.status === 200 && request.headers.get('range') === null) {
          cache.put(request, response.clone())
        }
        return response
      }),
    )
    return
  }

  if (url.pathname.startsWith('/models/')) {
    // Cache first, into a cache that survives releases: the first Load
    // model pays the 241 MB once, and every run after it - including the
    // offline ones - reads the committed bytes back from here. Nothing in
    // the install event touches this cache; see MODELS_CACHE above for
    // why that cache has no version in its name.
    event.respondWith(
      caches.open(MODELS_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok && response.status === 200) {
          cache.put(request, response.clone())
        }
        return response
      }),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request)
        .then((response) => {
          if (response.ok && response.status === 200) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => {
          // Offline and not cached: the navigation fallback is the shell.
          if (request.mode === 'navigate') return caches.match('/index.html')
          return Response.error()
        })
    }),
  )
})
