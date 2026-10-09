import assert from 'node:assert/strict'
import test from 'node:test'

import {
  detectColumnBoundary,
  groupLines,
  hasExtractableText,
  itemsToPageText,
  joinRuns,
  normalizeItems,
  pagesToText,
} from '../../lib/pdf-layout.js'

// groupLines/joinRuns/detectColumnBoundary work on normalized runs; the
// convenience wrapper below mirrors what itemsToPageText does internally.
const runs = (items) => normalizeItems(items)

// Build pdf.js-shaped text items: x/y are the baseline start, width the advance,
// height the em size, transform the full matrix.
function run(str, x, y, {width, height = 11, eol = false} = {}) {
  return {
    str,
    width: width ?? str.length * height * 0.5,
    height,
    hasEOL: eol,
    dir: 'ltr',
    fontName: 'g_d0_f1',
    transform: [height, 0, 0, height, x, y],
  }
}

/**
 * Lay out a sentence as the sequence of runs a PDF would actually contain: one
 * run per word, each starting where the previous one ended plus a word space.
 */
function words(str, x, y, em = 11) {
  const charWidth = em * 0.5
  const wordSpace = charWidth * 1.2
  const out = []
  let cursor = x
  for (const word of str.split(' ')) {
    out.push(run(word, cursor, y, {width: word.length * charWidth, height: em}))
    cursor += word.length * charWidth + wordSpace
  }
  return out
}

/** One line of text laid out left to right from x, on baseline y. */
function line(str, x, y, options = {}) {
  const height = options.height ?? 11
  const charWidth = height * 0.5
  return run(str, x, y, {width: str.length * charWidth, height, eol: options.eol})
}

test('joins runs on one line in left to right order', () => {
  const items = [line('world', 100, 700), line('hello', 40, 700)]
  const sorted = normalizeItems(items).sort((a, b) => a.x - b.x)
  assert.equal(joinRuns(sorted, 11), 'hello world')
})

test('inserts a space only when the horizontal gap is wide enough', () => {
  const tight = runs([run('foo', 0, 700, {width: 17}), run('bar', 17, 700, {width: 17})])
  assert.equal(joinRuns(tight, 11), 'foobar')

  const loose = runs([run('foo', 0, 700, {width: 17}), run('bar', 24, 700, {width: 17})])
  assert.equal(joinRuns(loose, 11), 'foo bar')
})

test('does not double the space when a run already carries one', () => {
  const items = [run('foo', 0, 700, {width: 17}), run(' bar', 24, 700, {width: 21})]
  assert.equal(joinRuns(runs(items), 11), 'foo bar')
})

test('aligns table columns by padding with a gap-derived number of spaces', () => {
  const items = [
    run('a', 50, 700, {width: 6}),
    run('b', 80, 700, {width: 6}),
  ]
  const text = joinRuns(runs(items), 11, {pad: true})
  // Gap is 24pt, a quarter em is 2.75pt, so nine spaces land the second column.
  assert.equal(text, 'a' + ' '.repeat(9) + 'b')
  assert.equal(joinRuns(runs(items), 11), 'a b', 'prose collapses the gap to one space')
})

test('groups runs that share a baseline into one line', () => {
  const lines = groupLines(runs([line('a', 0, 700), line('b', 60, 700.2), line('c', 0, 688)]))
  assert.equal(lines.length, 2)
  assert.equal(lines[0].runs.length, 2)
  assert.ok(lines[0].y > lines[1].y, 'lines come out top down')
})

test('keeps a superscript on the line it belongs to', () => {
  const items = [run('x', 0, 700, {width: 6, height: 11}), run('2', 6, 702.5, {width: 5, height: 7})]
  assert.equal(groupLines(runs(items)).length, 1)
})

test('renders a single column page top down with paragraph breaks', () => {
  const items = [
    line('Heading', 50, 750, {height: 18}),
    line('First line.', 50, 730),
    line('Second line.', 50, 718),
    line('After a gap.', 50, 690),
  ]
  const {text, columns} = itemsToPageText(items)
  assert.equal(columns, 1)
  // Each PDF line stays its own output line: the original soft wrapping of the
  // source prose is not recoverable, and reflowing would be a guess.
  assert.equal(text, 'Heading\nFirst line.\nSecond line.\n\nAfter a gap.')
})

test('honours hasEOL even when the baseline gap is small', () => {
  const items = [
    run('one', 50, 700, {width: 18, eol: true}),
    run('two', 50, 688, {width: 18}),
  ]
  assert.equal(itemsToPageText(items).text, 'one\ntwo')
})

/**
 * A two column page: both columns start on the same baseline and are made of
 * three-word lines, which is what makes "read the columns, not the rows" the
 * only sensible reading order.
 */
function twoColumnPage(lineCount = 10) {
  const items = []
  for (let i = 0; i < lineCount; i++) {
    const y = 750 - i * 13
    items.push(...words(`left ${i} alpha`, 50, y))
    items.push(...words(`right ${i} beta`, 320, y))
  }
  return items
}

test('detects two columns and reads left column before right', () => {
  const {text, columns} = itemsToPageText(twoColumnPage())
  assert.equal(columns, 2)

  const outputLines = text.split('\n')
  assert.equal(outputLines.length, 2 * 10 + 1, 'a blank line separates the columns')
  assert.equal(outputLines[10], '', 'the separator is a blank line')

  // Inside a column the words of a line are rejoined.
  assert.equal(outputLines[0], 'left 0 alpha')
  // ... and the columns are read in sequence, not row by row.
  assert.equal(outputLines[9], 'left 9 alpha')
  assert.equal(outputLines[11], 'right 0 beta')
  assert.ok(!/alpha.*beta/.test(text), 'the two columns must not be interleaved')
})

test('two column detection can be turned off', () => {
  const {columns, text} = itemsToPageText(twoColumnPage(), {twoColumns: false})
  assert.equal(columns, 1)
  // Same baselines, so with detection off the columns interleave row by row.
  assert.match(text.split('\n')[0], /^left 0 alpha\s+right 0 beta$/)
})

test('leaves a single column page alone even with wide margins', () => {
  const items = []
  for (let i = 0; i < 20; i++) items.push(line('word' + i, 60, 750 - i * 13))
  assert.equal(detectColumnBoundary(runs(items), 11), null)
  assert.equal(itemsToPageText(items).columns, 1)
})

test('ignores a page too small to judge', () => {
  const items = [line('a', 50, 700), line('b', 320, 700)]
  assert.equal(itemsToPageText(items).columns, 1)
})

test('a title spanning the gutter does not defeat detection', () => {
  const items = [run('A very wide centred title', 150, 780, {width: 260, height: 16})]
  items.push(...twoColumnPage())
  const {columns} = itemsToPageText(items)
  assert.equal(columns, 2, 'a title straddling the gutter must not veto detection')
})

test('a footer spanning the gutter does not defeat detection', () => {
  const items = twoColumnPage()
  items.push(run('page 1 of 1', 150, 30, {width: 260, height: 9}))
  assert.equal(itemsToPageText(items).columns, 2)
})

test('falls back to run order for rotated text', () => {
  const items = [
    {...line('rotated', 0, 700), transform: [0, 11, -11, 0, 0, 700]},
    line('upright', 0, 600),
  ]
  const {columns, text} = itemsToPageText(items)
  assert.equal(columns, 0)
  assert.ok(text.includes('rotated'))
  assert.ok(text.includes('upright'))
})

test('ignores non-text items and empty runs', () => {
  const items = [{type: 'beginMarkedContent'}, line('real', 50, 700), {str: '', hasEOL: false}]
  assert.equal(itemsToPageText(items).text, 'real')
})

test('an empty or image only page yields no text', () => {
  assert.equal(itemsToPageText([]).text, '')
  assert.equal(itemsToPageText([{str: '  ', width: 4, height: 0, transform: [11, 0, 0, 11, 0, 0]}]).text.trim(), '')
  assert.equal(hasExtractableText('   \n  '), false)
  assert.equal(hasExtractableText('x'), true)
})

test('a whitespace run spanning the gutter does not hide a two column layout', () => {
  // pdf.js reports the space between the columns as a run in its own right, and
  // its width covers the whole gutter. Treating it as text would make every
  // candidate boundary look straddled.
  const items = []
  for (let i = 1; i <= 16; i++) {
    const y = 750 - i * 13
    items.push(line(`Left line ${i}`, 50, y))
    items.push(run(' ', 98, y, {width: 222, height: 0}))
    items.push(line(`Right line ${i}`, 320, y))
  }

  const page = itemsToPageText(items)
  assert.equal(page.columns, 2, 'the columns should be found')

  const lines = page.text.split('\n')
  assert.ok(lines.includes('Left line 16'), 'the left column is complete')
  assert.ok(lines.includes('Right line 1'), 'the right column is complete')
  assert.ok(
    lines.indexOf('Right line 1') > lines.indexOf('Left line 16'),
    'the left column is read before the right one',
  )
})

test('runs with zero height fall back to the page median instead of dividing by zero', () => {
  // pdf.js reports height 0 for some runs while the transform still carries the
  // real font size, so the transform is what says the text is upright.
  const zeroHeight = (str, x, y, width) => ({
    ...run(str, x, y, {width, height: 11}),
    height: 0,
  })

  const items = [zeroHeight('a', 50, 700, 6), zeroHeight('b', 61, 700, 6)]
  assert.equal(itemsToPageText(items).text, 'a b')
})

test('pages are joined with a form feed and blank line', () => {
  const text = pagesToText([[line('one', 50, 700)], [line('two', 50, 700)]])
  assert.equal(text, 'one\n\f\n\ntwo')
})

test('pagesToText accepts pre-extracted strings and trims the page boundary', () => {
  assert.equal(pagesToText(['  a  ', 'b\n\n']), 'a\n\f\n\nb')
  assert.equal(pagesToText(['a', '', 'b']), 'a\n\f\n\n\n\f\n\nb')
})

test('a large table survives as aligned columns', () => {
  const items = []
  const rows = [['name', 'qty'], ['apples', '3'], ['pears', '12'], ['kiwi', '1']]
  rows.forEach((cells, row) => {
    cells.forEach((cell, column) => {
      items.push(run(cell, 50 + column * 180, 700 - row * 16, {width: cell.length * 6, height: 11}))
    })
  })
  const {text} = itemsToPageText(items)
  const lines = text.split('\n')
  assert.equal(lines.length, 4)
  assert.equal(lines[0].indexOf('qty') > 0, true)
  assert.equal(
    lines.every((lineText) => lineText.indexOf('name') >= 0 || lineText.indexOf('apples') >= 0 || lineText.indexOf('pears') >= 0 || lineText.indexOf('kiwi') >= 0),
    true,
  )
})
