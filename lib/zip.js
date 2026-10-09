// Lazy access to zip.js.
//
// The vendored build is a UMD bundle that exposes the `zip` global, and it is
// ~172 KB. Pulling it in on every page load would be a poor trade for a feature
// most visitors never touch, so it is injected as a <script> the first time an
// archive is actually written or read, and cached by the service worker from
// then on.

let loading = null

/** How many files an archive may hold before it is refused outright. */
export const MAX_ENTRIES = 1000
/** How many bytes all the entries may expand to, together. */
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024

/**
 * An archive that expands past the limits above.
 *
 * The budget is about the whole archive, not one unlucky entry, so this stops
 * the read rather than skipping a file: the memory has already been the
 * problem by the time it is thrown.
 */
export class ZipTooLargeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ZipTooLargeError'
  }
}

function tooLargeBytes(limit) {
  return new ZipTooLargeError(
    `This archive expands to more than ${Math.round(limit / (1024 * 1024))} MB of text, so it was not opened.`,
  )
}

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => reject(new Error('Failed to load ' + src)))
    document.head.append(script)
  })
}

/** Resolve to the zip.js API, loading the vendor bundle at most once. */
export async function getZip() {
  if (globalThis.zip) return globalThis.zip
  loading ??= injectScript(new URL('../vendor/zip.js/zip.min.js', import.meta.url).href).then(
    () => {
      if (!globalThis.zip) throw new Error('zip.js loaded but did not register itself')
      return globalThis.zip
    },
  )
  try {
    return await loading
  } catch (error) {
    loading = null
    throw error
  }
}

/**
 * Write a ZIP.
 *
 * @param {Array<{name: string, text: string, date?: Date}>} entries
 * @param {object} [options]
 * @param {string} [options.password]  when set, entries are encrypted with
 *   WinZip AES in AE-2 format. `encryptionStrength: 3` selects AES-256, the
 *   strongest of the three WinZip AES key sizes. AE-2 stores a zeroed CRC-32 so
 *   the archive reveals nothing about the plaintext, and integrity comes from the
 *   trailing HMAC-SHA1 authentication code instead.
 * @param {(done: number, total: number) => void} [options.onprogress]
 * @returns {Promise<Blob>}
 */
export async function writeZip(entries, {password, onprogress} = {}) {
  const {BlobWriter, TextReader, ZipWriter, configure} = await getZip()

  // AES is implemented in JavaScript inside zip.js and the key derivation is
  // PBKDF2-HMAC-SHA1 with 1000 iterations, which is slow enough in a shared
  // worker pool to be noticeable; a single worker keeps it predictable.
  configure?.({useWebWorkers: true, maxWorkers: 1})

  const writer = new BlobWriter('application/zip')
  const zip = new ZipWriter(writer, password ? {password, encryptionStrength: 3} : {})

  try {
    for (const [index, entry] of entries.entries()) {
      await zip.add(entry.name, new TextReader(entry.text), {
        ...(entry.date ? {lastModDate: entry.date} : {}),
        onprogress: (computed) => onprogress?.(index, entries.length, computed),
      })
    }
    return await zip.close()
  } catch (error) {
    await zip.close().catch(() => {})
    throw error
  }
}

/**
 * Read the entries of a ZIP.
 *
 * @param {Blob} blob
 * @param {object} [options]
 * @param {string} [options.password]
 * @param {(message: string) => void} [options.onpassword]  called when the
 *   archive turns out to be encrypted and no password was supplied; should return
 *   the password (or a promise for one).
 * @param {number} [options.maxEntries]  overrides the file-count limit (tests)
 * @param {number} [options.maxBytes]  overrides the decompressed-byte limit (tests)
 * @returns {Promise<Array<{name: string, text: string, encrypted: boolean}>>}
 * @throws {ZipTooLargeError} when the archive exceeds either limit
 */
export async function readZip(blob, {password, onpassword, maxEntries = MAX_ENTRIES, maxBytes = MAX_TOTAL_BYTES} = {}) {
  const {BlobReader, TextWriter, ZipReader} = await getZip()

  const zip = new ZipReader(new BlobReader(blob))
  try {
    const entries = (await zip.getEntries()).filter((entry) => !entry.directory)
    if (entries.length > maxEntries) {
      throw new ZipTooLargeError(
        `This archive holds more than ${maxEntries} files, so it was not opened.`,
      )
    }

    const files = []
    // The declared size is the number the decompression budget hangs on, and
    // it is bounded in both directions: a header that claims too much is
    // rejected here, before a byte is read, and a header that claims too
    // little is rejected by zip.js itself the moment the stream overruns the
    // declared size ("Invalid uncompressed size"), so no archive can make the
    // reader hold more than it declared.
    let declared = 0

    for (const entry of entries) {
      declared += entry.uncompressedSize ?? 0
      if (declared > maxBytes) throw tooLargeBytes(maxBytes)

      // zip.js validates entry names against path traversal by default, which is
      // exactly what we want: we never write these names to disk.
      let secret = password
      if (entry.encrypted && !secret) secret = await onpassword?.(entry.filename)

      try {
        const text = await entry.getData(new TextWriter(), secret ? {password: secret} : {})
        files.push({name: entry.filename, text, encrypted: entry.encrypted === true})
      } catch (error) {
        if (error?.name === 'ERR_INVALID_PASSWORD' || /password/i.test(error?.message ?? '')) {
          files.push({name: entry.filename, encrypted: true, error: 'Wrong password'})
          continue
        }
        // A single unreadable entry (an unsupported compression method, say)
        // should not lose the rest of the archive.
        files.push({name: entry.filename, encrypted: entry.encrypted === true, error: error.message})
      }
    }

    return files
  } finally {
    await zip.close().catch(() => {})
  }
}

/**
 * Verify a password against an encrypted archive without extracting the
 * content, using the AE-2 authentication code.
 */
export async function checkPassword(blob, password) {
  const {BlobReader, TextWriter, ZipReader} = await getZip()
  const zip = new ZipReader(new BlobReader(blob))
  try {
    const entries = (await zip.getEntries()).filter((entry) => !entry.directory && entry.encrypted)
    if (entries.length === 0) return true
    await entries[0].getData(new TextWriter(), {password, checkPasswordOnly: true})
    return true
  } catch {
    return false
  } finally {
    await zip.close().catch(() => {})
  }
}
