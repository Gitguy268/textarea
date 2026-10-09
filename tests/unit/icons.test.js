// The inline icon symbols in index.html, checked against their sources.
//
// The Material Symbols are copied out of google/material-design-icons and
// the check is byte for byte, because that is the only level at which the bug
// this test was written for is visible. All three glyphs at the time had been
// hand-rescaled
// from Google's 960-unit space into a 24-unit one, and the rescale mirrored the
// QR code and the trash can about the horizontal axis: finder patterns in the
// wrong corners, lid under the can. The shapes still looked plausible, so
// nothing caught it, and a test that only asked whether a path existed would
// not have caught it either.
//
// The expected strings below are Google's published `d` attributes, and the
// URLs say which file each came from. They are inlined rather than fetched so
// the suite needs no network; the cost is that they have to be re-copied by
// hand if Google ever redraws these icons.
//
// icon-save is not from Google. It is the tabler floppy this fork has always
// carried, checked for presence and for belonging to the tabler group's
// 24-unit box, which is what keeps the menu from drawing it at the wrong size.

import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'

const index = new URL('../../index.html', import.meta.url)

/** The raw source of one `<symbol>` element, or null when it is not there. */
function symbolSource(html, id) {
  return html.match(new RegExp(`<symbol id="${id}"[^>]*>[\\s\\S]*?</symbol>`))?.[0] ?? null
}

/** Every `d` attribute in a symbol, in order. */
function paths(source) {
  return [...source.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1])
}

/** The `viewBox` of a symbol. */
function viewBox(source) {
  return source.match(/\sviewBox="([^"]+)"/)?.[1] ?? null
}

// github.com/google/material-design-icons, Apache-2.0. One file per entry.
const MATERIAL = [
  {
    id: 'icon-qr',
    file: 'symbols/web/qr_code/materialsymbolsoutlined/qr_code_24px.svg',
    d: 'M120-520v-320h320v320H120Zm80-80h160v-160H200v160Zm-80 480v-320h320v320H120Zm80-80h160v-160H200v160Zm320-320v-320h320v320H520Zm80-80h160v-160H600v160Zm160 480v-80h80v80h-80ZM520-360v-80h80v80h-80Zm80 80v-80h80v80h-80Zm-80 80v-80h80v80h-80Zm80 80v-80h80v80h-80Zm80-80v-80h80v80h-80Zm0-160v-80h80v80h-80Zm80 80v-80h80v80h-80Z',
  },
  {
    id: 'icon-close',
    file: 'symbols/web/close/materialsymbolsoutlined/close_24px.svg',
    d: 'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z',
  },
  {
    id: 'icon-delete',
    file: 'symbols/web/delete/materialsymbolsoutlined/delete_24px.svg',
    d: 'M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z',
  },
  {
    id: 'icon-water-drop',
    file: 'symbols/web/water_drop/materialsymbolsoutlined/water_drop_24px.svg',
    d: 'M491-200q12-1 20.5-9.5T520-230q0-14-9-22.5t-23-7.5q-41 3-87-22.5T343-375q-2-11-10.5-18t-19.5-7q-14 0-23 10.5t-6 24.5q17 91 80 130t127 35ZM480-80q-137 0-228.5-94T160-408q0-100 79.5-217.5T480-880q161 137 240.5 254.5T800-408q0 140-91.5 234T480-80Zm0-80q104 0 172-70.5T720-408q0-73-60.5-165T480-774Q361-665 300.5-573T240-408q0 107 68 177.5T480-160Zm0-320Z',
  },
]

// Google's own coordinate space: x across 0..960, y up from -960 to 0.
const GOOGLE_VIEWBOX = '0 -960 960 960'

test("the Material Symbols are Google's paths, not a rescale of them", async () => {
  const html = await readFile(index, 'utf8')

  for (const {id, file, d} of MATERIAL) {
    const source = symbolSource(html, id)
    assert.ok(source, `${id} should be defined in index.html`)

    // Exactly one path: a second means the symbol was rebuilt rather than
    // copied, which is how the mirror got in.
    const drawn = paths(source)
    assert.equal(drawn.length, 1, `${id} should be a single path (${file})`)
    assert.equal(drawn[0], d, `${id} should match ${file} byte for byte`)

    assert.equal(viewBox(source), GOOGLE_VIEWBOX, `${id} should keep Google's viewBox`)
    assert.match(source, /\sfill="currentColor"/, `${id} should fill with the text colour`)
    assert.match(source, /\sstroke="none"/, `${id} should not stroke: these are fill glyphs`)
  }
})

test('the QR code has its three finder patterns where Google puts them', async () => {
  // The geometric statement of the same thing, so a failure says what is wrong
  // rather than only that two strings differ. Google draws the three big
  // squares at top-left, top-right and bottom-left, with the small modules in
  // the bottom-right quadrant. A vertical mirror puts the third square at the
  // bottom-right and moves the modules up, which is what the bug did.
  const html = await readFile(index, 'utf8')
  const source = symbolSource(html, 'icon-qr')
  assert.ok(source, 'icon-qr should be defined')

  const finder = rectangles(paths(source)[0])
    // Google's squares are 320 units on a side; the modules are 80.
    .filter(([x0, y0, x1, y1]) => x1 - x0 >= 300 && y1 - y0 >= 300)
    // y grows upward in Google's space, so a negative centre is the top half.
    .map(([x0, y0, x1, y1]) => {
      const right = (x0 + x1) / 2 > 480
      const bottom = (y0 + y1) / 2 > -480
      return `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}`
    })
    .sort()

  assert.deepEqual(
    finder,
    ['bottom-left', 'top-left', 'top-right'],
    'the three finder patterns should be at top-left, top-right and bottom-left',
  )
})

test('the save icon is present and stays in the tabler 24-unit box', async () => {
  const html = await readFile(index, 'utf8')
  const source = symbolSource(html, 'icon-save')
  assert.ok(source, 'icon-save should be defined in index.html')

  assert.equal(viewBox(source), '0 0 24 24', 'the floppy belongs to the tabler group')
  assert.match(source, /stroke-width="1\.25"/, 'the tabler group draws at 1.25')
  assert.match(source, /stroke="currentColor"/, 'the tabler group strokes with the text colour')

  const drawn = paths(source)
  assert.ok(drawn.length > 1, 'the floppy is drawn, not left as one blank path')
  assert.ok(
    drawn.some((d) => d.startsWith('M6 4h10l4 4')),
    "the floppy's outline should still be the one this fork has always drawn",
  )
})

/**
 * Every closed axis-aligned rectangle in a path, as [x0, y0, x1, y1].
 *
 * Only the commands the QR glyph is built from are handled: absolute and
 * relative moves, horizontal and vertical lines, and close. Anything else
 * throws rather than silently dropping a shape, because a shape dropped here
 * would make the quadrant assertion pass for the wrong reason.
 */
function rectangles(d) {
  const tokens = d.match(/[MmZzVvHh]|-?\d*\.?\d+/g) ?? []
  const out = []
  let at = 0
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let command = null
  let points = []

  const close = () => {
    if (points.length >= 3) {
      const xs = points.map(([px]) => px)
      const ys = points.map(([, py]) => py)
      out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
    }
    points = []
  }

  while (at < tokens.length) {
    const token = tokens[at]
    if (/[A-Za-z]/.test(token)) {
      command = token
      at++
      if (command === 'Z' || command === 'z') {
        close()
        x = startX
        y = startY
      }
      continue
    }

    const n = Number(tokens[at++])
    if (command === 'M') {
      close()
      x = n
      y = Number(tokens[at++])
      startX = x
      startY = y
      command = 'L'
      points = [[x, y]]
    } else if (command === 'm') {
      close()
      x += n
      y += Number(tokens[at++])
      startX = x
      startY = y
      command = 'l'
      points = [[x, y]]
    } else if (command === 'v') {
      y += n
      points.push([x, y])
    } else if (command === 'V') {
      y = n
      points.push([x, y])
    } else if (command === 'h') {
      x += n
      points.push([x, y])
    } else if (command === 'H') {
      x = n
      points.push([x, y])
    } else {
      throw new Error(`unhandled path command ${JSON.stringify(command)} in ${d}`)
    }
  }

  close()
  return out
}
