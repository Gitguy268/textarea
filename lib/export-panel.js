// The Export panel: one entry point for getting a note out of the editor.
//
// Four destinations, chosen in one dialog:
//
//   file - a single file in one of the nine formats the registry already has
//   copy - the same nine formats, onto the clipboard, in one click
//   qr   - the note's link as a scannable symbol
//   zip  - any combination of the formats in one optionally encrypted archive
//
// File and copy share one format list and go through the same converter, so the
// text on the clipboard is byte for byte the text that a download would have
// written. That is the whole reason this is one dialog rather than two menu
// items with two lists of formats: two lists would drift.
//
// The file row carries the floppy rather than the download arrow: it reads
// "Save to a file", and the floppy says the same thing. The download arrow
// stays on the Export menu entry, where the note is leaving the app.

import {copyText} from './clipboard.js'
import {showDialog} from './dialog.js'
import {exportArchiveInteractive, exportFormat, renderFormat} from './export.js'
import {FORMATS} from './formats.js'
import {showQrPanel} from './qr-panel.js'

/**
 * In the order they are offered. `submit` names the button for each choice, so
 * the dialog never offers to "Export" a QR code as a file.
 */
export const DESTINATIONS = [
  {value: 'file', label: 'Save to a file', submit: 'Save', icon: 'icon-save'},
  {value: 'copy', label: 'Copy to the clipboard', submit: 'Copy', icon: 'icon-copy'},
  {value: 'qr', label: 'QR code of the note link', submit: 'Show', icon: 'icon-qr'},
  {value: 'zip', label: 'ZIP archive of several formats', submit: 'Save', icon: 'icon-zip'},
]

/**
 * Ask where the note is going, then send it there.
 *
 * @param {HTMLElement} article
 * @param {object} [options]
 * @param {(message: string, isError?: boolean) => void} [options.notify]
 * @param {boolean} [options.encrypted]  whether the link in the address bar is encrypted
 * @returns {Promise<void>} every outcome is reported through notify
 */
export async function exportInteractive(article, {notify, encrypted = false} = {}) {
  const say = notify ?? (() => {})

  const values = await showDialog({
    title: 'Export',
    className: 'dialog-scroll',
    description: 'Save the note as a file, put it on the clipboard, or share it another way.',
    submitLabel: 'Export',
    submitLabelFor: (answers) =>
      DESTINATIONS.find((destination) => destination.value === answers.destination)?.submit ?? 'Export',
    fields: [
      {
        name: 'destination',
        type: 'radio',
        label: 'Where does it go?',
        options: DESTINATIONS.map(({value, label, icon}) => ({value, label, icon})),
      },
      {
        name: 'format',
        type: 'radio',
        className: 'dialog-field-grow',
        label: 'Format',
        // The QR code carries the link rather than the text, and the archive
        // picks its own formats, so this list only applies to the first two.
        when: (answers) => answers.destination === 'file' || answers.destination === 'copy',
        options: FORMATS.map((format) => ({
          value: format.id,
          label: `${format.label}  (.${format.ext})`,
        })),
      },
    ],
  })
  if (!values) return

  switch (values.destination) {
    case 'copy':
      return copyFormat(article, values.format, say)
    case 'qr':
      return exportQr(encrypted, say)
    case 'zip': {
      const archive = await exportArchiveInteractive(article)
      if (!archive) return
      say(
        archive.encrypted
          ? `Saved ${archive.entries} files in an AES-256 encrypted archive`
          : `Saved ${archive.entries} files in an archive`,
      )
      return
    }
    default:
      // A cancelled save is the user changing their mind, not a failure worth a
      // red bubble.
      if (await exportFormat(article, values.format)) say('Saved')
  }
}

/**
 * Put one converted format on the clipboard.
 *
 * @param {HTMLElement} article
 * @param {string} formatId
 * @param {(message: string, isError?: boolean) => void} say
 */
async function copyFormat(article, formatId, say) {
  const text = renderFormat(article, formatId)
  const label = FORMATS.find((format) => format.id === formatId)?.label ?? 'Note'

  if (text === '') {
    say('There is nothing to copy yet', true)
    return
  }

  if (!(await copyText(text))) {
    say('The browser would not copy to the clipboard', true)
    return
  }

  // The character count is what a reader wants to know after pasting: an RTF or a
  // LaTeX document is many times the length of the note, and being told so
  // before it lands in a chat window is kinder than being told afterwards.
  say(`Copied ${label}, ${text.length} characters`)
}

/**
 * Show the note's link as a QR code.
 *
 * @param {boolean} encrypted
 * @param {(message: string, isError?: boolean) => void} say
 */
async function exportQr(encrypted, say) {
  const action = await showQrPanel({
    link: location.href,
    title: document.title,
    encrypted,
  })

  if (action === 'copy') say('Link copied')
  else if (action === 'download') say('QR code saved')
}
