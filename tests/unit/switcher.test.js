import assert from 'node:assert/strict'
import {test} from 'node:test'

import {filterNotes} from '../../lib/switcher.js'

const library = [
  {title: 'Alpha', text: '# Alpha\n\nThe quiet one.'},
  {title: 'Beta', text: '# Beta\n\nHolds xylophone in the text.'},
  {title: 'Gamma', text: '# Gamma\n\nNothing to see.'},
]

test('an empty query offers every note, in the order the library holds them', () => {
  assert.deepEqual(
    filterNotes(library, '').map((match) => match.entry.title),
    ['Alpha', 'Beta', 'Gamma'],
  )
  // Whitespace is not a query either - it is a stray keystroke.
  assert.equal(filterNotes(library, '   ').length, 3)
  // Every one of them arrives without a reason to show: the reader has
  // asked for the list, not for a ranking of it.
  assert.ok(
    filterNotes(library, '').every((match) => match.hint === ''),
    'an unfiltered list carries no hints',
  )
})

test('the search is over titles only, unless it says otherwise', () => {
  // 'xylophone' is in Beta's text and nowhere in any title. The default
  // scope - the call with no third argument, which is what the palette
  // makes - must not find it.
  assert.deepEqual(filterNotes(library, 'xylophone'), [])
  assert.deepEqual(filterNotes(library, 'xylophone', 'titles'), [])

  // Titles match case insensitively, the way every title match in the app
  // does.
  assert.deepEqual(
    filterNotes(library, 'ALP').map((match) => match.entry.title),
    ['Alpha'],
  )
})

test('the wide scope searches the text, and says where it hit', () => {
  const matches = filterNotes(library, 'xylophone', 'all')

  assert.equal(matches.length, 1)
  assert.equal(matches[0].entry.title, 'Beta')
  // The row shows the line, so the reader can see why it is in the list -
  // and only that line, not the whole note.
  assert.equal(matches[0].hint, 'Holds xylophone in the text.')
})

test('a title match always outranks a text match', () => {
  // The note named by the query is listed second in the library but must
  // come first in the palette: a passing mention above the note the query
  // actually names reads as the palette being broken.
  const entries = [
    {title: 'A diary', text: 'mentions zephyr in passing'},
    {title: 'Zephyr', text: 'a note about weather'},
  ]

  const matches = filterNotes(entries, 'zephyr', 'all')
  assert.deepEqual(
    matches.map((match) => match.entry.title),
    ['Zephyr', 'A diary'],
  )
  // The named note needs no reason shown; the mention shows its line.
  assert.equal(matches[0].hint, '')
  assert.equal(matches[1].hint, 'mentions zephyr in passing')
})

test('a query nothing matches lists nothing', () => {
  assert.deepEqual(filterNotes(library, 'nothing at all like this', 'all'), [])
})

test('the hint is flattened and cut like every other preview in the app', () => {
  const entries = [
    {
      title: 'Wide',
      text: 'first line\n\n  alpha   and beta  on one   stretched line',
    },
  ]

  // The first line saying it, with its ragged whitespace collapsed, so one
  // row stays one row.
  assert.equal(
    filterNotes(entries, 'alpha', 'all')[0].hint,
    'alpha and beta on one stretched line',
  )

  const long = [{title: 'Long', text: 'alpha ' + 'x'.repeat(200)}]
  const hint = filterNotes(long, 'alpha', 'all')[0].hint
  assert.ok(hint.length <= 120, `expected a cut line, got ${hint.length} characters`)
  assert.ok(hint.endsWith('…'), 'the cut says so rather than pretending it ended')
})
