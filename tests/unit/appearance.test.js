// The appearance preferences: sanitising, storing, applying.
//
// The module takes its storage and its target as arguments, so everything
// below runs without a browser: a map stands in for localStorage and a plain
// object for the root element's style.

import assert from 'node:assert/strict'
import {test} from 'node:test'

import {
  applyAppearance,
  FONTS,
  isCustomFont,
  KEYS,
  LEADING_RANGE,
  readAccent,
  readAppearance,
  readNoteFont,
  readNoteLeading,
  readNoteSize,
  saveAppearance,
  SIZE_RANGE,
} from '../../lib/appearance.js'

/** A localStorage the tests can read back. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    keys: () => [...map.keys()],
  }
}

/** A storage that refuses every operation, the way a locked-down browser does. */
const refusedStorage = {
  getItem() {
    throw new Error('denied')
  },
  setItem() {
    throw new Error('denied')
  },
  removeItem() {
    throw new Error('denied')
  },
}

/** The root element's style, as far as this module is concerned. */
function fakeRoot() {
  const props = new Map()
  return {
    props,
    style: {
      setProperty: (name, value) => props.set(name, value),
      removeProperty: (name) => props.delete(name),
    },
  }
}

test('appearance: an accent is only trusted as six hex digits', () => {
  assert.equal(readAccent('#007aff'), '#007aff')
  assert.equal(readAccent('#AABBCC'), '#aabbcc', 'the colour is stored lowercase')
  assert.equal(readAccent('red'), null)
  assert.equal(readAccent('rgb(0, 122, 255)'), null)
  assert.equal(readAccent('#fff'), null, 'three digits are not the format')
  assert.equal(readAccent('#007aff00'), null, 'eight digits are not the format')
  assert.equal(readAccent('#007aff '), null, 'no trailing anything')
  assert.equal(readAccent(null), null)
  assert.equal(readAccent(123456), null)
})

test('appearance: the size and spacing are clamped, and nonsense falls back', () => {
  assert.equal(readNoteSize('24'), 24)
  assert.equal(readNoteSize('18.5'), 18.5, 'a half pixel is still a size')
  assert.equal(readNoteSize('999'), SIZE_RANGE.max)
  assert.equal(readNoteSize('-3'), SIZE_RANGE.min)
  assert.equal(readNoteSize(' 20 '), 20)
  assert.equal(readNoteSize('large'), null)
  assert.equal(readNoteSize(''), null)
  assert.equal(readNoteSize(null), null)

  assert.equal(readNoteLeading('2'), 2)
  assert.equal(readNoteLeading('9'), LEADING_RANGE.max)
  assert.equal(readNoteLeading('0'), LEADING_RANGE.min)
  assert.equal(readNoteLeading('loose'), null)
  assert.equal(readNoteLeading(undefined), null)
})

test('appearance: the note font comes from the whitelist', () => {
  for (const font of FONTS) assert.equal(readNoteFont(font.id), font.id)
  assert.equal(readNoteFont('system-ui'), null, 'a raw stack is not an id')
  assert.equal(readNoteFont('Comic Sans MS, cursive'), null)
  assert.equal(readNoteFont(null), null)
})

test('appearance: a custom font id passes on its shape alone', () => {
  // The bytes live elsewhere; all this module can judge is the preference,
  // so the exact shape the shelf writes is the whole whitelist for it.
  assert.equal(readNoteFont('custom-my-font'), 'custom-my-font')
  assert.equal(readNoteFont('custom-fixture'), 'custom-fixture')
  assert.equal(readNoteFont('custom-1'), 'custom-1')
  assert.equal(isCustomFont('custom-my-font'), true)

  assert.equal(readNoteFont('custom-'), null, 'no family after the prefix')
  assert.equal(readNoteFont('custom-My-Font'), null, 'the slug is lowercase')
  assert.equal(readNoteFont('custom-my_font'), null, 'an underscore is not in the shape')
  assert.equal(readNoteFont('custom-my--font'), null, 'one hyphen between words')
  assert.equal(readNoteFont('custom-my font'), null, 'a space is not in the shape')
  assert.equal(readNoteFont('custom-my-font '), null, 'no trailing anything')
  assert.equal(readNoteFont("custom-my-font'; color: red"), null, 'and no declarations')
  assert.equal(isCustomFont('serif'), false)
  assert.equal(isCustomFont(null), false)
})

test('appearance: preferences are read through the sanitizers', () => {
  const storage = memoryStorage({
    [KEYS.accent]: '#FF0000',
    [KEYS.font]: 'serif',
    [KEYS.size]: '26',
    [KEYS.leading]: '2',
  })
  assert.deepEqual(readAppearance(storage), {
    accent: '#ff0000',
    font: 'serif',
    size: 26,
    leading: 2,
  })

  const junk = memoryStorage({
    [KEYS.accent]: 'chartreuse',
    [KEYS.font]: 'papyrus',
    [KEYS.size]: 'enormous',
    [KEYS.leading]: '999',
  })
  assert.deepEqual(readAppearance(junk), {
    accent: null,
    font: null,
    size: null,
    leading: LEADING_RANGE.max,
  })

  assert.deepEqual(readAppearance(memoryStorage()), {
    accent: null,
    font: null,
    size: null,
    leading: null,
  })
})

test('appearance: reading survives storage that refuses', () => {
  assert.deepEqual(readAppearance(refusedStorage), {
    accent: null,
    font: null,
    size: null,
    leading: null,
  })
})

test('appearance: saving writes sanitised values and drops what is unset', () => {
  const storage = memoryStorage()
  saveAppearance(storage, {
    accent: '#FF0000',
    font: 'mono',
    size: 400,
    leading: '2',
  })
  assert.deepEqual(readAppearance(storage), {
    accent: '#ff0000',
    font: 'mono',
    size: SIZE_RANGE.max,
    leading: 2,
  })

  // Everything cleared: the keys go rather than hold a value that would
  // read back as an override.
  saveAppearance(storage, {accent: null, font: 'papyrus', size: null, leading: null})
  assert.deepEqual(storage.keys(), [])

  // A value that fails its own sanitizer is removed, not kept as a lie.
  saveAppearance(storage, {accent: 'chartreuse', font: 'serif', size: 20, leading: 1.4})
  assert.equal(storage.getItem(KEYS.accent), null)
  assert.equal(storage.getItem(KEYS.font), 'serif')
  assert.equal(storage.getItem(KEYS.size), '20')
  assert.equal(storage.getItem(KEYS.leading), '1.4')
})

test('appearance: saving survives storage that refuses', () => {
  saveAppearance(refusedStorage, {accent: '#123456', font: 'serif', size: 20, leading: 1.5})
  // No throw is the assertion: the caller still applies the look in memory.
})

test('appearance: the choices land on the root as custom properties', () => {
  const root = fakeRoot()
  applyAppearance(root, {accent: '#ff0000', font: 'serif', size: 26, leading: 2})
  assert.deepEqual([...root.props], [
    ['--outline', '#ff0000'],
    ['--link', '#ff0000'],
    ['--note-font', 'serif'],
    ['--note-size', '26px'],
    ['--note-leading', '2'],
  ])

  // Nulls are removals on the same element, so the stylesheet's own values
  // show through again: a reset is the state of never having chosen.
  applyAppearance(root, {accent: null, font: null, size: null, leading: null})
  assert.equal(root.props.size, 0, 'every override is taken back off')

  // Out-of-range and unknown values apply clamped or not at all.
  const odd = fakeRoot()
  applyAppearance(odd, {accent: 'red', font: 'papyrus', size: 999, leading: 0.1})
  assert.equal(odd.props.has('--outline'), false)
  assert.equal(odd.props.has('--link'), false)
  assert.equal(odd.props.has('--note-font'), false)
  assert.equal(odd.props.get('--note-size'), `${SIZE_RANGE.max}px`)
  assert.equal(odd.props.get('--note-leading'), String(LEADING_RANGE.min))
})

test('appearance: what is saved is what is applied', () => {
  const storage = memoryStorage()
  const values = {accent: '#123abc', font: 'mono', size: '21', leading: '1.7'}
  saveAppearance(storage, values)

  const root = fakeRoot()
  applyAppearance(root, readAppearance(storage))
  assert.deepEqual([...root.props], [
    ['--outline', '#123abc'],
    ['--link', '#123abc'],
    ['--note-font', 'monospace'],
    ['--note-size', '21px'],
    ['--note-leading', '1.7'],
  ])
})

test('appearance: a custom font applies from the stacks map it is handed', () => {
  const root = fakeRoot()
  applyAppearance(root, {font: 'custom-mine'}, {'custom-mine': '"Mine", system-ui'})
  assert.equal(root.props.get('--note-font'), '"Mine", system-ui')

  // A stored font with no stack here - deleted, or not yet read - is a
  // removal, so the stylesheet's own default shows through rather than a
  // stale override or a half-remembered family.
  applyAppearance(root, {font: 'custom-gone'}, {})
  assert.equal(root.props.has('--note-font'), false)

  // The built-ins never consult the map: their stacks are this module's,
  // and a key that collides with one changes nothing.
  const other = fakeRoot()
  applyAppearance(other, {font: 'serif'}, {serif: '"Bogus", cursive'})
  assert.equal(other.props.get('--note-font'), 'serif')

  // And with no third argument at all, a custom id simply does not apply -
  // which is what every caller that has never heard of the shelf gets.
  const plain = fakeRoot()
  applyAppearance(plain, {font: 'custom-mine'})
  assert.equal(plain.props.has('--note-font'), false)
})
