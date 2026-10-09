// A title made safe to be a filename. On its own so the modules that name
// things at boot (the note's title, the folder mirror) do not pull in the
// export formats with it.

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i
// Control characters are exactly what this removes: they are invisible in a
// filename and no filesystem we support will write one back.
// eslint-disable-next-line no-control-regex
const ILLEGAL_FILENAME = /[\x00-\x1f"*:<>?|\\/]/g
const TRAILING_DOTS_AND_SPACES = /[. ]+$/

/**
 * Turn a document title into something safe to use as a filename on macOS,
 * Windows and Linux. Leading dots are dropped so the file cannot end up hidden,
 * and a name can never be empty or just an extension.
 */
export function sanitizeFilename(name, fallback = 'note') {
  let result = String(name ?? '')
    .replace(/\n+/g, ' ')
    .replace(ILLEGAL_FILENAME, '_')
    .replace(TRAILING_DOTS_AND_SPACES, '')
    .replace(/^\.+/, '')
    .trim()

  if (result === '' || result === '.' || result === '..') result = fallback
  if (WINDOWS_RESERVED.test(result)) result = '_' + result

  // Keep well clear of the 255-byte limit most filesystems impose, while leaving
  // room for the extension and any suffix we append.
  const bytes = new TextEncoder().encode(result)
  if (bytes.length <= 180) return result

  let cut = 180
  while (cut > 0 && (new TextEncoder().encode(result.slice(0, cut)).length > 180)) cut--
  return result.slice(0, cut).trim() || fallback
}
