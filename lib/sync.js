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
 * and without creating the database for a reader who never had one: the
 * browser is asked which databases exist before any is opened.
 */
async function remembered() {
  try {
    const known = await indexedDB.databases()
    if (!known.some((database) => database.name === 'textarea-sync')) return false
  } catch {
    return false
  }
  return new Promise((resolve) => {
    const request = indexedDB.open('textarea-sync')
    request.onerror = () => resolve(false)
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

/**
 * The boot's question - is a folder remembered, and if so bring it back -
 * while it is still being answered. Anything that acts on "the folder there
 * is" waits for it: asked a moment too early, a disconnect would find no
 * engine, do nothing, and then watch the boot connect the folder after all.
 */
let booting = Promise.resolve()

// Called on every save, so it never waits: before the engine exists there is
// no folder to mirror the save into.
export const scheduleSync = () => engine?.scheduleSync()

// With no engine once the boot has settled there is no folder, so these four
// have nothing to do.
const settled = async () => {
  await booting
  return engine
}
export const noteDeleted = async (id) => (await settled())?.noteDeleted(id)
export const syncNow = async () => (await settled())?.syncNow()
export const reconnectFolder = async () => (await settled())?.reconnectFolder() ?? null
export const disconnectFolder = async () => (await settled())?.disconnectFolder()

// These two are the reader asking for a folder, which is what the engine is for.
export const connectFolder = async () => {
  await booting
  return (await load()).connectFolder()
}
export const connectToDirectory = async (directory) => {
  await booting
  return (await load()).connectToDirectory(directory)
}

/** At boot: bring back a remembered folder, if there is one to bring back. */
export function restoreFolder() {
  const restored = (async () => {
    // A browser that cannot sync to a folder has none to remember, and is
    // not asked: Firefox and Safari never touch the engine or its database.
    if (!folderSyncAvailable() || !(await remembered())) return null
    return (await load()).restoreFolder()
  })()
  booting = restored.then(
    () => {},
    () => {},
  )
  return restored
}
