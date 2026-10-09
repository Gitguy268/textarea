// The custom-font helpers: the half that runs without a browser.
//
// The shelf itself - IndexedDB, the FontFace API - is proved in the browser
// tests. What is here is what those depend on: the signatures that narrow a
// file to the four formats a browser can load, the names and identifiers
// that have to survive being made from a file name, and the switch that
// decides whether any of it applies.

import assert from 'node:assert/strict'
import {test} from 'node:test'

import {
  CUSTOM_FONTS_KEY,
  enabled,
  familyFromFileName,
  fetchFontFile,
  fontId,
  FONT_FORMATS,
  importFont,
  MAX_FONT_BYTES,
  MAX_FONTS,
  rawGitHubUrl,
  safeFamily,
  sniffFont,
  stackFor,
} from '../../lib/fonts.js'

/** A localStorage the tests can read back. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

/** The first bytes of a format, as a file would open with them. */
function magic(text) {
  const bytes = new Uint8Array(4)
  for (let i = 0; i < 4; i++) bytes[i] = text.charCodeAt(i)
  return bytes
}

test('fonts: sniffing accepts the four loadable formats and nothing else', () => {
  assert.equal(sniffFont(magic('wOFF')), 'woff')
  assert.equal(sniffFont(magic('wOF2')), 'woff2')
  assert.equal(sniffFont(magic('OTTO')), 'otf')
  assert.equal(sniffFont(new Uint8Array([0x00, 0x01, 0x00, 0x00])), 'ttf')
  assert.equal(sniffFont(magic('true')), 'ttf', 'the Apple flavour of TrueType')

  // A collection is a file of files; no browser hands one to FontFace, so
  // it belongs with the rejections rather than in the loadable list.
  assert.equal(sniffFont(magic('ttcf')), null)
  assert.equal(sniffFont(magic('wOF3')), null, 'a typo of wOF2 is still not a format')
  assert.equal(sniffFont(magic('....')), null)
  assert.equal(sniffFont(magic('%PDF')), null, 'a PDF renamed .ttf stays a PDF')

  assert.equal(sniffFont(new Uint8Array(0)), null, 'empty is not a font')
  assert.equal(sniffFont(new Uint8Array([0x77, 0x4f])), null, 'too short to say anything')
  assert.equal(sniffFont(null), null)

  // An ArrayBuffer is accepted too: the shelf reads files into one.
  const buffer = magic('wOF2').buffer
  assert.equal(sniffFont(buffer), 'woff2')
})

test('fonts: a family name is only letters, digits, spaces, underscores, hyphens', () => {
  assert.equal(safeFamily('My Font'), 'My Font')
  assert.equal(safeFamily('Comic Sans MS'), 'Comic Sans MS')
  assert.equal(safeFamily('Blink_MacSystemFont'), 'Blink_MacSystemFont')
  assert.equal(safeFamily('  spaced  out  '), 'spaced out')
  assert.equal(safeFamily('Bob’s "Best" <Font>'), 'Bob s Best Font', 'quotes and brackets go')
  assert.equal(safeFamily('semi;colon = {value}'), 'semi colon value', 'a declaration cannot start')

  const long = 'x'.repeat(200)
  assert.equal(safeFamily(long).length, 48, 'capped at a readable length')

  assert.equal(safeFamily('---'), 'Custom font', 'a name that reduces to nothing')
  assert.equal(safeFamily(''), 'Custom font')
  assert.equal(safeFamily(null), 'Custom font')
  assert.equal(safeFamily(12345), '12345', 'a number is a name like any other')
})

test('fonts: the family comes from the file name, without its font extension', () => {
  assert.equal(familyFromFileName('My Font.ttf'), 'My Font')
  assert.equal(familyFromFileName('MyFont.WOFF2'), 'MyFont', 'the extension is case-insensitive')
  assert.equal(familyFromFileName('serif.otf'), 'serif')
  assert.equal(familyFromFileName('grid.woff'), 'grid')
  assert.equal(familyFromFileName('grid.woff2'), 'grid', 'woff2 must not be split at .woff')
  assert.equal(familyFromFileName('notes.txt'), 'notes txt', 'only font extensions are stripped')
  assert.equal(familyFromFileName('no-extension'), 'no-extension')
  assert.equal(
    familyFromFileName('C:\\fonts\\Palette.ttf'),
    'Palette',
    'a path contributes only its last part',
  )
  assert.equal(familyFromFileName('/home/u/font.ttf'), 'font')
})

test('fonts: the id is the family slugged, and the same family replaces itself', () => {
  assert.equal(fontId('My Font'), 'custom-my-font')
  assert.equal(fontId('My Font!'), 'custom-my-font', 'punctuation collapses into hyphens')
  assert.equal(fontId('My Font'), fontId('my font'), 'one family, one slot')
  assert.equal(fontId(''), 'custom-custom-font', 'the empty name falls back with its family')
  assert.equal(fontId('---'), 'custom-custom-font')

  const id = fontId('x'.repeat(200))
  assert.ok(id.length <= 'custom-'.length + 48, 'the id stays a preference one can read')
  assert.match(id, /^custom-[a-z0-9]+(-[a-z0-9]+)*$/, 'the shape readNoteFont trusts')
  assert.match(fontId('99 Luftballons'), /^custom-[a-z0-9]+(-[a-z0-9]+)*$/)
  assert.match(fontId('_leading'), /^custom-[a-z0-9]+(-[a-z0-9]+)*$/)
})

test('fonts: a stack always carries the system font behind the family', () => {
  assert.equal(stackFor('My Font'), '"My Font", system-ui')
  assert.equal(stackFor('Bob’s'), '"Bob s", system-ui', 'the quoted family is sanitised first')
  assert.equal(stackFor(null), '"Custom font", system-ui')
})

test('fonts: the feature is on until storage says otherwise', () => {
  assert.equal(enabled(memoryStorage()), true, 'on by default')
  assert.equal(enabled(memoryStorage({[CUSTOM_FONTS_KEY]: 'on'})), true)
  assert.equal(enabled(memoryStorage({[CUSTOM_FONTS_KEY]: 'off'})), false)
  assert.equal(enabled(memoryStorage({[CUSTOM_FONTS_KEY]: ''})), true, 'only "off" is off')

  const refused = {
    getItem() {
      throw new Error('denied')
    },
  }
  assert.equal(enabled(refused), true, 'a browser that refuses storage still has the feature')
})

test('fonts: the limits the panel quotes are the limits the code keeps', () => {
  assert.equal(MAX_FONT_BYTES, 5 * 1024 * 1024, 'five megabytes, as Settings says')
  assert.equal(MAX_FONTS, 10)
  assert.match(FONT_FORMATS, /TTF/)
  assert.match(FONT_FORMATS, /WOFF2/)
})

test('fonts: the three GitHub shapes become a raw link, and nothing else does', () => {
  const raw = 'https://raw.githubusercontent.com/google/fonts/main/ofl/silkscreen/Silkscreen-Regular.ttf'

  // The three shapes, and only the three.
  assert.equal(rawGitHubUrl(raw), raw, 'a raw link is already what it is')
  assert.equal(
    rawGitHubUrl('https://github.com/google/fonts/blob/main/ofl/silkscreen/Silkscreen-Regular.ttf'),
    raw,
    'a blob page is the same file',
  )
  assert.equal(
    rawGitHubUrl(`${raw}?raw=true`),
    raw,
    'the query and fragment are dropped: they say the same thing',
  )
  assert.equal(
    rawGitHubUrl('https://github.com/o/r/raw/main/f.ttf'),
    'https://raw.githubusercontent.com/o/r/main/f.ttf',
    'the /raw/ path counts as the file it redirects to',
  )
  assert.equal(
    rawGitHubUrl('https://www.github.com/o/r/blob/main/f.ttf'),
    'https://raw.githubusercontent.com/o/r/main/f.ttf',
    'a pasted www link is the same site',
  )
  assert.equal(
    rawGitHubUrl('https://github.com/o/r/blob/feat/x/f.ttf'),
    'https://raw.githubusercontent.com/o/r/feat/x/f.ttf',
    'a branch name with a slash passes through whole',
  )
  assert.equal(
    rawGitHubUrl('  https://github.com/o/r/blob/main/f.ttf\n'),
    'https://raw.githubusercontent.com/o/r/main/f.ttf',
    'whitespace around a pasted link is ignored',
  )
  assert.equal(
    rawGitHubUrl('https://github.com/o/r/blob/main/f.ttf#L1'),
    'https://raw.githubusercontent.com/o/r/main/f.ttf',
    'a fragment is dropped with the query',
  )

  // Everything else is refused here, before the network: this list is
  // what the Content-Security-Policy's one connect-src host depends on.
  assert.equal(rawGitHubUrl('https://evil.com/o/r/blob/main/f.ttf'), null, 'another host')
  assert.equal(
    rawGitHubUrl('https://raw.githubusercontent.com.evil.com/o/r/main/f.ttf'),
    null,
    'a host that only starts with ours',
  )
  assert.equal(rawGitHubUrl('http://raw.githubusercontent.com/o/r/main/f.ttf'), null, 'https only')
  assert.equal(rawGitHubUrl('https://github.com/o/r'), null, 'a repository is a folder')
  assert.equal(rawGitHubUrl('https://github.com/o/r/tree/main/src'), null, 'so is a tree')
  assert.equal(rawGitHubUrl('https://github.com/o/r/blob/main'), null, 'a ref on its own is a folder')
  assert.equal(rawGitHubUrl('https://raw.githubusercontent.com/o/r/main'), null, 'a raw ref with no file')
  assert.equal(rawGitHubUrl('https://gist.github.com/o/1'), null, 'a gist is another service')
  assert.equal(rawGitHubUrl('javascript:alert(1)'), null, 'and only http(s) URLs at all')
  assert.equal(rawGitHubUrl('/o/r/blob/main/f.ttf'), null, 'a path with no host to resolve against')
  assert.equal(rawGitHubUrl('https://example.com/f.ttf'), null)
  assert.equal(rawGitHubUrl('not a url'), null)
  assert.equal(rawGitHubUrl(''), null)
  assert.equal(rawGitHubUrl(null), null)
})

test('fonts: a download is turned down before, during and after it arrives', async () => {
  const original = globalThis.fetch
  const link = 'https://raw.githubusercontent.com/o/r/main/My%20Font.ttf'
  try {
    // Before: the link itself is the first gate, and no host means no
    // request - not a request that is then judged.
    let requested = 0
    globalThis.fetch = async () => {
      requested++
      return new Response(new Uint8Array(4), {status: 200})
    }
    await assert.rejects(() => fetchFontFile('https://example.com/f.ttf'), /not a link/)
    await assert.rejects(() => fetchFontFile('https://github.com/o/r/tree/main/src'), /not a link/)
    await assert.rejects(() => fetchFontFile('ftp://raw.githubusercontent.com/o/r/main/f.ttf'), /not a link/)
    assert.equal(requested, 0, 'a refused link never reaches the network')

    // A declared length over the cap is refused without reading the body.
    const declared = new Response(new Uint8Array(4), {status: 200})
    declared.headers.set('content-length', String(MAX_FONT_BYTES + 1))
    globalThis.fetch = async () => declared
    await assert.rejects(() => fetchFontFile(link), /over 5 MB/)

    // A body that arrives over the cap is cut off as it counts - the
    // declared length is dropped first, so it is the counting that stops
    // it here and not the header.
    const streamed = new Response(new Uint8Array(MAX_FONT_BYTES + 1), {status: 200})
    streamed.headers.delete('content-length')
    globalThis.fetch = async () => streamed
    await assert.rejects(() => fetchFontFile(link), /over 5 MB/)

    // An error status is named the way the server said it.
    globalThis.fetch = async () => new Response('nope', {status: 404})
    await assert.rejects(() => fetchFontFile(link), /404/)

    // A network failure is its own message, not a stack trace.
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    await assert.rejects(() => fetchFontFile(link), /could not be reached/)

    // And a good response comes back with its bytes and the family its
    // name implies, percent-decoding the way a browser would.
    globalThis.fetch = async (url) => {
      assert.equal(url, link, 'the rewritten link is what is asked for')
      return new Response(new Uint8Array([0, 1, 0, 0]), {status: 200})
    }
    const {bytes, name} = await fetchFontFile(`https://github.com/o/r/blob/main/My%20Font.ttf`)
    assert.equal(name, 'My Font')
    assert.equal(bytes.byteLength, 4)
  } finally {
    globalThis.fetch = original
  }
})

test('fonts: an import is judged before the browser is asked for anything', async () => {
  // The size, the emptiness and the signature are all answered without a
  // FontFace, an IndexedDB or a network, which is what lets them be
  // answered here at all.
  await assert.rejects(() => importFont('empty.ttf', new Uint8Array(0)), /empty/)
  await assert.rejects(
    () => importFont('huge.ttf', new Uint8Array(MAX_FONT_BYTES + 1)),
    /over 5 MB/,
    'the cap holds for an upload as well as a download',
  )
  await assert.rejects(
    () => importFont('renamed.pdf', new TextEncoder().encode('%PDF-1.7\n')),
    /not a font/,
    'a renamed document is stopped by its signature',
  )
})
