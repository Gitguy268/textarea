import assert from 'node:assert/strict'
import {test} from 'node:test'

import {encodeQr, ERROR_CORRECTION, matrixToSvg, QrError, qrSvg, QUIET_ZONE} from '../../lib/qr.js'

/**
 * The published reference symbol for `HELLO WORLD`, 21 modules a side, error
 * correction level M.
 *
 * This is the worked example every QR tutorial uses, and it is the point of
 * having these vectors: an encoder that produces *a* grid is not the same as one
 * that produces the right grid. Mask selection, the format information bits and
 * the Reed-Solomon blocks can each be wrong in a way that still draws a square
 * full of black and white. Checking the exact modules is the only assertion that
 * notices.
 */
const HELLO_WORLD_M = [
  '111111101000101111111',
  '100000101000101000001',
  '101110100000001011101',
  '101110101010101011101',
  '101110100111001011101',
  '100000100011101000001',
  '111111101010101111111',
  '000000001111100000000',
  '101101110101101001011',
  '011000010111111101100',
  '000001111101010100011',
  '101011011001000101010',
  '100010110110110000101',
  '000000001011001100101',
  '111111101011111110000',
  '100000101110010101111',
  '101110100100101001000',
  '101110101110001001110',
  '101110101100100100100',
  '100000100111011110001',
  '111111101101010100000',
]

/** The same string at error correction level Q. */
const HELLO_WORLD_Q = [
  '111111100111001111111',
  '100000101010001000001',
  '101110101000101011101',
  '101110100010101011101',
  '101110100111001011101',
  '100000100011001000001',
  '111111101010101111111',
  '000000000101100000000',
  '011101100000000000110',
  '111110010101111101100',
  '100011100100010100011',
  '100000011001100101010',
  '011000100101010000101',
  '000000001010101100101',
  '111111100100111110000',
  '100000101110010101111',
  '101110100101001001000',
  '101110101100001001110',
  '101110101100100100100',
  '100000101101011110001',
  '111111100011010100000',
]

/** Render a matrix as one string per row of 1s and 0s. */
function rows(matrix) {
  return Array.from({length: matrix.count}, (_, row) =>
    Array.from({length: matrix.count}, (_, column) => (matrix.isDark(row, column) ? '1' : '0')).join(''),
  )
}

test('the encoder produces the reference symbol for HELLO WORLD', async () => {
  const matrix = await encodeQr('HELLO WORLD', {errorCorrection: 'M'})
  assert.equal(matrix.count, 21)
  assert.deepEqual(rows(matrix), HELLO_WORLD_M)
})

test('a higher correction level produces a different symbol', async () => {
  // Level Q stores more redundancy, so the format bits and the padding differ.
  // If these came back equal, errorCorrection would be being ignored.
  const matrix = await encodeQr('HELLO WORLD', {errorCorrection: 'Q'})
  assert.equal(matrix.count, 21)
  assert.deepEqual(rows(matrix), HELLO_WORLD_Q)
})

test('the correction level defaults to Q', async () => {
  assert.equal(ERROR_CORRECTION, 'Q')
  assert.deepEqual(rows(await encodeQr('HELLO WORLD')), HELLO_WORLD_Q)
})

test('the three finder patterns are where the specification puts them', async () => {
  const matrix = await encodeQr('HELLO WORLD')
  const ring = (top, left) => {
    const found = []
    for (let row = top; row < top + 7; row++) {
      for (let column = left; column < left + 7; column++) {
        // A finder pattern is a 7x7 ring: dark border, light ring, dark centre.
        const dark =
          row === top ||
          row === top + 6 ||
          column === left ||
          column === left + 6 ||
          (row >= top + 2 && row <= top + 4 && column >= left + 2 && column <= left + 4)
        found.push(matrix.isDark(row, column) === dark)
      }
    }
    return found.every(Boolean)
  }

  assert.ok(ring(0, 0), 'top left')
  assert.ok(ring(0, 14), 'top right')
  assert.ok(ring(14, 0), 'bottom left')
})

test('a longer payload picks a larger symbol', async () => {
  // The type number is chosen as the smallest that fits, so this is really a test
  // that the sizing table is being consulted rather than hardcoded.
  const short = await encodeQr('x')
  const long = await encodeQr('x'.repeat(300))
  assert.equal(short.count, 21)
  assert.ok(long.count > short.count, `${long.count} should exceed ${short.count}`)
  // Every symbol's side is 17 + 4 * version.
  assert.equal((short.count - 17) % 4, 0)
  assert.equal((long.count - 17) % 4, 0)
})

test('non-Latin text encodes rather than throwing', async () => {
  // The default byte encoder masks each code unit with & 0xFF and throws above
  // U+00FF, so this is the test for the UTF-8 patch being installed.
  for (const text of ['héllo', '日本語のテキスト', 'emoji 🎉 works', 'Ω≈ç√∫˜µ']) {
    const matrix = await encodeQr(text)
    assert.ok(matrix.count >= 21, `${text} should encode`)
  }
})

test('text too long for any symbol says so', async () => {
  // 2,331 bytes is the largest byte-mode capacity, at correction level L.
  await assert.rejects(() => encodeQr('a'.repeat(4000)), QrError)
  await assert.rejects(() => encodeQr('a'.repeat(4000)), /too long for a QR code/i)
})

test('the drawing puts the dark modules exactly where the matrix says', async () => {
  const matrix = await encodeQr('HELLO WORLD')
  const svg = matrixToSvg(matrix)

  // Every run in the path data is a horizontal strip of one module's height, and
  // each has to land on a module that is actually dark and span only dark ones.
  const runs = [...svg.matchAll(/M(-?\d+) (-?\d+)h(\d+)v1h-\d+z/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
  }))

  assert.ok(runs.length > 0, 'the path should not be empty')

  const covered = new Set()
  for (const run of runs) {
    const row = run.y - QUIET_ZONE
    assert.ok(row >= 0 && row < matrix.count, `row ${row} is inside the symbol`)
    for (let step = 0; step < run.width; step++) {
      const column = run.x - QUIET_ZONE + step
      assert.ok(column >= 0 && column < matrix.count, `column ${column} is inside the symbol`)
      assert.ok(matrix.isDark(row, column), `(${row}, ${column}) should be dark`)
      covered.add(row * matrix.count + column)
    }
  }

  let dark = 0
  for (let row = 0; row < matrix.count; row++) {
    for (let column = 0; column < matrix.count; column++) {
      if (matrix.isDark(row, column)) dark++
    }
  }
  assert.equal(covered.size, dark, 'every dark module is drawn exactly once')
})

test('the drawing carries a light quiet zone', async () => {
  const matrix = await encodeQr('HELLO WORLD')
  const side = matrix.count + QUIET_ZONE * 2

  // The background is not decoration: a scanner needs light margin, and a
  // transparent symbol on the dark theme is unreadable.
  const svg = matrixToSvg(matrix)
  assert.equal(side, 29, '21 modules plus four on each side')
  assert.match(svg, /viewBox="0 0 29 29"/)
  assert.match(svg, /<rect width="29" height="29" fill="#ffffff"\/>/)

  // A wider margin is four modules further out on each side, and nothing moves.
  assert.match(matrixToSvg(matrix, {margin: 8}), /viewBox="0 0 37 37"/)

  // The quiet zone can be turned off, for a caller that supplies its own.
  assert.doesNotMatch(matrixToSvg(matrix, {light: 'none'}), /<rect/)
})

test('the drawing follows the page when asked to', async () => {
  const svg = await qrSvg('https://textarea.my/#abc', {dark: 'currentColor'})
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /<path fill="currentColor"/)
  // The module size travels into the exported pixels, not the path data.
  assert.match(svg, /width="296" height="296"/)
})

test('a label cannot break out of the attribute', async () => {
  const svg = matrixToSvg(await encodeQr('x'), {label: 'a " onload="alert(1)'})
  assert.match(svg, /aria-label="a &quot; onload=&quot;alert\(1\)"/)
  assert.doesNotMatch(svg, /onload="alert/)
})
