// The glass panels, as far as a Node process can check them.
//
// The refraction itself needs a browser and is covered in tests/browser/run.js.
// What matters here is the policy in lib/glass.js — the part a reader can lose:
// a gate wired the wrong way either shows an effect someone asked not to see,
// or hides the row from everybody. And the library the whole thing hangs on has
// to be vendored, licensed and pinned, because nothing is fetched at build time.

import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'

const root = new URL('../../', import.meta.url)

// A fresh copy of lib/glass.js per scenario. The module reads the stored
// preference once and keeps it, so a second scenario against the same instance
// would inherit the first one's answer; a different query string makes the
// import machinery treat it as a different module.
let cases = 0
async function freshModule({storage = {}, broken = false, reduced = false} = {}) {
  globalThis.localStorage = broken
    ? {
        getItem() {
          throw new Error('storage refused')
        },
        setItem() {
          throw new Error('storage refused')
        },
      }
    : {
        getItem: (key) => (key in storage ? storage[key] : null),
        setItem: (key, value) => {
          storage[key] = value
        },
      }
  globalThis.matchMedia = (query) => ({
    matches: query.includes('prefers-reduced-transparency') && reduced,
  })
  // Enough of a document for the root class. Every surface starts hidden, so
  // nothing in this file needs one that lays out.
  globalThis.document = {documentElement: {classList: {toggle() {}}}}
  cases += 1
  return import(new URL(`../../lib/glass.js?case=${cases}`, import.meta.url))
}

test('glass is on unless it has been switched off', async () => {
  const glass = await freshModule()
  assert.equal(glass.glassAvailable(), true)
  assert.equal(glass.glassEnabled(), true, 'on by default')

  const off = await freshModule({storage: {'textarea:glass': 'off'}})
  assert.equal(off.glassEnabled(), false)
})

test('a reader asking for reduced transparency gets nothing', async () => {
  // The stored choice must not win over the system: this is the case where a
  // gate wired the wrong way would show the effect anyway.
  const stored = await freshModule({storage: {'textarea:glass': 'on'}, reduced: true})
  assert.equal(stored.glassAvailable(), false)
  assert.equal(stored.glassEnabled(), false)

  const fresh = await freshModule({reduced: true})
  assert.equal(fresh.glassEnabled(), false, 'nor does the default sneak through')
})

test('storage that throws gives the default and still takes the switch', async () => {
  const glass = await freshModule({broken: true})
  assert.equal(glass.glassEnabled(), true)

  glass.setGlassEnabled(false)
  assert.equal(glass.glassEnabled(), false, 'the choice holds for the session')
  glass.setGlassEnabled(true)
  assert.equal(glass.glassEnabled(), true)
})

test('the switch persists in both directions', async () => {
  const storage = {}
  const glass = await freshModule({storage})
  glass.setGlassEnabled(false)
  assert.equal(storage['textarea:glass'], 'off')
  assert.equal(glass.glassEnabled(), false)
  glass.setGlassEnabled(true)
  assert.equal(storage['textarea:glass'], 'on')
  assert.equal(glass.glassEnabled(), true)
})

test('releasing a surface twice is safe', async () => {
  const glass = await freshModule()
  const release = glass.trackGlass({isConnected: true})
  assert.equal(typeof release, 'function')
  release()
  release()
})

test('the liquid-glass module is vendored whole, with its licence', async () => {
  const source = await readFile(new URL('vendor/liquid-glass/liquid-glass.js', root), 'utf8')
  const licence = await readFile(new URL('vendor/liquid-glass/LICENSE', root), 'utf8')

  // One classic script exposing one function, with no imports of its own —
  // loadable by injection with nothing to build, which is why this library was
  // chosen over the two that were not.
  assert.match(source, /global\.liquidGlass = liquidGlass/)
  assert.ok(!/^\s*(?:import|export)\s/m.test(source), 'a classic script, not a module')
  assert.match(licence, /MIT License/)
  assert.match(licence, /Copyright \(c\) 2026 Deepika Rao/)
})

test('vendor/README.md records where the module came from', async () => {
  const readme = await readFile(new URL('vendor/README.md', root), 'utf8')
  assert.match(readme, /deepika-builds\/liquid-glass/)
  // Upstream has no tags, so the commit is the only version there is.
  assert.match(readme, /98ed97bd99def529493fd37177228810f6422f6d/)
})

test('the menu carries the glass row between the theme and the columns', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8')
  const theme = html.indexOf('id="menu-theme"')
  const glass = html.indexOf('id="menu-glass"')
  const columns = html.indexOf('id="menu-columns"')
  assert.ok(theme !== -1 && glass !== -1 && columns !== -1, 'all three rows exist')
  assert.ok(theme < glass && glass < columns, 'the row sits after Theme and before the columns')

  assert.match(
    html,
    /<button id="menu-glass" class="item" type="button" role="menuitemcheckbox" aria-checked="true">/,
  )
  assert.match(html, /<span id="menu-glass-label">Glass: on<\/span>/)
  assert.match(html, /<use xlink:href="#icon-water-drop"><\/use>/)
})
