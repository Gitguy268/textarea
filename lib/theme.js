/**
 * The colour theme choice.
 *
 * Follows the system by default, like every other site. An explicit choice is
 * kept in the query string rather than in localStorage or in the hash, so a link
 * carries it, nothing is stored, and the hash stays byte-compatible with the
 * notes upstream produces.
 */

/** In the order the menu cycles through them. */
export const THEMES = ['system', 'light', 'dark']

/**
 * The choice a query string asks for. Anything unrecognised means follow the
 * system, since a hand-edited URL should not be able to set a nonsense theme.
 */
export function readTheme(search) {
  const asked = new URLSearchParams(search).get('theme')
  return THEMES.includes(asked) ? asked : 'system'
}

/** The choice after this one, wrapping around. */
export function nextTheme(current) {
  const at = THEMES.indexOf(current)
  return THEMES[(at + 1) % THEMES.length]
}

/**
 * The same URL asking for this theme.
 *
 * Following the system drops the parameter rather than writing "system", so the
 * link stays clean, and the note in the hash is carried across untouched.
 */
export function withTheme(url, theme) {
  const next = new URL(url)
  if (theme === 'system') next.searchParams.delete('theme')
  else next.searchParams.set('theme', theme)
  return next.pathname + next.search + next.hash
}
