// Keeping the library and a folder on this computer in step.
//
// The menu's "Folder sync" points the app at a directory with the File System
// Access API and mirrors the document library into it: every note is one
// markdown file, and every change on either side finds the other. The API
// exists in Chrome and Edge, so the feature is hidden where it does not, and
// nothing about it talks to a network - the folder is wherever the reader
// pointed, as local as the library itself.
//
// Three decisions shape everything below.
//
//   A manifest, not guessing. IndexedDB remembers which file each note was
//   mirrored to ({name, updated, fileUpdated}). That is what makes deletion
//   safe in both directions: a tracked file that disappears was deleted in the
//   Finder, so the note goes to the trash, and a note that disappears sends its
//   file to .textarea/sync-removed in the folder. Neither is destroyed by a
//   pass, and a pass that would remove a lot at once stops and asks first (see
//   removalBrake): a folder that merely looks empty is not a deletion. Files
//   this app never tracked are only ever read or imported, never removed, so
//   pointing it at a folder cannot destroy anything else in there. On a fresh
//   manifest nothing is ever deleted at all, which is what makes the first
//   connect a read-only pass in practice.
//
//   Newest wins, decided by planSync. The whole decision table is a pure
//   function over three snapshots - library entries, folder files, manifest -

//   so it can be unit tested under Node without a handle, a browser or a
//   folder. This file is the executor around it: enumerate, read, apply.
//
//   Sync while the app is open. Triggers are saves, window focus and coming
//   back to the tab; there is no daemon, and an edit made in another editor
//   while the app was closed lands on the next focus. Failures never touch
//   the note: a folder that cannot be read aborts the pass with a message and
//   keeps the manifest for the next one.
//
// The files are plain markdown with front matter, which is to say plaintext on
// disk. That is the point of a folder you can open in any editor, and it is
// stated in the README rather than left to be discovered.

import {
  moveToTrash,
  newId,
  putDocument,
  readAllDocuments,
} from './library.js'
import {fileTimestamp, filenameFor, parseNote, renderNote, titleOf} from './front-matter.js'
import {countStats} from './stats.js'
import {sanitizeStyle} from './style.js'

const DB_NAME = 'textarea-sync'
const DB_VERSION = 1
const STORE = 'state'
const RECORD_ID = 'folder'
const PERMISSION = {mode: 'readwrite'}
const SYNC_DEBOUNCE = 800
const SYNC_LOCK = 'textarea-sync'
const MARKDOWN = '.md'

// The budgets. A folder is whatever else may have written to it, so reading
// one follows the same rule every other input in this app follows: a bound
// before anything is read. A file over the per-file bound is identified by a
// probe of its first few bytes - the block always lives at the top - and then
// left completely alone: not read, not written, not renamed, not removed. A
// pass that would read past the total, or see more files than this, stops
// before the plan runs, so nothing is ever half-applied. Exported because a
// budget nobody checks is a budget nobody keeps.
export const MAX_SYNC_FILE_BYTES = 10 * 1024 * 1024
export const MAX_SYNC_TOTAL_BYTES = 100 * 1024 * 1024
export const MAX_SYNC_FILES = 1000
const PROBE_BYTES = 4096

// The brake: how much one pass may remove before it stops and asks.
export const BRAKE_MIN_REMOVALS = 3
export const BRAKE_SHARE = 0.25

// Where a file the mirror removes waits, inside the folder but out of the
// pass's sight: gather reads the top level only.
const SIDECAR = '.textarea'
const PARKED = 'sync-removed'
const PARKED_KEEP_MS = 30 * 86_400_000

/** Oversized files are reported once per connection, not on every pass. */
const oversizedWarned = new Set()

/** The directory, and the manifest that names each note's file. */
let handle = null
let manifest = {}
let active = false
let notice = () => {}
let apply = () => {}
let gate = () => {}
let timer = null
let chain = Promise.resolve()
// How the menu row reads: a pass on the move, the last one's verdict, and the
// last problem until a pass succeeds again.
let inFlight = 0
let lastPass = null
let lastProblem = null
// A pass the brake stopped: what it would have removed, and who to tell.
let paused = null
let approved = null
let brakeHandler = () => {}

/**
 * Whether this browser can point at a folder at all.
 *
 * A function check rather than `'showDirectoryPicker' in window`: the property
 * exists in insecure contexts too, where calling it throws.
 */
export function folderSyncAvailable() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

/**
 * How the menu should read: is it on, to what, and how it is going.
 *
 * `name` is the folder remembered, running or not: one waiting for its
 * permission back still names itself, so the row can say which folder is
 * being waited on rather than reading as sync simply being off. `syncing`
 * counts a pass that has started (or is queued behind one), `pending` the
 * pause that will start one, `lastPass` the last verdict, and `problem` the
 * last failure - sticky until a pass succeeds again, so a row checked a
 * minute after a failure still says so.
 */
export function folderSyncStatus() {
  return {
    supported: folderSyncAvailable(),
    active,
    name: handle?.name ?? '',
    syncing: inFlight > 0,
    pending: timer !== null,
    lastPass: lastPass ? {...lastPass} : null,
    problem: lastProblem,
    paused: paused ? {notes: paused.notes, files: paused.files, tracked: paused.tracked} : null,
  }
}

/**
 * The manifest as it stands: {id: {name, updated, fileUpdated}}, copied so
 * the caller cannot reach the sync's own object.
 *
 * Exported for the console and the tests, the same audience
 * connectToDirectory serves - a test that wants to know what the last pass
 * committed should ask the sync, not go around it to the record it wrote.
 */
export function folderSyncManifest() {
  return structuredClone(manifest)
}

/**
 * The queue's tail: everything queued or in flight, in order.
 *
 * A caller that needs the mirror to have done everything it will ever do
 * waits on this instead of guessing how long that takes - a stopped sync
 * still finishes the pass it was in the middle of, and that pass is exactly
 * what a test about stopping has to see the end of.
 */
export function folderSyncIdle() {
  return chain
}

/**
 * Whether a pause is armed: the timer that would run a pass on its own.
 *
 * A caller that just asked for a sync wants to know the pause that request
 * replaced is really gone, and there is no condition to poll for a timer
 * that will never fire - this reads it instead. Reads null when nothing is
 * waiting to run.
 */
export function folderSyncPending() {
  return timer
}

/**
 * Where background syncs report problems: (message, isError) => void.
 *
 * Kept out of this module so it stays free of the DOM and unit testable.
 */
export function setFolderSyncNotice(callback) {
  notice = typeof callback === 'function' ? callback : () => {}
}

/**
 * Where an imported note is handed to the editor: (record) => void.
 *
 * The library is half the mirror and the open note is the other half. The
 * app applies a record only to the note it is actually editing; every other
 * record is library-only, so this stays a one-argument hook.
 */
export function setFolderSyncApply(callback) {
  apply = typeof callback === 'function' ? callback : () => {}
}

/**
 * Where a pass can be held between its plan and its commit: async () => void.
 *
 * That window is where the races the queueing below closes actually live - a
 * deletion, or a disconnect - and it opens and shuts inside one awaited pass,
 * so no test can land anything in it from outside. The tests hold it open
 * instead and put the second event there. The app never sets one, and a gate
 * left installed by a test cannot wedge the sync: a released gate lets every
 * later pass straight through.
 */
export function setFolderSyncGate(callback) {
  gate = typeof callback === 'function' ? callback : () => {}
}

/**
 * Who to ask when the brake stops a pass: ({notes, files, tracked}) => void.
 * Called once per stop, not on every pass that finds the same thing.
 */
export function setFolderSyncBrake(callback) {
  brakeHandler = typeof callback === 'function' ? callback : () => {}
}

/* --------------------------------------------------------------- deciding */

/**
 * Whether a plan removes too much to be believed without asking.
 *
 * A cloud client mid-resync, a swapped mount and a library that failed to open
 * all look exactly like the reader deleting everything, and planSync cannot
 * tell them apart: it is right about what changed and wrong about why. One
 * file deleted in the Finder is routine, so the brake only looks at a pass
 * that removes everything tracked (two or more), or at least BRAKE_MIN_REMOVALS
 * and BRAKE_SHARE of it.
 *
 * @param {{actions: Array<{type: string}>}} plan
 * @param {Record<string, object>} manifest  the manifest the plan was made from
 * @returns {{notes: number, files: number, tracked: number}|null} null when the plan may run
 */
export function removalBrake(plan, manifest) {
  const notes = plan.actions.filter((action) => action.type === 'remove-note').length
  const files = plan.actions.filter((action) => action.type === 'remove-file').length
  const removals = notes + files
  const tracked = Object.keys(manifest).length
  if (!removals) return null
  const everything = tracked >= 2 && removals >= tracked
  const aLot = removals >= BRAKE_MIN_REMOVALS && removals / tracked >= BRAKE_SHARE
  return everything || aLot ? {notes, files, tracked} : null
}

/**
 * What one reconcile should do, decided from the three places a note lives.
 *
 * Pure by design: reads nothing, writes nothing, knows nothing about handles.
 * The rules, in order, for every note:
 *
 *   - File gone, manifest says there was one -> the note was deleted outside
 *     the app, and the mirror removes it too. No manifest entry, no deletion:
 *     this is also why the first pass over a folder never removes anything.
 *   - File newer than the note -> import it, unless the text is identical, in
 *     which case only the manifest moves (a touch is not an edit).
 *   - Note newer, or nothing changed -> write the file when the text, style or
 *     filename actually differs; otherwise refresh the manifest and stop.
 *
 * And for every file no note claimed: a tracked name whose note is gone is
 * removed (deletion in the other direction), a file carrying an id this app
 * knows is imported under that id, and a plain markdown file the app has never
 * seen is imported with a fresh id and written back with its block - adopted,
 * never deleted.
 *
 * @param {object} snapshot
 * @param {Array<object>} snapshot.entries  library entries
 * @param {Array<{name: string, mtime: number, data: object|null, text: string|null, tooBig?: boolean}>} snapshot.files
 *   tooBig files are over the read budget: identified, present, never read -
 *   their text is null and no action may depend on it.
 * @param {Record<string, {name: string, updated: number, fileUpdated: number}>} snapshot.manifest
 * @returns {{actions: Array<object>, manifest: Record<string, object>}}
 *   Slots with fileUpdated: null are files the executor has just written; it
 *   fills in the real mtime afterwards, so our own write never looks like an
 *   external change on the next pass.
 */
export function planSync({entries, files, manifest}) {
  const actions = []
  const next = {}
  const ids = new Set(entries.map((entry) => entry.id))

  const byName = new Map(files.map((file) => [file.name, file]))
  const byId = new Map()
  for (const file of files) {
    if (file.data?.id && !byId.has(file.data.id)) byId.set(file.data.id, file)
  }

  const taken = new Set(files.map((file) => file.name.toLowerCase()))
  const matched = new Set()

  for (const entry of entries) {
    const tracked = manifest[entry.id]

    // The id in the file wins, so a renamed file is still this note. Falling
    // back to the tracked name only adopts a file with no id of its own (or
    // this note's own id), never one another note now claims.
    let file = byId.get(entry.id) ?? null
    if (!file && tracked) {
      const candidate = byName.get(tracked.name)
      if (candidate && (!candidate.data?.id || candidate.data.id === entry.id)) file = candidate
    }

    if (!file) {
      if (tracked) {
        actions.push({type: 'remove-note', id: entry.id})
      } else {
        const name = filenameFor(entry.title, taken, null)
        taken.add(name.toLowerCase())
        actions.push({type: 'write', id: entry.id, name, text: renderNote(entry), remove: null})
        next[entry.id] = {name, updated: entry.updated, fileUpdated: null}
      }
      continue
    }

    matched.add(file.name)

    // Over the read budget: this pass cannot compare, import or rewrite the
    // file, and must not write to it either - that would replace whatever is
    // on disk with far less of it. The slot still follows the name the file
    // actually has, so nothing about the pair is forgotten.
    if (file.tooBig) {
      next[entry.id] = {name: file.name, updated: entry.updated, fileUpdated: file.mtime}
      continue
    }

    const appChanged = entry.updated > (tracked?.updated ?? 0)
    const fileChanged = file.mtime > (tracked?.fileUpdated ?? 0)
    const fileTs = fileTimestamp(file.data, file.mtime)

    if (fileChanged && fileTs > entry.updated) {
      // Whichever record the library ends up holding is what the block has to
      // describe: the imported one when the file won, the entry when only the
      // block itself is missing.
      let source = entry
      if (!sameNote(entry, file)) {
        const record = importRecord(file, entry)
        actions.push({type: 'import', record})
        source = record
      }
      if (!file.data?.id) {
        // Identical text or not, a file with no id in it is one rename away
        // from being nobody's note. The block goes back in while the tracked
        // name still proves whose it is.
        actions.push({type: 'write', id: entry.id, name: file.name, text: renderNote(source), remove: null})
        next[entry.id] = {name: file.name, updated: source.updated, fileUpdated: null}
      } else {
        next[entry.id] = {name: file.name, updated: source.updated, fileUpdated: file.mtime}
      }
      continue
    }

    // The app side wins, or nothing changed on either side. The file is only
    // touched when something a reader can see differs.
    const name = filenameFor(entry.title, taken, file.name)
    if (!file.data?.id) {
      actions.push({
        type: 'write',
        id: entry.id,
        name,
        text: renderNote(entry),
        remove: name !== file.name ? file.name : null,
      })
      next[entry.id] = {name, updated: entry.updated, fileUpdated: null}
      continue
    }
    if ((appChanged || fileChanged) && (!sameNote(entry, file) || name !== file.name)) {
      taken.delete(file.name.toLowerCase())
      taken.add(name.toLowerCase())
      actions.push({
        type: 'write',
        id: entry.id,
        name,
        text: renderNote(entry),
        remove: name !== file.name ? file.name : null,
      })
      next[entry.id] = {name, updated: entry.updated, fileUpdated: null}
      continue
    }

    taken.add(file.name.toLowerCase())
    next[entry.id] = {name: file.name, updated: entry.updated, fileUpdated: file.mtime}
  }

  for (const file of files) {
    if (matched.has(file.name)) continue

    const id = file.data?.id
    // Two files claiming one id: one of them matched above, and the other is
    // not ours to interpret, let alone delete.
    if (id && ids.has(id)) continue

    const trackedBySomething = (id && manifest[id]) || nameTracked(manifest, file.name)
    if (trackedBySomething) {
      // The note is gone from the library: the file is the other half of a
      // deletion the hook may have missed (another tab, a crashed pass).
      // Removing needs the name, not the contents, so over budget is no bar.
      actions.push({type: 'remove-file', name: file.name})
      continue
    }

    // Present but over budget with no note answering for it: left exactly as
    // it is. Importing would need the text this pass refuses to read.
    if (file.tooBig) continue

    const record = importRecord(file, null)
    actions.push({type: 'import', record})
    if (!file.data?.id) {
      actions.push({
        type: 'write',
        id: record.id,
        name: file.name,
        text: renderNote(record),
        remove: null,
      })
      next[record.id] = {name: file.name, updated: record.updated, fileUpdated: null}
    } else {
      next[record.id] = {name: file.name, updated: record.updated, fileUpdated: file.mtime}
    }
  }

  return {actions, manifest: next}
}

/** Whether a file is the one some note's manifest entry points at. */
function nameTracked(manifest, name) {
  return Object.values(manifest).some((slot) => slot.name === name)
}

/** Same body, same style: whether either side's *content* differs. */
function sameNote(entry, file) {
  // The block is deliberately not compared: it carries the timestamps, and a
  // save that moved `updated` without moving a character is not a change worth
  // writing to disk. The manifest is the authority for those.
  return entry.text === file.text && entry.style === (file.data?.style ?? null)
}

/** The library record a file becomes. The style half is sanitised by the executor. */
function importRecord(file, entry) {
  const id = file.data?.id ?? entry?.id ?? newId()
  const created = entry?.created ?? (Number(file.data?.created) || file.mtime)
  const text = file.text
  return {
    id,
    title: titleOf(text),
    text,
    style: file.data?.style ?? null,
    created,
    updated: fileTimestamp(file.data, file.mtime),
    words: countStats(text).words,
  }
}

/* -------------------------------------------------------------- executing */

/**
 * Every .md file in the folder: name, mtime, parsed block, text.
 *
 * Exported for the unit tests, which hand it a directory built from plain
 * objects - the budgets are exercised there with megabytes claimed and none
 * allocated, and a folder that fails to open is one child that throws.
 *
 * @param {{values: () => AsyncIterable<{kind: string, name: string, getFile: () => Promise<object>}>}} dir
 * @returns {Promise<Array<{name: string, mtime: number, data: object|null, text: string|null, tooBig?: boolean}>>}
 */
export async function gather(dir) {
  const files = []
  let total = 0
  let overflow = false
  try {
    for await (const child of dir.values()) {
      if (child.kind !== 'file' || !child.name.toLowerCase().endsWith(MARKDOWN)) continue
      if (files.length >= MAX_SYNC_FILES) {
        overflow = true
        break
      }
      const file = await child.getFile()
      if (file.size > MAX_SYNC_FILE_BYTES || total + file.size > MAX_SYNC_TOTAL_BYTES) {
        // Identified, never read: the block is at the top, so a probe is
        // enough for planSync to know whose file this is - and nothing else.
        const data = parseNote(await file.slice(0, PROBE_BYTES).text()).data
        files.push({name: child.name, mtime: file.lastModified, data, text: null, tooBig: true})
        warnOversized(child.name)
        continue
      }
      total += file.size
      const parsed = parseNote(await file.text())
      files.push({name: child.name, mtime: file.lastModified, data: parsed.data, text: parsed.text})
    }
  } catch {
    throw new Error(
      'The sync folder could not be read. Check that it is still there and that the browser may still read it.',
    )
  }
  if (overflow) {
    // Stopping before the plan is what makes this safe: files past the limit
    // were never seen, and a pass that never ran cannot delete by their absence.
    throw new Error(
      `The sync folder holds more than ${MAX_SYNC_FILES} markdown files, which is more than one pass can tell apart. Sync stops until the folder has fewer.`,
    )
  }
  return files
}

/** One notice per oversized file per connection, so every pass stays quiet. */
function warnOversized(name) {
  if (oversizedWarned.has(name)) return
  oversizedWarned.add(name)
  const mb = Math.round(MAX_SYNC_FILE_BYTES / (1024 * 1024))
  notice(`${name} is over the ${mb} MB a synced file may be, so it was left untouched`, false)
}

async function writeFile(dir, name, text) {
  const file = await dir.getFileHandle(name, {create: true})
  const writable = await file.createWritable()
  await writable.write(text)
  await writable.close()
  return file
}

async function removeFile(dir, name) {
  try {
    await dir.removeEntry(name)
  } catch {
    // Already gone, which is what a mirror wants anyway.
  }
}

/**
 * Take a file out of the mirror without destroying it: a copy goes into
 * .textarea/sync-removed under a timestamp, and only then does the file leave.
 * A copy that fails throws, and the pass stops with the file still in place.
 */
async function parkFile(dir, name) {
  let child
  try {
    child = await dir.getFileHandle(name)
  } catch {
    return
  }
  const sidecar = await dir.getDirectoryHandle(SIDECAR, {create: true})
  const parked = await sidecar.getDirectoryHandle(PARKED, {create: true})
  const now = Date.now()
  const copy = await parked.getFileHandle(`${now}-${name}`, {create: true})
  const writable = await copy.createWritable()
  await writable.write(await child.getFile())
  await writable.close()
  await removeFile(dir, name)
  for await (const old of parked.values()) {
    const stamp = Number.parseInt(old.name, 10)
    if (old.kind === 'file' && stamp && now - stamp > PARKED_KEEP_MS) await removeFile(parked, old.name)
  }
}

async function reconcile() {
  // Captured once: a disconnect that lands while this pass is awaiting must
  // not turn into "the folder could not be read" over a handle already gone.
  const dir = handle
  if (!dir || !active) return null

  const entries = await readAllDocuments()
  const files = await gather(dir)
  const plan = planSync({entries, files, manifest})
  const counts = {written: 0, imported: 0, removed: 0}

  const allowed = approved
  approved = null
  const brake = removalBrake(plan, manifest)
  const removals = brake ? brake.notes + brake.files : 0
  if (brake && !(allowed && removals <= allowed)) {
    // Stopped before the first action, so a folder that comes back (a mount, a
    // cloud client finishing) simply passes on the next try.
    const same = paused && paused.notes === brake.notes && paused.files === brake.files
    const parkedIds = plan.actions.filter((action) => action.type === 'remove-note').map((action) => action.id)
    const parkedFiles = plan.actions.filter((action) => action.type === 'remove-file').map((action) => action.name)
    paused = {
      ...brake,
      ids: parkedIds,
      names: parkedFiles,
      fileIds: parkedFiles.map((name) => files.find((file) => file.name === name)?.data?.id).filter(Boolean),
    }
    if (!same) {
      notice(`Sync paused: ${removals} of ${brake.tracked} notes look deleted. Nothing was removed.`, true)
      brakeHandler(folderSyncStatus().paused)
    }
    return null
  }
  paused = null

  let trashed = 0
  for (const action of plan.actions) {
    if (action.type === 'write') {
      await writeFile(dir, action.name, action.text)
      if (action.remove && action.remove !== action.name) await removeFile(dir, action.remove)
      counts.written++
    } else if (action.type === 'import') {
      const record = await putDocument({...action.record, style: sanitizeStyle(action.record.style)})
      counts.imported++
      // The library is only half the mirror: if this note is the one on
      // screen, the editor is the other half and would otherwise be the stale
      // copy that overwrites the file on the next keystroke.
      if (record) apply(record)
    } else if (action.type === 'remove-file') {
      await parkFile(dir, action.name)
      counts.removed++
    } else if (action.type === 'remove-note') {
      // A false here is a note that could not be kept, and the pass stops
      // rather than count as done a removal it could not make safely.
      if (!(await moveToTrash(action.id))) throw new Error('A note could not be moved to the trash, so sync stopped.')
      counts.removed++
      trashed++
    }
  }
  if (trashed) {
    notice(`${trashed} ${trashed === 1 ? 'note' : 'notes'} went to the trash: the file was deleted from the folder.`, false)
  }

  // Real mtimes for the files just written: the next pass compares against
  // them, and a guess would be a few milliseconds off, which is enough to read
  // our own write back as somebody else's change.
  for (const [id, slot] of Object.entries(plan.manifest)) {
    if (slot.fileUpdated !== null) continue
    try {
      slot.fileUpdated = (await (await dir.getFileHandle(slot.name)).getFile()).lastModified
    } catch {
      delete plan.manifest[id]
    }
  }

  // The last await before the commit: the window the queueing above exists
  // for, and the only place a test can put a second event inside a pass.
  await gate()

  // A disconnect - or a connection to another folder - landing while this pass
  // was awaiting means this plan describes a folder that is no longer the one
  // connected. Committing it would put one folder's manifest over another's,
  // and the next pass would then delete by names that were never in this one.
  if (handle !== dir) return null

  manifest = plan.manifest
  await persist()
  return counts
}

/* --------------------------------------------------------------- running */

/**
 * One pass at a time, in every tab.
 *
 * The chain below queues one tab against itself, but the manifest is a
 * single record every tab of this origin shares, so two tabs passing at
 * once would interleave writes and commit their plans over each other -
 * the same hole the chain closes, reopened one window along. The Web
 * Locks API closes it here: a pass holds one exclusive lock for its
 * whole run, and the next pass - in this tab or any other - waits its
 * turn. Where the API is missing, the chain alone still holds, exactly
 * as it always did.
 */
async function withSyncLock(work) {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(SYNC_LOCK, work)
  }
  return work()
}

function run() {
  if (!handle) return Promise.resolve(null)
  // Counted from the moment this pass starts - queued behind a lock or a
  // held pass counts too - so the menu can say a pass is on the move rather
  // than only that one has finished.
  inFlight++
  return withSyncLock(() =>
    reconcile()
      .then((counts) => {
        // A problem sticks until a pass succeeds again: the bubble that
        // announced it is gone after a few seconds, and the row keeps the
        // answer until there is a better one. A null here is a pass that did
        // nothing - a disconnect landed mid-flight - and is no verdict.
        if (counts) {
          lastPass = counts
          lastProblem = null
        }
        return counts
      })
      .catch((error) => {
        lastProblem = error?.message ?? String(error)
        notice(lastProblem, true)
        return null
      })
      .finally(() => {
        inFlight--
      }),
  )
}

/**
 * Reconcile now. Passes are queued, never interleaved: two saves a second
 * apart still produce one file write each and one manifest between them.
 *
 * @returns {Promise<{written: number, imported: number, removed: number}|null>}
 */
export function syncNow() {
  if (!active || !handle) return Promise.resolve(null)
  // This pass replaces the pause scheduleSync set: it sees the same state the
  // timer would have, and a timer left running would queue a second pass over
  // what the first one just wrote. Asking for a sync and then knowing the
  // chain holds only that sync is the same guarantee for a reader with a sync
  // button as it is for anyone else who needs the chain to come out empty.
  clearTimeout(timer)
  timer = null
  chain = chain.then(run, run)
  return chain
}

/**
 * Answer the brake.
 *
 * 'restore' forgets the pairs the pass would have removed, so the same plan
 * now writes the notes' files again and adopts the files as notes. 'remove' lets
 * one pass through, for no more than was asked about: anything bigger stops
 * again.
 *
 * @param {'restore'|'remove'} choice
 * @returns {Promise<object|null>} the pass's counts
 */
export function resolveRemovals(choice) {
  if (!paused) return Promise.resolve(null)
  const answer = () =>
    withSyncLock(async () => {
      if (!paused) return
      if (choice === 'remove') {
        approved = paused.notes + paused.files
        return
      }
      for (const id of [...paused.ids, ...paused.fileIds]) delete manifest[id]
      for (const [id, slot] of Object.entries(manifest)) {
        if (paused.names.includes(slot.name)) delete manifest[id]
      }
      paused = null
      lastProblem = null
      await persist()
    })
  chain = chain.then(answer, answer)
  return chain.then(() => syncNow())
}

/** Reconcile after a pause, cancelled and replaced by the next sync. */
export function scheduleSync(delay = SYNC_DEBOUNCE) {
  if (!active) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    syncNow()
  }, delay)
}

/**
 * A note was deleted in the app: delete its file, the other half of the
 * mirror. Anything the manifest did not know about is left for the next
 * reconcile, which removes an orphan by id.
 *
 * @param {string} id
 */
export function noteDeleted(id) {
  if (!handle) return Promise.resolve()
  // Under the lock as well as the chain: in this tab the chain decides the
  // order, and the lock is what gives that order the same meaning in every
  // other tab of this origin.
  const remove = () =>
    withSyncLock(async () => {
      const slot = manifest[id]
      delete manifest[id]
      if (slot && active) await removeFile(handle, slot.name)
      await persist()
      if (active) scheduleSync(50)
    })
  // Queued like every other pass. Running it beside a reconcile already in
  // flight would let that pass commit its plan - built before this deletion -
  // over the manifest change, putting the deleted note's slot back; a later
  // file sharing that name would then count as tracked, and tracked names are
  // the only ones a mirror ever removes.
  chain = chain.then(remove, remove)
  return chain
}

/* ------------------------------------------------------------ connecting */

async function ensurePermission() {
  if (!handle) return false
  // No permission API: a test double, or a directory handed over directly.
  if (typeof handle.queryPermission !== 'function') return true
  try {
    let status = await handle.queryPermission(PERMISSION)
    if (status === 'prompt' && typeof handle.requestPermission === 'function') {
      status = await handle.requestPermission(PERMISSION)
    }
    return status === 'granted'
  } catch {
    return false
  }
}

/**
 * Pick a folder and start syncing to it.
 *
 * @returns {Promise<{cancelled?: true, name?: string, counts?: object}>}
 */
export async function connectFolder() {
  let directory
  try {
    directory = await window.showDirectoryPicker({id: 'textarea-notes', mode: 'readwrite'})
  } catch (error) {
    // Closing the picker is a decision, not a failure.
    if (error?.name === 'AbortError') return {cancelled: true}
    throw new Error('The folder could not be opened: ' + (error?.message ?? error), {cause: error})
  }
  return connectToDirectory(directory)
}

/**
 * Connect to a directory handle the caller already holds.
 *
 * A fresh manifest every time: reconnecting never deletes, whatever state the
 * folder was left in. Exported for the console and the tests, which reach the
 * same code path through an OPFS directory rather than the native picker.
 *
 * @param {FileSystemDirectoryHandle} directory
 * @returns {Promise<{name: string, counts: object|null}>}
 */
export async function connectToDirectory(directory) {
  handle = directory
  manifest = {}
  oversizedWarned.clear()
  paused = null
  approved = null
  // A fresh folder starts with no verdict: the row earns "Up to date" from
  // this connection's own first pass, not from whatever the last one found.
  lastPass = null
  lastProblem = null
  active = true
  const counts = await syncNow()
  await persist()
  return {name: directory.name, counts}
}

/** Stop syncing. The folder keeps every file it already has. */
export async function disconnectFolder() {
  active = false
  clearTimeout(timer)
  timer = null
  handle = null
  manifest = {}
  oversizedWarned.clear()
  paused = null
  approved = null
  // Nothing mirrors any more, so nothing claims to be up to date.
  lastPass = null
  lastProblem = null
  await clearRecord()
}

/**
 * Reconnect a folder saved in an earlier session.
 *
 * The handle is asked for its permission here, which is where Chrome shows the
 * one-click "allow" bubble; if it needs a gesture the handle is kept anyway so
 * the menu row reconnects without a new pick.
 *
 * @returns {Promise<string|null>} the folder's name when sync is running
 */
export async function restoreFolder() {
  const record = await loadRecord()
  if (!record?.handle) return null

  handle = record.handle
  manifest = record.manifest ?? {}
  active = false
  if (!(await ensurePermission())) {
    // Remembered but not allowed. Without a word the row alone would read as
    // sync simply being off; the reader is owed the folder's name and the
    // one click on that row that asks for it back.
    notice(`Folder sync needs permission for "${handle.name}" again`, false)
    return null
  }

  active = true
  scheduleSync(1200)
  return handle?.name ?? null
}

/**
 * Ask the handle already in hand for its permission again.
 *
 * What the menu does when a folder is remembered but not currently allowed,
 * so reconnecting is the browser's bubble rather than the file picker.
 *
 * @returns {Promise<string|null>}
 */
export async function reconnectFolder() {
  if (!handle || active) return null
  if (!(await ensurePermission())) return null
  active = true
  scheduleSync(300)
  return handle.name ?? null
}

/* -------------------------------------------------------------- the small */

// Sync happens while the app is open, so the two moments a reader comes back
// to it are the two moments an edit made elsewhere is worth picking up.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('focus', () => scheduleSync(300))
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleSync(300)
  })
}

/** Whether this browser will give us a database at all. */
function idbAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

/**
 * The one record, when storage is available.
 *
 * Structured clone is what stores the directory handle, so this is IndexedDB
 * and not localStorage; every failure degrades to a session that forgets the
 * folder on reload rather than to a broken sync.
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath: 'id'})
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function persist() {
  if (!idbAvailable() || !handle) return
  let db
  try {
    db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({id: RECORD_ID, handle, manifest})
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    // Session-only from here: the sync still works until the tab closes.
  } finally {
    db?.close()
  }
}

async function loadRecord() {
  if (!idbAvailable()) return null
  let db
  try {
    db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(RECORD_ID)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return null
  } finally {
    db?.close()
  }
}

async function clearRecord() {
  if (!idbAvailable()) return
  let db
  try {
    db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(RECORD_ID)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    // Nothing worth reporting: the record is gone when the folder is gone.
  } finally {
    db?.close()
  }
}
