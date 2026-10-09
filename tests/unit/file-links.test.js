import assert from 'node:assert/strict'
import {test} from 'node:test'

import {ensurePermission} from '../../lib/file-links.js'

test('file links: permission already granted is used without asking again', async () => {
  let requested = 0
  const handle = {
    queryPermission: async () => 'granted',
    requestPermission: async () => {
      requested++
      return 'granted'
    },
  }

  assert.equal(await ensurePermission(handle), true)
  assert.equal(requested, 0, 'a granted handle is never asked twice')
})

test('file links: an undecided permission is asked for exactly once', async () => {
  let requested = 0
  const handle = {
    queryPermission: async () => 'prompt',
    requestPermission: async () => {
      requested++
      return 'granted'
    },
  }

  assert.equal(await ensurePermission(handle), true)
  assert.equal(requested, 1, 'the ask happens at the click, where a decision can be made')
})

test('file links: a refused permission stops the open without asking again', async () => {
  let requested = 0
  const undecided = {
    queryPermission: async () => 'prompt',
    requestPermission: async () => {
      requested++
      return 'denied'
    },
  }
  assert.equal(await ensurePermission(undecided), false)
  assert.equal(requested, 1)

  let asked = 0
  const refused = {
    queryPermission: async () => 'denied',
    requestPermission: async () => {
      asked++
      return 'granted'
    },
  }
  assert.equal(await ensurePermission(refused), false)
  assert.equal(asked, 0, 'a refusal is not re-asked; the browser already answered')
})

test('file links: a handle without a permission API is taken at its word', async () => {
  // The branch a test double or a directly handed handle arrives through.
  assert.equal(await ensurePermission({name: 'plain object'}), true)
  assert.equal(await ensurePermission(undefined), false)
})

test('file links: a handle that throws when asked counts as refused', async () => {
  const broken = {
    queryPermission: async () => {
      throw new Error('nope')
    },
  }
  assert.equal(await ensurePermission(broken), false)
})
