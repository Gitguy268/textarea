// Opening a file from disk into the editor.
//
// Three kinds of input are handled, picked by magic bytes first and by extension
// second so that a mislabelled file still opens:
//
//   plain text  -> decoded, with a fallback for legacy encodings
//   PDF         -> text extraction through pdf.js
//   ZIP         -> every text entry, prompting once if the archive is encrypted

import {extractPdf, PdfEmptyError, PdfPasswordError} from './pdf.js'
import {promptPassword} from './dialog.js'
import {readZip} from './zip.js'

const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'asciidoc', 'csv', 'tsv',
  'json', 'json5', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'xml', 'html', 'htm', 'xhtml', 'svg', 'css', 'scss', 'less',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c',
  'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'sql', 'graphql',
  'log', 'env', 'gitignore', 'editorconfig', 'diff', 'patch', 'srt', 'vtt', 'tsv',
])

const ZIP_EXTENSIONS = new Set(['zip'])

/**
 * The largest file that will be read into the editor at all.
 *
 * Everything here works in memory, so an oversized pick is a tab-killer rather
 * than a slow load. Two hundred megabytes is far beyond any note, a log file
 * or an extracted archive, and a real file that size has to be split first.
 */
export const MAX_FILE_BYTES = 200 * 1024 * 1024

/** The lowercase extension of a filename, without the dot. */
export function extensionOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(name ?? '')
  return match ? match[1].toLowerCase() : ''
}

function looksLikeZip(bytes) {
  // "PK\x03\x04" for a normal archive, "PK\x05\x06" for an empty one,
  // "PK\x07\x08" for a spanned one.
  return bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2])
}

function looksLikePdf(bytes) {
  // The header is allowed a little binary junk before %PDF- by lenient readers,
  // but every real file starts with it.
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

/**
 * Decode text, honouring a byte order mark and falling back to Windows-1252 when
 * the bytes are not valid UTF-8. Without this a note saved by an older Windows
 * tool comes out as a wall of replacement characters with no hint why.
 *
 * @returns {{text: string, encoding: string, fallback: boolean, lossy: boolean}}
 *   `fallback` means the bytes were not valid UTF-8; `lossy` means even the
 *   fallback could not represent them.
 */
export function decodeText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: new TextDecoder('utf-8').decode(bytes.subarray(3)),
      encoding: 'UTF-8 with BOM',
      fallback: false,
      lossy: false,
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'UTF-16LE',
      fallback: false,
      lossy: false,
    }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: 'UTF-16BE',
      fallback: false,
      lossy: false,
    }
  }

  const strict = new TextDecoder('utf-8', {fatal: true})
  try {
    return {text: strict.decode(bytes), encoding: 'UTF-8', fallback: false, lossy: false}
  } catch {
    const text = new TextDecoder('windows-1252').decode(bytes)
    // windows-1252 maps every byte, so U+FFFD can only come from the file itself.
    return {text, encoding: 'Windows-1252', fallback: true, lossy: text.includes('�')}
  }
}

/**
 * @typedef {object} OpenResult
 * @property {string} text         what to put in the editor
 * @property {string} [title]      a title suggested by the file
 * @property {string} [warning]
 * @property {string} [source]     a short description of where the text came from
 */

/**
 * Read a File and produce the text to insert.
 *
 * @param {File} file
 * @param {object} [options]
 * @param {(message: string) => void} [options.onprogress]
 * @param {boolean} [options.twoColumns]
 * @returns {Promise<OpenResult>}
 */
export async function readFile(file, options = {}) {
  const {onprogress, twoColumns = true} = options

  // Checked before arrayBuffer(): the point of the limit is that the bytes are
  // never read in the first place.
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `${file.name} is larger than the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB this editor reads, so it was not opened.`,
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const extension = extensionOf(file.name)

  if (looksLikePdf(bytes) || extension === 'pdf') {
    return openPdf(bytes, file, {...options, twoColumns})
  }

  if (looksLikeZip(bytes) || ZIP_EXTENSIONS.has(extension)) {
    return openZip(new Blob([bytes]), file, options)
  }

  return openText(bytes, file, extension, onprogress)
}

async function openText(bytes, file, extension, onprogress) {
  onprogress?.('Reading ' + file.name)
  const {text, encoding, fallback, lossy} = decodeText(bytes)

  const warnings = []
  if (fallback) {
    warnings.push(
      lossy
        ? `${file.name} is not UTF-8. It was read as ${encoding}, and some of its bytes have no ` +
            'character there at all, so parts of it are wrong.'
        : `${file.name} is not UTF-8. It was read as ${encoding}, which is what Windows tools ` +
            'usually write.',
    )
  }
  if (bytes.length === 0) {
    warnings.push(`${file.name} is empty.`)
  } else if (!fallback && !TEXT_EXTENSIONS.has(extension) && !file.type.startsWith('text/')) {
    // An unknown extension, not typed as text, yet it decoded: if the result is
    // full of control characters it was probably not meant to be read as text.
    // Say so rather than silently filling the editor with noise. Matching those
    // characters is the whole point of the pattern.
    // eslint-disable-next-line no-control-regex
    const control = (text.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g) ?? []).length
    if (control > text.length * 0.01) {
      warnings.push(`"${file.name}" does not look like a text file, but it was read as ${encoding}.`)
    }
  }

  return {
    text,
    title: file.name.replace(/\.[^.]*$/, ''),
    encoding,
    warning: warnings.length ? warnings.join('\n\n') : undefined,
    source: file.name,
  }
}

async function openPdf(bytes, file, {onprogress, twoColumns, password}) {
  onprogress?.('Loading the PDF reader')
  try {
    const result = await extractPdf(bytes, {
      password,
      twoColumns,
      onprogress: (page, total) => onprogress?.(`Extracting page ${page} of ${total}`),
    })
    const twoColumnPages = result.columns.filter((count) => count === 2).length
    return {
      text: result.text,
      title: file.name.replace(/\.pdf$/i, ''),
      source: file.name,
      warning: twoColumnPages
        ? `${twoColumnPages} of ${result.pages} pages were read as two columns.`
        : undefined,
      pages: result.pages,
    }
  } catch (error) {
    if (error instanceof PdfPasswordError) throw error
    if (error instanceof PdfEmptyError) throw error
    if (error?.name === 'PasswordException') throw new PdfPasswordError()
    throw new Error(`Could not read ${file.name}: ${error?.message ?? error}`, {cause: error})
  }
}

async function openZip(blob, file, {onprogress, password}) {
  onprogress?.('Reading the archive')

  // One prompt for the whole archive rather than one per entry, so the password
  // the user just typed has to be remembered for the entries after the first.
  let entered = password ?? null
  const files = await readZip(blob, {
    password: entered ?? undefined,
    onpassword: async () => {
      if (entered !== null) return entered
      entered =
        (await promptPassword({
          title: 'Encrypted archive',
          message: `${file.name} is password protected.`,
          submitLabel: 'Open',
        })) ?? ''
      return entered
    },
  })

  const readable = files.filter((entry) => typeof entry.text === 'string')
  const failed = files.filter((entry) => entry.error)

  if (readable.length === 0) {
    throw new Error(
      failed.length
        ? `Could not read ${file.name}: ${failed[0].error}`
        : `${file.name} contains no files.`,
    )
  }

  const text = readable
    .map((entry) => (readable.length > 1 ? `# ${entry.name}\n\n${entry.text}` : entry.text))
    .join('\n\n')

  const warnings = []
  if (failed.length) {
    warnings.push(
      `Skipped ${failed.length} of ${files.length} entries: ${failed
        .slice(0, 3)
        .map((entry) => `${entry.name} (${entry.error})`)
        .join(', ')}${failed.length > 3 ? ', …' : ''}`,
    )
  }

  return {
    text,
    title: file.name.replace(/\.zip$/i, ''),
    source: file.name,
    warning: warnings.length ? warnings.join('\n\n') : undefined,
  }
}

/**
 * Open a PDF, asking for the password once and retrying.
 *
 * A PDF password and a ZIP password are unrelated, so a failed attempt does not
 * cache either way: the user gets a second prompt rather than a dead end.
 */
export async function readPdfWithPassword(file, options = {}) {
  try {
    return await readFile(file, options)
  } catch (error) {
    // Anything that is not a locked PDF stops here. The prompt lives outside
    // the catch so that cancelling is a decision of its own rather than a new
    // error thrown while handling this one.
    if (!(error instanceof PdfPasswordError)) throw error
  }

  const password = await promptPassword({
    title: 'Password protected PDF',
    message: `${file.name} cannot be opened without its password.`,
    submitLabel: 'Open',
  })
  if (password === null) throw new Error('Cancelled')
  return readFile(file, {...options, password})
}
