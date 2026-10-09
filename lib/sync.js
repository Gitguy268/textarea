// Folder sync as the rest of the app sees it: the same calls, with the
// engine behind them (lib/folder-sync.js, 30 kB) fetched only once there is
// a folder to sync - one remembered from an earlier session, or one the
// reader is connecting now. A browser that cannot do folder sync, and a
// reader who never asked for it, never download the engine at all.

/** The engine module, once something has needed it. */
let engine = null
let loading = null

// Callbacks registered before the engine exists are handed over when it does.
let notice = () => {}
let apply = () => {}

function load() {
  loading ??= import('./folder-sync.js').then((module) => {
    module.setFolderSyncNotice(notice)
    module.setFolderSyncApply(apply)
    engine = module
    return module
  })
  return loading
}

/**
 * Whether an earlier session left a folder behind, asked without the engine
 * and without creating the database for a reader who never had one: opened
 * with no version, a database that does not exist reports an upgrade from
 * nothing, and aborting that upgrade leaves nothing behind.
 */
function remembered() {
  return new Promise((resolve) => {
    let request
    try {
      request = indexedDB.open('textarea-sync')
    } catch {
      resolve(false)
      return
    }
    request.onupgradeneeded = () => request.transaction.abort()
    request.onerror = (event) => {
      event.preventDefault()
      resolve(false)
    }
    request.onsuccess = () => {
      const db = request.result
      const done = (answer) => {
        db.close()
        resolve(answer)
      }
      try {
        const get = db.transaction('state').objectStore('state').get('folder')
        get.onsuccess = () => done(Boolean(get.result?.handle))
        get.onerror = () => done(false)
      } catch {
        done(false)
      }
    }
  })
}

/** A function check: the property exists in insecure contexts too, where calling it throws. */
export function folderSyncAvailable() {
  return typeof window.showDirectoryPicker === 'function'
}

/** The engine's own status, or the status of a sync that has never been on. */
export function folderSyncStatus() {
  if (engine) return engine.folderSyncStatus()
  return {
    supported: folderSyncAvailable(),
    active: false,
    name: '',
    syncing: false,
    pending: false,
    lastPass: null,
    problem: null,
  }
}

export function setFolderSyncNotice(callback) {
  notice = callback
  engine?.setFolderSyncNotice(callback)
}

export function setFolderSyncApply(callback) {
  apply = callback
  engine?.setFolderSyncApply(callback)
}

// With no engine there is no folder, so these four have nothing to do.
export const scheduleSync = () => engine?.scheduleSync()
export const noteDeleted = (id) => engine?.noteDeleted(id) ?? Promise.resolve()
export const syncNow = async () => engine?.syncNow()
export const reconnectFolder = async () => engine?.reconnectFolder() ?? null
export const disconnectFolder = async () => engine?.disconnectFolder()

// These two are the reader asking for a folder, which is what the engine is for.
export const connectFolder = async () => (await load()).connectFolder()
export const connectToDirectory = async (directory) => (await load()).connectToDirectory(directory)

/** At boot: bring back a remembered folder, if there is one to bring back. */
export async function restoreFolder() {
  if (!(await remembered())) return null
  return (await load()).restoreFolder()
}
