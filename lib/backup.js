// Backing up the library: one ZIP, one front-mattered file per note.
//
// The archive is the folder-sync file format, byte for byte: the same front
// matter block, the same `Title.md` names, duplicates earning `(2)` the way
// they would on disk. That is what makes this a backup rather than a second
// export format - unzip it anywhere, point Folder sync at the folder, and
// every note comes back as itself, id, timestamps and style intact. The files
// stay plain markdown underneath, so the same archive opens in any editor and
// reads like the notes it holds.
//
// Two switches shape it, both in Settings. Metadata can be dropped for an
// archive meant to leave the app entirely - the words survive, the machine
// readable header does not - and the archive can be sealed with a password,
// AES-256 in WinZip AES AE-2 format, the same one Export writes, for the copy
// that will sit in a Downloads folder.
//
// The flow ends where Export's archive does: a blob and a save. There is no
// progress bar and no partial write, because a backup that could stop halfway
// would be worse than no backup at all.

import {askArchivePassword} from './export.js'
import {filenameFor, renderNote} from './front-matter.js'
import {isAvailable, listDocuments} from './library.js'
import {saveBlob} from './save.js'
import {writeZip} from './zip.js'

/**
 * The archive's entries: one front-mattered `.md` file per note.
 *
 * Names follow folder-sync's own rule - a title lowered into a collision set,
 * a duplicate earning ` (2)` - so an archive unpacked beside an existing
 * mirror does not reinvent a note it already holds. The date is the moment the
 * note was last written; zip.js clamps anything outside its own 1980-2107
 * bounds, so a hand-edited timestamp cannot fail the whole write.
 *
 * @param {Array<{title?: string, text?: string, updated?: number, created?: number, words?: number, style?: string|null}>} documents
 * @param {object} [options]
 * @param {boolean} [options.metadata]  false drops the front matter block
 * @returns {Array<{name: string, text: string, date: Date}>}
 */
export function backupEntries(documents, {metadata = true} = {}) {
  const taken = new Set()
  return documents.map((entry) => {
    const name = filenameFor(entry.title, taken)
    taken.add(name.toLowerCase())
    return {
      name,
      text: metadata ? renderNote(entry) : String(entry.text ?? ''),
      date: new Date(Number(entry.updated) || Date.now()),
    }
  })
}

/**
 * The archive's own filename: one per calendar day, so a second backup the
 * same day arrives as `... (1).zip` from the browser rather than replacing the
 * first. The date is UTC, so the name does not change under the reader's feet
 * at a timezone border.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function backupFilename(now = new Date()) {
  return `textarea-backup-${now.toISOString().slice(0, 10)}.zip`
}

/**
 * The whole flow: what is in the library, the password if one was asked for,
 * the write, the save. Every outcome is reported through `notify` except the
 * two cancellations - a password or a save the reader backed out of - which
 * are left alone on purpose.
 *
 * @param {object} [options]
 * @param {boolean} [options.metadata]  include the front matter block
 * @param {boolean} [options.encrypt]  ask for a password before writing
 * @param {(message: string, isError?: boolean) => void} [options.notify]
 * @returns {Promise<{entries: number, encrypted: boolean} | null>} null on cancellation
 */
export async function backupInteractive({metadata = true, encrypt = false, notify = () => {}} = {}) {
  if (!isAvailable()) {
    notify('Nothing to back up - this browser is not storing notes', true)
    return null
  }

  const documents = await listDocuments()
  if (!documents.length) {
    notify('Nothing to back up - the library is empty')
    return null
  }

  let password = null
  if (encrypt) {
    password = await askArchivePassword()
    if (password === null) return null
  }

  const entries = backupEntries(documents, {metadata})
  const blob = await writeZip(entries, {password: password ?? undefined})
  const saved = await saveBlob(blob, {
    suggestedName: backupFilename(),
    mime: 'application/zip',
    description: 'ZIP archive',
    accept: {'application/zip': ['.zip']},
  })
  if (!saved) return null

  const notes = entries.length === 1 ? 'note' : 'notes'
  notify(`Saved ${entries.length} ${notes} in ${password ? 'an AES-256 encrypted archive' : 'an archive'}`)
  return {entries: entries.length, encrypted: Boolean(password)}
}
