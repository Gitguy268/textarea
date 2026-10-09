import assert from 'node:assert/strict'
import test from 'node:test'

import {backupEntries, backupFilename} from '../../lib/backup.js'
import {parseNote} from '../../lib/front-matter.js'

const entry = (over = {}) => ({
  id: 'note-1',
  title: 'Shopping list',
  text: '# Shopping list\n\neggs',
  style: null,
  words: 3,
  created: 1_700_000_000_000,
  updated: 1_700_000_600_000,
  ...over,
})

test('every note is a front-mattered file with a unique name', () => {
  const entries = backupEntries([
    entry(),
    entry({id: 'note-2', text: '# Shopping list\n\nmilk'}),
    entry({id: 'note-3', title: 'shopping list', text: 'lowercase title'}),
  ])

  // The same rule folder sync uses on disk, case included: the collision set
  // holds lowered names, so a differently-cased title is still the same note.
  assert.deepEqual(
    entries.map((item) => item.name),
    ['Shopping list.md', 'Shopping list (2).md', 'shopping list (3).md'],
  )

  // The archive is restorable only if the block survives the round trip.
  const first = parseNote(entries[0].text)
  assert.equal(first.data.id, 'note-1')
  assert.equal(first.data.created, 1_700_000_000_000)
  assert.equal(first.data.updated, 1_700_000_600_000)
  assert.equal(first.text, '# Shopping list\n\neggs', 'the text is verbatim')

  // The file's date is the note's last edit, not the moment of the backup.
  assert.equal(entries[0].date.getTime(), 1_700_000_600_000)
})

test('metadata off writes the bare text, with no block to parse', () => {
  const [only] = backupEntries([entry()], {metadata: false})
  assert.equal(only.text, '# Shopping list\n\neggs')
  assert.equal(parseNote(only.text).data, null, 'nothing for a parser to find')
})

test('the style survives the round trip, quoted the way the writer quotes it', () => {
  const [withStyle] = backupEntries([entry({style: 'color: red'})])
  assert.equal(parseNote(withStyle.text).data.style, 'color: red')
})

test('an empty library is an empty list, not an error', () => {
  assert.deepEqual(backupEntries([]), [])
})

test('the archive is named for the day it was taken', () => {
  assert.equal(backupFilename(new Date('2026-10-09T15:04:05Z')), 'textarea-backup-2026-10-09.zip')
})
