// The file format behind folder sync, tested where it was designed: under
// Node, with no browser, no folder and no handle.
//
// The two properties everything else rests on are exact round trip (a note
// nobody touched outside the app never looks changed) and a parser that takes
// what a hand-edit gives it, because these files are meant to be opened in
// any editor.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fileTimestamp,
  filenameFor,
  parseNote,
  renderNote,
  titleOf,
} from '../../lib/front-matter.js'

const note = {
  id: '7f3c0000-0000-4000-8000-000000000000',
  created: 1_770_000_000_000,
  updated: 1_770_000_600_000,
  words: 12,
  style: 'color: red',
  text: '# Shopping list\n\nMilk\nEggs & ham',
}

test('renderNote writes the block the docs promise, verbatim', () => {
  assert.equal(
    renderNote(note),
    '---\n' +
      'id: 7f3c0000-0000-4000-8000-000000000000\n' +
      'created: 1770000000000\n' +
      'updated: 1770000600000\n' +
      'words: 12\n' +
      'style: "color: red"\n' +
      '---\n' +
      '# Shopping list\n\nMilk\nEggs & ham',
  )
})

test('parse round trips whatever render writes', () => {
  for (const text of [
    note.text,
    '',
    'no heading at all',
    '---\nlooks like a fence\n---\nbut is not the first line',
    'line\nwith trailing newline\n',
    'unicode: café, 中文, emoji 🍎',
  ]) {
    const source = renderNote({...note, text})
    const parsed = parseNote(source)
    assert.equal(parsed.text, text, `text survives for ${JSON.stringify(text)}`)
    assert.equal(parsed.data.id, note.id)
    assert.equal(parsed.data.updated, note.updated)
    assert.equal(parsed.data.style, note.style)
  }
})

test('a file without a block is just text, with its line endings normalised', () => {
  assert.deepEqual(parseNote('# Title\n\nbody'), {data: null, text: '# Title\n\nbody'})
  assert.deepEqual(parseNote(''), {data: null, text: ''})

  // CRLF and a BOM come from editors on other systems; neither is a change.
  assert.deepEqual(parseNote('\uFEFF# Title\r\n\r\nbody\r\n'), {
    data: null,
    text: '# Title\n\nbody\n',
  })
})

test('an unclosed or missing block never eats the note', () => {
  // A markdown file whose first line is a horizontal rule has no block.
  const hr = parseNote('---\nnot a key line\nno closing fence either\n')
  assert.equal(hr.data, null)
  assert.equal(hr.text, '---\nnot a key line\nno closing fence either\n')

  // An empty block is still a block: "has front matter" and "has keys" differ.
  assert.deepEqual(parseNote('---\n---\nbody'), {data: {}, text: 'body'})
})

test('the parser takes what a hand-edit gives it', () => {
  const source = [
    '---',
    'id: plain-id-123',
    'updated: 1770000600000',
    'style: "color: red; font-family: \\"Times\\""',
    'extra: something this app never wrote',
    'this line is not a key',
    "note: 'single quoted'",
    'broken: "unterminated',
    'flag: true',
    '---',
    'body',
  ].join('\n')

  const {data, text} = parseNote(source)
  assert.equal(text, 'body')
  assert.equal(data.id, 'plain-id-123')
  assert.equal(data.updated, 1_770_000_600_000, 'digits come back as numbers')
  assert.equal(data.style, 'color: red; font-family: "Times"')
  assert.equal(data.extra, 'something this app never wrote', 'unknown keys are kept, not fought')
  assert.equal(data.note, 'single quoted')
  assert.equal(data.broken, '"unterminated', 'a bad quote keeps the text rather than throwing')
  assert.equal(data.flag, true)
})

test('titleOf is the naming rule the tab and the library already use', () => {
  assert.equal(titleOf('# Title\n\nbody'), 'Title')
  assert.equal(titleOf('\n\n  #   Spaced title  \nrest'), 'Spaced title')
  assert.equal(titleOf('#Title is not a heading here'), 'Textarea')
  assert.equal(titleOf('## Sub is level two'), 'Textarea')
  assert.equal(titleOf(''), 'Textarea')
  assert.equal(titleOf(null), 'Textarea')
})

test('fileTimestamp is the later of the claim and the mtime', () => {
  assert.equal(fileTimestamp({updated: 500}, 200), 500, 'a hand-bumped claim counts')
  assert.equal(fileTimestamp({updated: 100}, 200), 200, 'an edited mtime counts')
  assert.equal(fileTimestamp(null, 200), 200, 'no block falls back to the mtime')
  assert.equal(fileTimestamp({}, 0), 0)
  assert.equal(fileTimestamp({updated: 'nonsense'}, 0), 0, 'junk is not a timestamp')
})

test('filenameFor makes a unique name out of any title', () => {
  const taken = new Set()

  const first = filenameFor('Shopping list', taken)
  assert.equal(first, 'Shopping list.md')
  taken.add(first.toLowerCase())

  // The same title is a second file, not a collision.
  const second = filenameFor('Shopping list', taken)
  assert.equal(second, 'Shopping list (2).md')
  taken.add(second.toLowerCase())
  assert.equal(filenameFor('Shopping list', taken), 'Shopping list (3).md')

  // macOS folders are case-insensitive by default: two cases are one file.
  const caseTaken = new Set(['note.md'])
  assert.equal(filenameFor('NOTE', caseTaken), 'NOTE (2).md')

  // A note's own file never counts against it, whatever the case.
  assert.equal(filenameFor('NOTE', caseTaken, 'note.md'), 'NOTE.md')
})

test('filenameFor cannot produce a name the filesystem would refuse', () => {
  const taken = new Set()
  assert.equal(filenameFor('my/note:2026', taken), 'my_note_2026.md')
  assert.equal(filenameFor('', taken), 'note.md')
  assert.equal(filenameFor('.hidden', taken), 'hidden.md')
  assert.equal(filenameFor('report.md', taken), 'report.md', 'a .md title is not doubled')
  assert.equal(filenameFor('report.MD', taken), 'report.md', 'and the extension stays one')

  const long = filenameFor('é'.repeat(200), taken)
  assert.ok(long.endsWith('.md'))
  assert.ok(new TextEncoder().encode(long.slice(0, -3)).length <= 180, 'names stay short enough')
})
