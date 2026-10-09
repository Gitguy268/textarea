// Links from a note to a file on this computer.
//
// The note is plain text, so the link is plain text too: `[name](file:id)`,
// where the id points at a file handle the reader chose through the picker
// once. The handle lives in its own database for the same reason folder sync
// keeps one: a picker-issued handle is a capability this origin holds, and
// the browser decides per session whether it may be used. A click on the
// link therefore re-asks for permission at the moment of the click - when a
// decision can still be asked for - instead of pretending to remember one.
//
// A note from another machine shows the same `[name](file:id)` text and
// cannot open it, because the handle was never written here. That is the
// honest failure: the text still round-trips, and the reader can see what it
// was pointing at.

const DB_NAME = 'textarea-links'
const DB_VERSION = 1
const STORE = 'files'
const PERMISSION = {mode: 'read'}

/** Whether this browser can ask for a file and remember the handle. */
export function fileLinksAvailable() {
  try {
    return (
      typeof indexedDB !== 'undefined' &&
      indexedDB !== null &&
      typeof window !== 'undefined' &&
      typeof window.showOpenFilePicker === 'function'
    )
  } catch {
    // Same as the library: on an insecure origin the constructor exists and
    // opening it throws, which is "no" for our purposes.
    return false
  }
}

/** A promise for the database, opened per operation and closed with it. */
function database() {
  if (!fileLinksAvailable()) {
    return Promise.reject(new Error('This browser cannot link local files.'))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        // Auto-increment: the note only ever carries the id, so the id has to
        // be the database's to hand out.
        db.createObjectStore(STORE, {keyPath: 'id', autoIncrement: true})
      }
    }

    request.onsuccess = () => resolve(request.result)

    request.onerror = () => {
      reject(request.error ?? new Error('The file links database could not be opened.'))
    }
  })
}

/** Every IndexedDB request as a promise. */
function fromRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Whether this handle may be read, asking once when the browser has not
 * decided yet.
 *
 * Exported because this decision is the whole permission gate: the browser
 * tests can provoke a refusal through a stand-in, but the branch that asks
 * and the branch that gives up without asking are only honest as unit tests
 * over the handle itself.
 *
 * @param {{queryPermission?: Function, requestPermission?: Function}} handle
 * @returns {Promise<boolean>}
 */
export async function ensurePermission(handle) {
  if (!handle) return false
  // No permission API: a test double, or a handle handed over directly.
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
 * Ask for one file and remember it for a note to link.
 *
 * The picker is the only door into this store: there is no code path that
 * takes a path from a note and resolves it against the disk. Cancel is not
 * an error - the reader changed their mind - so the AbortError the picker
 * raises is rethrown with its name for the caller to recognise.
 *
 * @returns {Promise<{id: number, name: string}>}
 */
export async function pickFile() {
  if (!fileLinksAvailable()) throw new Error('This browser cannot link local files.')

  let handles
  try {
    handles = await window.showOpenFilePicker({multiple: false})
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new Error(error?.message ?? 'The file could not be picked.', {cause: error})
  }

  const [handle] = handles
  if (!handle) throw new Error('No file was picked.')

  const db = await database()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const id = await fromRequest(tx.objectStore(STORE).add({name: handle.name, handle}))
    return {id, name: handle.name}
  } finally {
    db.close()
  }
}

/**
 * Read the file a note links to, re-asking for permission on the way.
 *
 * @param {number} id the id the note carries
 * @returns {Promise<File>}
 */
export async function openLinkedFile(id) {
  // The note carries the id as text, but the store was keyed by the number
  // the database handed out - and in IndexedDB a string key is a different
  // key than the number it looks like, so the read would silently miss.
  const key = Number(id)

  const db = await database()
  let row
  try {
    row = await fromRequest(db.transaction(STORE, 'readonly').objectStore(STORE).get(key))
  } finally {
    db.close()
  }

  if (!row) throw new Error('That link points at a file this browser has no record of.')
  if (!(await ensurePermission(row.handle))) {
    throw new Error(`Permission to read "${row.name}" was not granted.`)
  }
  return row.handle.getFile()
}
