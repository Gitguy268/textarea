// Copying text to the clipboard.
//
// `navigator.clipboard` is unavailable on an insecure origin, which includes a
// plain `http://` deployment other than localhost, and is refused outright when
// the page is not the focused document or the user has not granted the
// permission. Copying is now a one-click action behind its own menu entry, so
// both of those cases need an answer rather than an error message: the fallback
// below is what makes the feature work on a phone opened from a QR code on a LAN
// address.

/**
 * Put text on the clipboard.
 *
 * The write is awaited rather than fired off. It rejects whenever the clipboard
 * is not available, and reporting "Copied" without asking would be both wrong
 * and leave the rejection unhandled in the console.
 *
 * @param {string} text
 * @returns {Promise<boolean>} whether the text made it to the clipboard
 */
export async function copyText(text) {
  const value = String(text ?? '')

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall through. A refusal from the modern API is usually a permission or a
      // focus problem, and the legacy path does not care about either.
    }
  }

  return legacyCopy(value)
}

/**
 * The pre-2019 route: a hidden, unfocusable textarea, `execCommand('copy')`.
 *
 * Deprecated and expected to go, but it is still the only path that works where
 * the Clipboard API does not. The element has to be in the document and not
 * `display: none` for the selection to exist, so it is positioned off-screen
 * rather than hidden outright.
 *
 * @param {string} text
 * @returns {boolean}
 */
function legacyCopy(text) {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.tabIndex = -1
  Object.assign(area.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    padding: '0',
    border: 'none',
    outline: 'none',
    boxShadow: 'none',
    background: 'transparent',
    opacity: '0',
  })

  document.body.append(area)

  try {
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}
