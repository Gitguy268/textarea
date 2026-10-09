// The file a note becomes: the note text with a small front matter block.
//
// Folder sync writes one file per note and reads the folder back, and the
// block is what makes that a two-way mirror instead of a pile of text files:
// it carries the note's id (so a file renamed in the Finder is still the same
// note), the timestamps the newest-wins rule compares, and the style half,
// which markdown has no syntax for.
//
// The subset is deliberately tiny - `key: value` lines and nothing else.
// These files are meant to be opened in any editor and hand-edited, so the
// parser takes what it finds (unknown keys are ignored, a malformed line is
// skipped, no block at all is just text) and the writer quotes anything that
// could be misread as YAML structure. That is really only the style string:
// `color: red` would otherwise be two tokens.
//
// Round trip is exact - parseNote(renderNote(x)).text is x.text - so a note
// nobody touched outside the app never looks changed to the sync.

import {sanitizeFilename} from './formats.js'

/**
 * The first level one heading names the note, or 'Textarea' when there is
 * none.
 *
 * The rule for the tab, the library row and now the folder lives here so all
 * three agree: a note imported from the folder is named exactly as the app
 * would name it if the text had been pasted into the editor instead.
 *
 * @param {string} text
 * @returns {string}
 */
export function titleOf(text) {
  const match = String(text ?? '').match(/^(?:[ \t]*\n)*[ \t]*#[ \t]+([^\n]+)/)
  return match ? match[1].trim() : 'Textarea'
}

/**
 * Read the front matter block and the note text out of a file's source.
 *
 * @param {string} source
 * @returns {{data: Record<string, string|number|boolean>|null, text: string}}
 *   data is null when the file opens with something other than a block; an
 *   empty block is an empty object, which still counts as "has a block".
 */
export function parseNote(source) {
  // CRLF and a BOM are what editors on other systems leave behind. Normalising
  // them keeps a Windows-edited note from looking changed on every sync.
  const normalized = String(source ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')

  if (lines[0] !== '---') return {data: null, text: normalized}

  // The first `---` after the opening fence closes the block. Keys can never
  // be `---` themselves, so this cannot stop inside the block.
  const end = lines.indexOf('---', 1)
  if (end === -1) return {data: null, text: normalized}

  const data = {}
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]?(.*)$/.exec(line)
    if (!match) continue
    data[match[1]] = scalar(match[2])
  }
  return {data, text: lines.slice(end + 1).join('\n')}
}

/** One front matter value: quoted strings unquoted, digits as numbers. */
function scalar(raw) {
  const value = raw.trim()
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      // A hand-edit with an unescaped quote. Keep the text rather than fail.
      return value
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1)
  }
  if (/^-?\d+$/.test(value)) return Number(value)
  if (value === 'true' || value === 'false') return value === 'true'
  return value
}

/** A value written back out: plain when it is safe as YAML, quoted if not. */
function plain(value) {
  const text = String(value)
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : JSON.stringify(text)
}

/**
 * Write a note as a file: front matter block, then the text verbatim.
 *
 * @param {object} note
 * @param {string} note.id
 * @param {number} note.created
 * @param {number} note.updated
 * @param {number} [note.words]
 * @param {string|null} [note.style]
 * @param {string} note.text
 * @returns {string}
 */
export function renderNote({id, created, updated, words, style, text}) {
  const lines = [
    '---',
    `id: ${plain(id ?? '')}`,
    `created: ${Number(created) || 0}`,
    `updated: ${Number(updated) || 0}`,
  ]
  if (words !== undefined && words !== null) lines.push(`words: ${Number(words) || 0}`)
  if (style) lines.push(`style: ${JSON.stringify(String(style))}`)
  lines.push('---')
  // The text follows the block verbatim: no extra trailing newline, or the
  // round trip would grow the note by a line on every pass.
  return lines.join('\n') + '\n' + String(text ?? '')
}

/**
 * The moment a file was last changed, for comparing against a library entry.
 *
 * Whichever is later of the `updated` the file claims and the mtime the
 * filesystem reports. Both count: an editor that saves without touching the
 * block moves the mtime, and a reader who bumps `updated` by hand moves the
 * claim, and either one is a change worth winning with.
 *
 * @param {Record<string, string|number>|null} data  parsed front matter
 * @param {number} lastModified  the file's mtime in epoch milliseconds
 * @returns {number}
 */
export function fileTimestamp(data, lastModified) {
  const claimed = Number(data?.updated) || 0
  return Math.max(claimed, Number(lastModified) || 0)
}

/**
 * A unique `Title.md` for a note inside a set of names already in the folder.
 *
 * @param {string} title
 * @param {Set<string>} taken  every existing name, lowercased: macOS folders
 *   are case-insensitive by default, so `Note.md` and `note.md` are one file.
 * @param {string|null} [own]  the note's current filename, which keeps its
 *   own slot: a note called `Note.md` is not a duplicate of itself.
 * @returns {string}
 */
export function filenameFor(title, taken, own = null) {
  let base = sanitizeFilename(String(title ?? '').replace(/\.md$/i, ''), 'note')
  const exempt = String(own ?? '').toLowerCase()

  const isTaken = (name) => name.toLowerCase() !== exempt && taken.has(name.toLowerCase())

  let name = `${base}.md`
  for (let count = 2; isTaken(name); count++) name = `${base} (${count}).md`
  return name
}
