// Saving a file.
//
// Where the File System Access API exists the user picks the location, which
// means no copy lands in their downloads folder. Everywhere else this falls back
// to an object URL and a synthetic click.

import {getFormat} from './formats.js'

/**
 * @param {Blob|string} data
 * @param {object} options
 * @param {string} options.suggestedName
 * @param {string} [options.mime]
 * @param {string} [options.description]
 * @param {Record<string, string[]>} [options.accept]
 * @returns {Promise<boolean>} false when the user cancelled
 */
export async function saveBlob(data, options) {
  const {suggestedName, mime, description, accept} = options
  const blob = typeof data === 'string' ? new Blob([data], {type: mime ?? 'text/plain'}) : data

  // A function check rather than `in window`: the property exists in insecure
  // contexts too, where calling it throws a SecurityError.
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: description && accept ? [{description, accept}] : undefined,
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    } catch (error) {
      // AbortError is the user closing the picker, which is not a failure.
      if (error?.name === 'AbortError') return false
      // Anything else (a cross-origin restriction, a revoked permission) falls
      // through to the download below rather than failing outright.
    }
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = suggestedName
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}

/** Save one converted note. */
export function saveAsFormat(text, formatId, filename) {
  const format = getFormat(formatId)
  return saveBlob(text, {
    suggestedName: filename + '.' + format.ext,
    mime: format.mime,
    description: format.label + ' file',
    accept: {[format.mime]: ['.' + format.ext]},
  })
}
