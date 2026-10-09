// The QR code panel.
//
// Shows the note's link as a symbol another device can scan, and writes it out
// as a vector file. Two things make it actually work rather than merely render:
//
//   The quiet zone is light. A scanner needs light margin around the code, so the
//   symbol is drawn on white even on the dark theme. Black on a black page reads
//   as an empty square to most cameras.
//
//   The file is SVG, not PNG. A QR is a grid of identical squares, so a vector
//   scales to any print size without resampling, and a 4 KB text file beats a
//   40 KB raster.
//
// The symbol carries the link, not the note. A QR code holding a note's text runs
// out of capacity at a couple of kilobytes, and the link is what the rest of the
// app is built around anyway.

import {sanitizeFilename} from './formats.js'
import {copyText} from './clipboard.js'
import {saveBlob} from './save.js'
import {QrError, qrSvg} from './qr.js'

/**
 * Show the note's link as a QR code.
 *
 * @param {object} options
 * @param {string} options.link       what the symbol encodes, normally location.href
 * @param {string} options.title      the document title, used for the file name
 * @param {boolean} [options.encrypted]  the link is ciphertext and needs a password
 * @returns {Promise<'copy'|'download'|null>} what the user did, or null if dismissed
 */
export async function showQrPanel({link, title, encrypted = false} = {}) {
  const dialog = document.createElement('dialog')
  dialog.className = 'dialog dialog-qr'

  const form = document.createElement('form')
  form.method = 'dialog'
  form.className = 'dialog-form'

  const heading = document.createElement('h2')
  heading.className = 'dialog-title'
  heading.textContent = 'QR code'
  form.append(heading)

  const description = document.createElement('p')
  description.className = 'dialog-description'
  description.textContent = 'Scan this with a phone to open the note on that device.'
  form.append(description)

  const error = document.createElement('p')
  error.className = 'dialog-error'
  error.setAttribute('role', 'alert')
  error.hidden = true
  form.append(error)

  const figure = document.createElement('div')
  figure.className = 'qr-figure'
  form.append(figure)

  if (encrypted) {
    // The QR holds the same ciphertext the address bar does, so scanning it gets
    // someone to a password prompt. Saying so here beats letting them scan, type
    // a password and fail.
    const warning = document.createElement('p')
    warning.className = 'dialog-note'
    warning.textContent =
      'This note is encrypted, so the code holds the encrypted link. ' +
      'The password is not in it and has to be shared separately.'
    form.append(warning)
  }

  const actions = document.createElement('div')
  actions.className = 'dialog-actions'

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'dialog-button'
  close.textContent = 'Close'

  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'dialog-button'
  copy.textContent = 'Copy link'

  const download = document.createElement('button')
  download.type = 'button'
  download.className = 'dialog-button dialog-button-primary'
  download.textContent = 'Download SVG'

  actions.append(close, copy, download)
  form.append(actions)
  dialog.append(form)

  const showError = (message) => {
    error.textContent = message
    error.hidden = false
  }

  try {
    // Rendered at a light foreground explicitly: the panel sits on the page's
    // background, not on the white card behind the symbol.
    // Parsed as XML rather than assigned as HTML: the string comes from the
    // encoder, and a document parsed as the markup it says it is cannot be
    // reinterpreted by the HTML parser on the way in.
    const svg = new DOMParser().parseFromString(
      await qrSvg(link, {dark: '#000000', light: '#ffffff'}),
      'image/svg+xml',
    )
    figure.replaceChildren(document.importNode(svg.documentElement, true))
  } catch (cause) {
    // A note too long for a symbol is the common failure and is worth keeping the
    // dialog open for, so the link can still be copied by hand.
    download.disabled = true
    showError(cause instanceof QrError ? cause.message : 'This note could not be turned into a QR code.')
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      dialog.close()
      dialog.remove()
      resolve(value)
    }

    close.addEventListener('click', () => finish(null))
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(null)
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(null)
    })

    copy.addEventListener('click', async () => {
      if (await copyText(link)) {
        finish('copy')
      } else {
        showError('The browser would not copy to the clipboard.')
      }
    })

    download.addEventListener('click', async () => {
      const saved = await saveBlob(await qrSvg(link, {dark: '#000000'}), {
        suggestedName: sanitizeFilename(title) + '-qr.svg',
        mime: 'image/svg+xml',
        description: 'QR code',
        accept: {'image/svg+xml': ['.svg']},
      })
      finish(saved ? 'download' : null)
    })

    document.body.append(dialog)
    dialog.showModal()
  })
}
