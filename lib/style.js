// Sanitising the note's inline style attribute.
//
// The style half of a shared note is not the reader's own: anyone can craft a
// URL whose payload carries an arbitrary `style` attribute, and opening that
// link sets the attribute on the editor's <article>. Modern browsers do not run
// script from CSS, but an unfiltered declaration can still cover the interface
// (position: fixed; inset: 0) or turn rendering into a request to a third party
// (background: url(...)). The library has a second copy of the same value, so
// the filter has to hold for both.
//
// The fix is an allowlist parsed through the CSSOM: the browser's own parser
// reads the input, and only the decorative properties below are read back out.
// A property that is not on the list never reaches the page, so url(),
// layout overrides and shorthand tricks are dropped without anything having to
// recognise them individually.

/**
 * Decorative properties that cannot load a resource, execute code, or move the
 * element over the rest of the interface. Shorthands stay out; the longhands
 * they expand into are what is listed, which is why `font: 16px Georgia` keeps
 * its parts while `background: url(...)` keeps nothing.
 */
const SAFE_PROPERTIES = [
  'background-color',
  'border-color',
  'border-radius',
  'box-shadow',
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'line-height',
  'max-width',
  'opacity',
  'overflow-wrap',
  'text-align',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-thickness',
  'text-indent',
  'text-shadow',
  'text-transform',
  'text-underline-offset',
  'white-space',
  'word-break',
  'word-spacing',
]

/**
 * A style attribute longer than this is dropped whole.
 *
 * The allowlist bounds the number of declarations, but not the length of a
 * single value, and no legitimate decoration needs kilobytes of font stack.
 */
const MAX_STYLE_LENGTH = 4096

/**
 * The declarations from `cssText` worth keeping, as a style attribute, or null
 * when there are none.
 *
 * @param {string} cssText
 * @returns {string|null}
 */
export function sanitizeStyle(cssText) {
  if (typeof cssText !== 'string' || cssText === '' || cssText.length > MAX_STYLE_LENGTH) {
    return null
  }

  // Parsing happens here and nowhere else: `cssText` is assigned through the
  // CSSOM, so invalid declarations are discarded by the browser before any
  // decision below is made.
  const probe = document.createElement('div')
  probe.style.cssText = cssText

  const kept = []
  for (const property of SAFE_PROPERTIES) {
    const value = probe.style.getPropertyValue(property)
    if (!value) continue
    const priority = probe.style.getPropertyPriority(property)
    kept.push(`${property}: ${value}${priority ? ' !important' : ''}`)
  }

  const sanitized = kept.join('; ')
  if (sanitized === '' || sanitized.length > MAX_STYLE_LENGTH) return null
  return sanitized
}
