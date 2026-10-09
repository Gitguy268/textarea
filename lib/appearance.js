// The reader's own appearance: accent colour, note font, text size, line
// spacing.
//
// Each choice is a preference in localStorage like every other switch in the
// app, and each lands as a CSS custom property on the root element. An unset
// preference removes the property again rather than writing the default,
// which is what makes "reset" the same state as "never touched": the
// stylesheet's own values are the only defaults there are.
//
// Nothing here reaches for the DOM or for storage by itself. The caller hands
// in the storage to read and write and the element to style, which is how the
// unit tests exercise the whole path without a browser.

/** The note fonts on offer. Generic families only: every system has them. */
export const FONTS = [
  {id: 'system', label: 'System', stack: 'system-ui'},
  {id: 'serif', label: 'Serif', stack: 'serif'},
  {id: 'mono', label: 'Monospace', stack: 'monospace'},
]

/** The note's text size, in pixels. */
export const SIZE_RANGE = {min: 12, max: 32, fallback: 18}

/** The note's line spacing, as a multiple of the font size. */
export const LEADING_RANGE = {min: 1, max: 2.5, fallback: 1.5}

/** Where each choice is remembered. */
export const KEYS = {
  accent: 'textarea:accent',
  font: 'textarea:font',
  size: 'textarea:note-size',
  leading: 'textarea:note-leading',
}

/** Six hex digits: the only accent a stylesheet can be handed. */
const ACCENT = /^#[0-9a-f]{6}$/i

/**
 * The shape of a custom font's id: `custom-` and the slug of its family.
 *
 * The bytes live in the font shelf's own database, so what the preference
 * can hold has to be recognisable on sight - this is the test that separates
 * "a font the reader added" from "a system stack this whitelist knows" and
 * from anything else a hand-edited preference might say.
 */
const CUSTOM_FONT_ID = /^custom-[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Whether a note font id names a custom font from the shelf.
 *
 * Whether that font still exists is a different question - the answer lives
 * in the shelf - and this only says the preference is shaped like one.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isCustomFont(value) {
  return typeof value === 'string' && CUSTOM_FONT_ID.test(value)
}

/**
 * An accent colour, or null when the value is not one.
 *
 * The colour is lowercased so the same choice reads the same in storage
 * however the picker wrote it.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function readAccent(value) {
  if (typeof value !== 'string' || !ACCENT.test(value)) return null
  return value.toLowerCase()
}

/**
 * A number inside a range, or null when there is no number to be had.
 *
 * Out-of-range values are clamped rather than rejected: a hand-edited
 * preference of 400px means "big", and dropping it would show 18px instead.
 * A value that is not a number at all is not a preference, so it falls back
 * to the stylesheet.
 *
 * @param {unknown} value
 * @param {{min: number, max: number}} range
 * @returns {number | null}
 */
function readRanged(value, range) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const number = Number(text)
  if (!Number.isFinite(number)) return null
  return Math.min(range.max, Math.max(range.min, number))
}

/**
 * The note's text size in pixels, or null when there is nothing to apply.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function readNoteSize(value) {
  return readRanged(value, SIZE_RANGE)
}

/**
 * The note's line spacing, or null when there is nothing to apply.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function readNoteLeading(value) {
  return readRanged(value, LEADING_RANGE)
}

/**
 * A note font from the whitelist, an id shaped like a custom font, or null.
 *
 * A whitelist rather than a raw font stack: the value becomes part of a CSS
 * declaration, and a list of families with quotes and commas in it is not a
 * thing to paste out of storage unexamined. A custom id passes on its shape
 * alone - its stack comes from the font shelf, handed to applyAppearance as
 * a third argument - so the preference can name a font this module has never
 * heard of and still be refused unless it is the exact shape the shelf writes.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function readNoteFont(value) {
  if (typeof value !== 'string') return null
  if (FONTS.some((font) => font.id === value)) return value
  return isCustomFont(value) ? value : null
}

/** The CSS stack behind a whitelisted font id. */
function stackOf(id) {
  return FONTS.find((font) => font.id === id)?.stack ?? null
}

/**
 * The four preferences as the sanitizers see them.
 *
 * Every unset or untrustworthy value comes back null, which is the one
 * representation "leave the stylesheet alone" needs.
 *
 * @param {{getItem: (key: string) => string | null}} storage
 * @returns {{accent: string | null, font: string | null, size: number | null,
 *   leading: number | null}}
 */
export function readAppearance(storage) {
  try {
    return {
      accent: readAccent(storage.getItem(KEYS.accent)),
      font: readNoteFont(storage.getItem(KEYS.font)),
      size: readNoteSize(storage.getItem(KEYS.size)),
      leading: readNoteLeading(storage.getItem(KEYS.leading)),
    }
  } catch {
    // Storage refused: the session keeps the stylesheet's own values.
    return {accent: null, font: null, size: null, leading: null}
  }
}

/**
 * Write the four preferences, sanitised, dropping the ones left unset.
 *
 * Sanitised on the way in so storage holds only values that would read back
 * the same way; a value that does not survive its own sanitizer is not a
 * preference and is removed rather than kept as a lie.
 *
 * @param {{setItem: (key: string, value: string) => void,
 *   removeItem: (key: string) => void}} storage
 * @param {{accent?: unknown, font?: unknown, size?: unknown,
 *   leading?: unknown}} values
 */
export function saveAppearance(storage, values) {
  write(storage, KEYS.accent, readAccent(values.accent))
  write(storage, KEYS.font, readNoteFont(values.font))
  write(storage, KEYS.size, readNoteSize(values.size))
  write(storage, KEYS.leading, readNoteLeading(values.leading))
}

function write(storage, key, value) {
  try {
    if (value === null) storage.removeItem(key)
    else storage.setItem(key, String(value))
  } catch {
    // Storage refused: the look still holds for this session, and the
    // choice is simply not remembered across a reload.
  }
}

/**
 * Put the appearance on an element as custom properties.
 *
 * A null anywhere means "no override": the property is removed so the
 * stylesheet's own value shows through again, which is what makes a reset
 * indistinguishable from never having chosen.
 *
 * @param {{style: {setProperty: (name: string, value: string) => void,
 *   removeProperty: (name: string) => void}}} target
 * @param {{accent?: unknown, font?: unknown, size?: unknown,
 *   leading?: unknown}} values
 * @param {Record<string, string>} [stacks] the custom fonts' stacks by id;
 *   an id with no entry here - deleted, or never loaded - applies as a null
 *   and the stylesheet's own default shows through
 */
export function applyAppearance(target, values, stacks = {}) {
  const accent = readAccent(values.accent)
  // The accent takes the ring and the link together: a link left in the
  // theme's colour would be a second accent beside the first.
  set(target, '--outline', accent)
  set(target, '--link', accent)

  const font = readNoteFont(values.font)
  const stack =
    font === null ? null : stackOf(font) ?? (Object.hasOwn(stacks, font) ? stacks[font] : null)
  set(target, '--note-font', stack)

  const size = readNoteSize(values.size)
  set(target, '--note-size', size === null ? null : `${size}px`)

  const leading = readNoteLeading(values.leading)
  set(target, '--note-leading', leading === null ? null : String(leading))
}

function set(target, name, value) {
  if (value === null) target.style.removeProperty(name)
  else target.style.setProperty(name, value)
}
