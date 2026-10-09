import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countDocuments,
  deleteDocument,
  deleteForever,
  emptyTrash,
  getDocument,
  isAvailable,
  listDocuments,
  listTrash,
  moveToTrash,
  putDocument,
  purgeTrash,
  restoreFromTrash,
} from '../../lib/library.js'

// The library's own rule, stated at the top of the file: every function
// degrades to a no-op when storage is unavailable, because an editor that
// stops accepting text because it cannot keep a note would be a far worse bug
// than a missing library. Node has no IndexedDB, which is the honest way to
// ask: this is the private-window case, not a mock of it.
test('every library and trash call degrades to a no-op without storage', async () => {
  assert.equal(isAvailable(), false, 'Node is the browser without IndexedDB')

  assert.deepEqual(await listDocuments(), [])
  assert.equal(await countDocuments(), 0)
  assert.equal(await getDocument('note-1'), null)
  assert.equal(await putDocument({text: 'hello'}), null)
  assert.equal(await deleteDocument('note-1'), false)

  assert.deepEqual(await listTrash(), [])
  assert.equal(await moveToTrash('note-1'), false)
  assert.equal(await restoreFromTrash('note-1'), false)
  assert.equal(await deleteForever('note-1'), false)
  assert.equal(await emptyTrash(), false)
  assert.equal(await purgeTrash(86_400_000), 0, 'nothing purged, nothing thrown')
})
