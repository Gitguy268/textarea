// Exporting the note: to a single file in a chosen format, or to an archive
// holding several formats at once, optionally encrypted with AES-256.

import {convert, FORMATS, getFormat, sanitizeFilename} from './formats.js'
import {saveAsFormat, saveBlob} from './save.js'
import {showDialog} from './dialog.js'
import {parseMarkdown} from './markdown.js'
import {writeZip} from './zip.js'

/**
 * Ask for the password that seals an archive: eight characters or more, asked
 * twice. Returns null when the reader walks away, which both this file's
 * archive flow and Backup read as "no archive" rather than as a failure - a
 * cancelled password is a decision, and shouting about it would be rude.
 *
 * @returns {Promise<string | null>}
 */
export async function askArchivePassword() {
  const credentials = await showDialog({
    title: 'Encrypt the archive',
    description: 'AES-256 in WinZip AES AE-2 format. The archive will open in 7-Zip, Keka, WinZip and Windows.',
    submitLabel: 'Encrypt',
    fields: [
      {
        name: 'password',
        type: 'password',
        label: 'Password',
        minLength: 8,
        confirm: true,
        description: 'Eight characters or more. There is no way to recover it if it is lost.',
      },
    ],
    validate: (values) => (values.password.length < 8 ? 'Use at least 8 characters.' : null),
  })
  return credentials ? credentials.password : null
}

/**
 * Collect everything an exporter needs from the live editor.
 *
 * @param {object} editor  the article element and its controller
 * @returns {{text: string, title: string, style: string|null, hash: string, exportedAt: string}}
 */
export function readNote(editor) {
  const {article} = editor
  return {
    text: article.textContent,
    title: document.title,
    style: article.getAttribute('style'),
    hash: location.hash,
    exportedAt: new Date().toISOString(),
  }
}

/**
 * The live page's CSS, so an exported HTML file needs no network access to look
 * right. Reading it out of the document rather than fetching the file is why the
 * stylesheet stays inline in index.html.
 */
function pageCss() {
  return [...document.querySelectorAll('style')].map((node) => node.textContent).join('\n')
}

/** Context for the HTML exporter, taken from the live DOM. */
function htmlContext(article) {
  // The wrapper carries the author's own inline style; its children are the
  // note re-rendered from its text by the same highlighter the editor uses,
  // rather than whatever markup the live DOM holds at the moment of export.
  const body = document.createElement('article')
  body.textContent = article.textContent
  parseMarkdown(body)
  if (article.getAttribute('style')) body.setAttribute('style', article.getAttribute('style'))
  return {bodyHtml: body.outerHTML, css: pageCss(), title: document.title}
}

/**
 * Convert and save in one step.
 *
 * @param {HTMLElement} article
 * @param {string} formatId
 * @returns {Promise<boolean>} false when the user cancelled
 */
export async function exportFormat(article, formatId) {
  const note = readNote({article})
  const filename = sanitizeFilename(note.title)
  return saveAsFormat(renderFormat(article, formatId), formatId, filename)
}

/**
 * The note converted to one format, as a string.
 *
 * Split out of exportFormat so that copying and exporting cannot drift apart:
 * both go through this, so what lands on the clipboard is byte for byte what
 * would have been written to the file.
 *
 * @param {HTMLElement} article
 * @param {string} formatId
 * @returns {string}
 */
export function renderFormat(article, formatId) {
  const format = getFormat(formatId)
  const context = format.needs === 'html' ? {html: htmlContext(article)} : {}
  return convert(readNote({article}), formatId, context).text
}

/** Ask which format to save in, then save it. */
export async function exportFormatInteractive(article) {
  const values = await showDialog({
    title: 'Save as',
    submitLabel: 'Save',
    fields: [
      {
        name: 'format',
        type: 'radio',
        label: 'Format',
        options: FORMATS.map((format) => ({value: format.id, label: format.label + '  (' + format.ext + ')'})),
      },
    ],
  })
  if (!values) return false
  return exportFormat(article, values.format)
}

/**
 * Which formats the dialog's checkboxes selected, in the registry's order so the
 * archive always lists them the same way round.
 *
 * @param {Record<string, boolean>} values
 * @returns {typeof FORMATS}
 */
function selectedFormatIds(values) {
  return FORMATS.filter((format) => values?.[format.id] === true)
}

/**
 * Ask for the archive contents, and for a password if the archive is to be
 * encrypted, then write it.
 *
 * @returns {Promise<{ok: boolean, encrypted: boolean, entries: number} | null>}
 *   null when the user cancelled
 */
export async function exportArchiveInteractive(article) {
  const choices = await showDialog({
    title: 'Save as ZIP',
    description: 'Pick the formats to put in the archive.',
    submitLabel: 'Next',
    fields: [
      {name: 'txt', type: 'checkbox', label: 'Plain text', checked: true},
      {name: 'md', type: 'checkbox', label: 'Markdown', checked: true},
      {name: 'html', type: 'checkbox', label: 'HTML page'},
      {name: 'json', type: 'checkbox', label: 'JSON'},
      {name: 'csv', type: 'checkbox', label: 'CSV'},
      {name: 'xml', type: 'checkbox', label: 'XML'},
      {name: 'rtf', type: 'checkbox', label: 'RTF (Word)'},
      {name: 'tex', type: 'checkbox', label: 'LaTeX'},
      {name: 'yml', type: 'checkbox', label: 'YAML'},
      {name: 'encrypt', type: 'checkbox', label: 'Encrypt with a password (AES-256)', checked: true},
    ],
    // Encrypting an empty archive is not a thing, so the tick box for the
    // password does not count towards the "at least one format" check.
    validate: (values) => (selectedFormatIds(values).length > 0 ? null : 'Pick at least one format.'),
  })
  if (!choices) return null

  const selected = selectedFormatIds(choices)

  let password = null
  if (choices.encrypt) {
    password = await askArchivePassword()
    if (password === null) return null
  }

  const note = readNote({article})
  const filename = sanitizeFilename(note.title)
  const html = htmlContext(article)

  const entries = selected.map((format) => ({
    name: filename + '.' + format.ext,
    text: convert(note, format.id, format.needs === 'html' ? {html} : {}).text,
    date: new Date(),
  }))

  const blob = await writeZip(entries, {password})
  const saved = await saveBlob(blob, {
    suggestedName: filename + '.zip',
    mime: 'application/zip',
    description: 'ZIP archive',
    accept: {'application/zip': ['.zip']},
  })

  return {ok: saved, encrypted: Boolean(password), entries: entries.length}
}
