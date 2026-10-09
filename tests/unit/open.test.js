// Opening a file: the size limit that runs before any byte is read, and the
// plain-text happy path beside it so the limit cannot be "enforced" by always
// throwing.

import assert from 'node:assert/strict'
import test from 'node:test'

import {MAX_FILE_BYTES, readFile} from '../../lib/open.js'

/** A File-shaped object: readFile only touches name, type, size and arrayBuffer. */
function fakeFile({name, type, size, bytes}) {
  let read = false
  return {
    file: {
      name,
      type,
      size,
      async arrayBuffer() {
        read = true
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      },
    },
    wasRead: () => read,
  }
}

test('a file past the size limit is refused before its bytes are read', async () => {
  const {file, wasRead} = fakeFile({
    name: 'huge.log',
    type: 'text/plain',
    size: MAX_FILE_BYTES + 1,
    bytes: new Uint8Array(0),
  })

  await assert.rejects(() => readFile(file), /larger than/)
  assert.equal(wasRead(), false, 'arrayBuffer must never be called for an oversized file')
})

test('a file inside the size limit is read as text', async () => {
  const {file} = fakeFile({
    name: 'notes.md',
    type: 'text/markdown',
    size: 4,
    bytes: new TextEncoder().encode('# Hi'),
  })

  const result = await readFile(file)
  assert.equal(result.text, '# Hi')
  assert.equal(result.source, 'notes.md')
})
