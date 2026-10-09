// The folder sync decision table, tested under Node - and the reader that
// feeds it.
//
// planSync is pure for exactly this reason: the whole newest-wins / mirror
// logic is three snapshots in and one list of actions out, so every rule in
// lib/folder-sync.js can be asserted here with no browser, no IndexedDB and
// no folder. gather() is the one executor piece that comes along: it takes a
// directory handle, and a directory handle is just an object with an async
// children iterator, so the read budgets are checked here with megabytes
// claimed and none allocated. Everything needing a real folder or a real
// document library stays in tests/browser/run.js.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_SYNC_FILES,
  MAX_SYNC_FILE_BYTES,
  MAX_SYNC_TOTAL_BYTES,
  gather,
  planSync,
  setFolderSyncNotice,
} from '../../lib/folder-sync.js'
import {parseNote, renderNote} from '../../lib/front-matter.js'

/** A library entry, with the fields the planner reads. */
const entry = (over = {}) => ({
  id: 'n1',
  title: 'Note one',
  text: '# Note one\n\nbody',
  style: null,
  created: 1000,
  updated: 2000,
  words: 2,
  ...over,
})

/** A folder file, parsed the way the executor parses it. */
const file = (name, source, mtime) => {
  const parsed = parseNote(source)
  return {name, mtime, data: parsed.data, text: parsed.text}
}

const manifestWith = (over = {}) => ({n1: {name: 'Note one.md', updated: 2000, fileUpdated: 3000, ...over}})

const types = (plan) => plan.actions.map((action) => action.type)

test('first pass: notes are written, foreign files are imported, nothing is removed', () => {
  const plan = planSync({
    entries: [entry()],
    files: [file('Plain.md', '# Plain\n\nfrom disk', 5000)],
    manifest: {},
  })

  assert.ok(
    !types(plan).includes('remove-note') && !types(plan).includes('remove-file'),
    'an empty manifest never authorises a deletion',
  )

  const write = plan.actions.find((action) => action.type === 'write' && action.id === 'n1')
  assert.equal(write.name, 'Note one.md')
  assert.match(write.text, /^---\nid: n1\n/)

  const adopt = plan.actions.find((action) => action.type === 'import')
  assert.equal(adopt.record.title, 'Plain')
  assert.equal(adopt.record.text, '# Plain\n\nfrom disk')
  assert.equal(adopt.record.created, 5000, 'a file with no block dates from its mtime')
  assert.ok(adopt.record.id, 'the import gets an id of its own')

  // The adopted file gets its block written back, or the next rename orphans it.
  const writeBack = plan.actions.find(
    (action) => action.type === 'write' && action.name === 'Plain.md',
  )
  assert.ok(writeBack, 'the adopted file is written back with its id')
  assert.equal(writeBack.text, renderNote(adopt.record))
})

test('an untouched pair produces no actions at all', () => {
  const rendered = renderNote(entry())
  const plan = planSync({
    entries: [entry()],
    files: [file('Note one.md', rendered, 3000)],
    manifest: manifestWith(),
  })

  assert.deepEqual(plan.actions, [])
  assert.deepEqual(plan.manifest.n1, {name: 'Note one.md', updated: 2000, fileUpdated: 3000})
})

test('a note edited in the app is written out', () => {
  const edited = entry({updated: 4000, text: '# Note one\n\nnew material'})
  const plan = planSync({
    entries: [edited],
    files: [file('Note one.md', renderNote(entry()), 3000)],
    manifest: manifestWith(),
  })

  assert.deepEqual(types(plan), ['write'])
  const [write] = plan.actions
  assert.equal(write.name, 'Note one.md')
  assert.equal(write.remove, null)
  assert.match(write.text, /new material/)
  assert.equal(plan.manifest.n1.fileUpdated, null, 'the executor fills in the real mtime')
})

test('an updated bump with identical text does not touch the file', () => {
  const plan = planSync({
    entries: [entry({updated: 4000})],
    files: [file('Note one.md', renderNote(entry()), 3000)],
    manifest: manifestWith(),
  })

  assert.deepEqual(plan.actions, [], 'a save that changed nothing is not a change')
  assert.equal(plan.manifest.n1.updated, 4000, 'the manifest still moves on')
})

test('an edit in the folder is imported, newest wins', () => {
  const onDisk = renderNote(entry({text: '# Note one\n\nedited in another editor', updated: 9000}))
  const plan = planSync({
    entries: [entry()],
    files: [file('Note one.md', onDisk, 9000)],
    manifest: manifestWith(),
  })

  assert.deepEqual(types(plan), ['import'])
  const [imported] = plan.actions
  assert.equal(imported.record.id, 'n1', 'the id in the file keeps it the same note')
  assert.equal(imported.record.text, '# Note one\n\nedited in another editor')
  assert.equal(imported.record.updated, 9000, 'the file keeps its own moment')
  assert.equal(plan.manifest.n1.updated, 9000)
})

test('a touch with identical content is not a change', () => {
  const plan = planSync({
    entries: [entry()],
    files: [file('Note one.md', renderNote(entry()), 9000)],
    manifest: manifestWith(),
  })

  assert.deepEqual(plan.actions, [], 'same text, new mtime: nothing to do')
  assert.equal(plan.manifest.n1.fileUpdated, 9000, 'the manifest records the mtime it saw')
})

test('when both sides changed, the newer one wins', () => {
  const olderFile = file(
    'Note one.md',
    renderNote(entry({text: '# Note one\n\nfile half', updated: 9000})),
    9600,
  )

  const fileWins = planSync({
    entries: [entry({updated: 9500, text: '# Note one\n\napp half'})],
    files: [olderFile],
    manifest: manifestWith(),
  })
  assert.deepEqual(types(fileWins), ['import'])
  assert.equal(fileWins.actions[0].record.text, '# Note one\n\nfile half')

  const appWins = planSync({
    entries: [entry({updated: 9900, text: '# Note one\n\napp half'})],
    files: [olderFile],
    manifest: manifestWith(),
  })
  assert.deepEqual(types(appWins), ['write'])
  assert.match(appWins.actions[0].text, /app half/)
})

test('a tracked file deleted in the Finder takes the note with it', () => {
  const plan = planSync({entries: [entry()], files: [], manifest: manifestWith()})

  assert.deepEqual(types(plan), ['remove-note'])
  assert.equal(plan.actions[0].id, 'n1')
  assert.deepEqual(plan.manifest, {}, 'the manifest forgets the pair')
})

test('a note deleted in the app takes its file with it', () => {
  const source = renderNote(entry())
  const byId = planSync({entries: [], files: [file('Note one.md', source, 3000)], manifest: manifestWith()})
  assert.deepEqual(types(byId), ['remove-file'])

  // Even when the file has no block left, the tracked name is enough.
  const byName = planSync({
    entries: [],
    files: [file('Note one.md', '# Note one\n\nbody', 3000)],
    manifest: manifestWith(),
  })
  assert.deepEqual(types(byName), ['remove-file'])
})

test('an untracked file is imported, never deleted', () => {
  const plan = planSync({
    entries: [],
    files: [file('Someone else.md', '# Not ours\n\nleave me alone', 3000)],
    manifest: {},
  })

  assert.deepEqual(types(plan), ['import', 'write'])
  assert.equal(plan.actions[0].record.title, 'Not ours')
})

test('a file whose id the app has never seen is imported under that id', () => {
  const source = '---\nid: foreign-1\ncreated: 5\nupdated: 6\n---\n# Foreign\n\ntext'
  const plan = planSync({
    entries: [],
    files: [file('Foreign.md', source, 5)],
    manifest: {},
  })

  assert.deepEqual(types(plan), ['import'], 'the id is present, so no write-back is needed')
  assert.equal(plan.actions[0].record.id, 'foreign-1')
  assert.equal(plan.actions[0].record.updated, 6, 'the claim and the mtime, whichever is later')
})

test('two files claiming one id: one is handled, the other is left alone', () => {
  const rendered = renderNote(entry())
  const first = file('Note one.md', rendered, 1500)
  const second = file('Copy of Note one.md', rendered, 1500)

  const plan = planSync({entries: [entry()], files: [first, second], manifest: {}})

  assert.deepEqual(plan.actions, [], 'the duplicate is not imported and not removed')
  assert.equal(Object.keys(plan.manifest).length, 1, 'one note, one manifest slot')
  assert.equal(plan.manifest.n1.name, 'Note one.md', 'the first file in the folder wins')
})

test('a title change renames the file', () => {
  const renamed = entry({title: 'Renamed', text: '# Renamed\n\nbody', updated: 4000})
  const plan = planSync({
    entries: [renamed],
    files: [file('Note one.md', renderNote(entry()), 3000)],
    manifest: manifestWith(),
  })

  assert.deepEqual(types(plan), ['write'])
  assert.equal(plan.actions[0].name, 'Renamed.md')
  assert.equal(plan.actions[0].remove, 'Note one.md', 'the old file goes with the new name')
})

test('two notes with one title get two files', () => {
  const plan = planSync({
    entries: [entry(), entry({id: 'n2', updated: 2500})],
    files: [],
    manifest: {},
  })

  const names = plan.actions.map((action) => action.name)
  assert.deepEqual(names, ['Note one.md', 'Note one (2).md'])
})

test('a tracked file that lost its block is re-adopted with its id', () => {
  const stripped = file('Note one.md', '# Note one\n\nbody', 9000)
  assert.equal(stripped.data, null, 'the fixture really has no block')

  const plan = planSync({entries: [entry()], files: [stripped], manifest: manifestWith()})

  // The text already matches the library, so there is nothing to import -
  // only the block to put back, while the tracked name still proves whose it is.
  assert.deepEqual(types(plan), ['write'])
  assert.equal(plan.actions[0].name, 'Note one.md')
  assert.match(plan.actions[0].text, /^---\nid: n1\n/, 'the block comes back')
  assert.equal(plan.manifest.n1.fileUpdated, null)
})

test('a block-less file that also changed is imported, and the write-back keeps the new text', () => {
  const stripped = file('Note one.md', '# Note one\n\nchanged outside', 9000)

  const plan = planSync({entries: [entry()], files: [stripped], manifest: manifestWith()})

  assert.deepEqual(types(plan), ['import', 'write'])
  assert.equal(plan.actions[0].record.text, '# Note one\n\nchanged outside')

  // The write-back must describe what the library now holds, not what it held
  // before the import: rendering the old entry here would put the old body
  // back over the file that just won.
  assert.match(plan.actions[1].text, /changed outside/)
  assert.equal(plan.manifest.n1.updated, 9000, 'the manifest follows the imported moment')
})

test('a renamed file is still the same note', () => {
  const rendered = renderNote(entry())
  const plan = planSync({
    entries: [entry()],
    files: [file('Whatever she called it.md', rendered, 3000)],
    manifest: manifestWith({fileUpdated: 3000}),
  })

  assert.deepEqual(plan.actions, [], 'the id inside the file beats the name outside it')
  assert.equal(
    plan.manifest.n1.name,
    'Whatever she called it.md',
    'and the manifest follows the name the file actually has',
  )
})

/** A file over the read budget: identified by the probe, text never read. */
const bigFile = (name, data = null, mtime = 3000) => ({
  name,
  mtime,
  data,
  text: null,
  tooBig: true,
})

test('an oversized file is present but never read, imported or written', () => {
  // Tracked: presence only, and the slot follows the name the file really has.
  const tracked = planSync({
    entries: [entry()],
    files: [bigFile('Note one.md', {id: 'n1'})],
    manifest: manifestWith(),
  })
  assert.deepEqual(tracked.actions, [], 'nothing may compare against text that was never read')
  assert.deepEqual(tracked.manifest.n1, {name: 'Note one.md', updated: 2000, fileUpdated: 3000})

  // Matched by the tracked name alone when the probe found no block.
  const blockless = planSync({
    entries: [entry()],
    files: [bigFile('Note one.md')],
    manifest: manifestWith(),
  })
  assert.deepEqual(blockless.actions, [])
  assert.equal(blockless.manifest.n1.name, 'Note one.md', 'the pair survives without an id')

  // Untracked: over budget is not an invitation to adopt it, and never a
  // reason to remove it either.
  const foreign = planSync({
    entries: [],
    files: [bigFile('Foreign.md', {id: 'foreign-1'})],
    manifest: {},
  })
  assert.deepEqual(foreign.actions, [])
  assert.deepEqual(foreign.manifest, {})
})

test('an oversized file renamed in the Finder is still the same note', () => {
  const plan = planSync({
    entries: [entry()],
    files: [bigFile('Renamed elsewhere.md', {id: 'n1'}, 7000)],
    manifest: manifestWith(),
  })

  assert.deepEqual(plan.actions, [], 'the probe found the id, but the text stays unread')
  assert.equal(plan.manifest.n1.name, 'Renamed elsewhere.md')
  assert.equal(plan.manifest.n1.fileUpdated, 7000)
})

test('a deleted note still takes its oversized file with it', () => {
  // Removal needs the name, not the contents, so the budget changes nothing
  // about the deletion half of the mirror.
  const plan = planSync({
    entries: [],
    files: [bigFile('Note one.md', {id: 'n1'})],
    manifest: manifestWith(),
  })
  assert.deepEqual(types(plan), ['remove-file'])
})

/* --------------------------------------------------------------- gathering */

/**
 * A file as gather sees it: size and mtime claimed independently of the bytes
 * behind them, which is how a megabyte budget gets tested without allocating
 * a megabyte, and with a counter to prove an over-budget body was never read.
 */
const fakeFile = ({size, body = '', modified = 1000, probe = null}) => {
  const calls = {text: 0, slice: 0}
  return {
    size,
    lastModified: modified,
    calls,
    async text() {
      calls.text++
      if (body instanceof Error) throw body
      return body
    },
    slice() {
      calls.slice++
      return {
        text: async () => {
          if (probe instanceof Error) throw probe
          return probe ?? ''
        },
      }
    },
  }
}

/** A directory handle built from plain objects. */
const fakeDir = (children) => ({
  values: () =>
    (async function* () {
      for (const child of children) yield child
    })(),
})

const fakeChild = (name, file, kind = 'file') => ({
  kind,
  name,
  getFile: async () => {
    if (file instanceof Error) throw file
    return file
  },
})

/** Collect the notices a gather produces, and put the default back after. */
async function withNotices(run) {
  const notices = []
  setFolderSyncNotice((message) => notices.push(message))
  try {
    return await run(notices)
  } finally {
    setFolderSyncNotice(null)
  }
}

test('gather reads the markdown and nothing else in the folder', async () => {
  const note = fakeFile({
    size: 40,
    body: '---\nid: n7\n---\n# Note\n\nbody',
    modified: 7000,
  })
  const other = fakeFile({size: 50, body: 'this is not a note'})
  const files = await gather(
    fakeDir([
      fakeChild('Note.md', note),
      fakeChild('notes.txt', other),
      fakeChild('sub', other, 'directory'),
    ]),
  )

  assert.equal(files.length, 1, 'only .md files take part')
  assert.deepEqual(
    {name: files[0].name, mtime: files[0].mtime, id: files[0].data?.id},
    {name: 'Note.md', mtime: 7000, id: 'n7'},
  )
  assert.equal(files[0].text, '# Note\n\nbody')
  assert.equal(note.calls.text, 1, 'read once, in full')
  assert.equal(other.calls.text, 0, 'the txt and the directory are never opened')
})

test('a file over the per-file budget is identified by a probe and never read', async () => {
  await withNotices(async (notices) => {
    const big = fakeFile({
      size: MAX_SYNC_FILE_BYTES + 1,
      body: new Error('the body must not be read'),
      probe: '---\nid: big-9\n---\n# Big',
    })
    const files = await gather(fakeDir([fakeChild('Big.md', big)]))

    assert.equal(files.length, 1)
    assert.equal(files[0].tooBig, true, 'present, but out of the pass')
    assert.equal(files[0].text, null)
    assert.equal(files[0].data?.id, 'big-9', 'the probe found whose file it is')
    assert.equal(big.calls.text, 0, 'the body itself was never read')
    assert.equal(big.calls.slice, 1, 'exactly one probe of the top')
    assert.ok(
      notices.some((message) => message.includes('Big.md')),
      `the file that sat out was announced: ${JSON.stringify(notices)}`,
    )
  })
})

test('the total budget stops the reads, one probe each for what is left', async () => {
  const atCap = MAX_SYNC_FILE_BYTES
  const claimed = Array.from({length: 11}, () => fakeFile({size: atCap, body: '# Spoke'}))
  const children = claimed.map((file, index) => fakeChild(`Spoke ${index}.md`, file))
  const files = await gather(fakeDir(children))

  const read = files.filter((file) => !file.tooBig)
  const probed = files.filter((file) => file.tooBig)
  assert.equal(
    read.length * atCap,
    MAX_SYNC_TOTAL_BYTES,
    'files at the per-file size fill the pass exactly at the total',
  )
  assert.equal(probed.length, 1, 'the eleventh is over the total, not the per-file, bound')
  assert.equal(probed[0].name, 'Spoke 10.md')
  assert.deepEqual(
    claimed.map((file) => file.calls.text),
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    'the last file is probed, never read',
  )
  assert.equal(claimed[10].calls.slice, 1, 'and probed exactly once')
  assert.equal(claimed[0].calls.slice, 0, 'the read files are never probed')
})

test('more markdown than the count budget stops the pass before it starts', async () => {
  const many = Array.from({length: MAX_SYNC_FILES + 1}, (_, index) =>
    fakeChild(`N${index}.md`, fakeFile({size: 5, body: '# x'})),
  )
  await assert.rejects(gather(fakeDir(many)), new RegExp(`more than ${MAX_SYNC_FILES} markdown files`))

  // The limit counts markdown only: directories and other files past it are
  // not what it is there to stop, and a folder exactly at the limit passes.
  const atLimit = Array.from({length: MAX_SYNC_FILES}, (_, index) =>
    fakeChild(`N${index}.md`, fakeFile({size: 5, body: '# x'})),
  )
  atLimit.push(fakeChild('notes.txt', fakeFile({size: 5})))
  atLimit.push(fakeChild('sub', fakeFile({size: 5}), 'directory'))
  const files = await gather(fakeDir(atLimit))
  assert.equal(files.length, MAX_SYNC_FILES)
})

test('a folder that cannot be read aborts with one clear message', async () => {
  const gone = new Error('NotReadableError: the folder went away')
  await assert.rejects(gather(fakeDir([fakeChild('Note.md', gone)])), /could not be read/)

  const badRead = new Error('NotReadableError: the file went away')
  await assert.rejects(
    gather(fakeDir([fakeChild('Note.md', fakeFile({size: 10, body: badRead}))])),
    /could not be read/,
  )

  const badProbe = new Error('NotReadableError: the probe went away')
  await assert.rejects(
    gather(
      fakeDir([
        fakeChild('Big.md', fakeFile({size: MAX_SYNC_FILE_BYTES + 1, probe: badProbe})),
      ]),
    ),
    /could not be read/,
  )
})

test('an oversized file is announced once, not on every pass', async () => {
  await withNotices(async (notices) => {
    const pass = () =>
      gather(
        fakeDir([
          fakeChild('Once.md', fakeFile({size: MAX_SYNC_FILE_BYTES + 1, probe: ''})),
        ]),
      )
    await pass()
    await pass()

    assert.equal(
      notices.filter((message) => message.includes('Once.md')).length,
      1,
      `one notice per name per connection: ${JSON.stringify(notices)}`,
    )
  })
})
