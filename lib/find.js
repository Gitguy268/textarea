// Find and replace, as arithmetic.
//
// The panel that faces the reader is lib/find-panel.js; this is the half that
// answers questions about text, with no document and no storage, in the shape
// lib/stats.js and lib/backlinks.js are pure - which is how every rule below
// is unit tested under Node with no browser at all.
//
// The rules worth writing down here rather than in the panel:
//
// - The query is escaped before it is a pattern: find is not a place where a
//   reader types regex and gets surprises. A note full of prices finds `a.b`
//   only in a line that says `a.b`.
// - Matches never overlap, and the scan always advances, because a non-empty
//   escaped pattern cannot match the empty string - so `aa` in `aaa` is one
//   match, and a replace-all cannot loop.
// - Replacement text is literal, all the way through: `$&` is four characters
//   of someone's salary spreadsheet, not a back-reference, and a replacement
//   that itself matches the query is pasted once, not re-scanned.

/**
 * Every non-overlapping place `query` occurs in `text`, in reading order.
 *
 * @param {string} text the note
 * @param {string} query what the reader typed
 * @param {object} [options]
 * @param {boolean} [options.caseSensitive] off by default, like every find
 *   bar the reader has ever used
 * @param {boolean} [options.wholeWord] whole words only, on word boundaries
 * @returns {Array<{start: number, end: number}>} flat offsets into `text`
 */
export function findMatches(text, query, options = {}) {
  const {caseSensitive = false, wholeWord = false} = options
  const body = String(text ?? '')
  const source = String(query ?? '')
  if (!source || !body) return []

  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(
    wholeWord ? `\\b(?:${escaped})\\b` : escaped,
    caseSensitive ? 'g' : 'gi',
  )

  const matches = []
  let match
  while ((match = regex.exec(body)) !== null) {
    matches.push({start: match.index, end: match.index + match[0].length})
  }
  return matches
}

/**
 * The next index to stand on, wrapping at both ends.
 *
 * Called with the count that findMatches just returned, so -1 only ever
 * comes back with a count of 0: there is nowhere to stand, and the caller
 * says so out loud rather than pretending the first match is somewhere.
 *
 * @param {number} current where the reader is now, or -1 for nowhere
 * @param {number} total how many matches there are
 * @param {number} [step] 1 for next, -1 for previous
 * @returns {number} the index to move to, or -1 when there is no match
 */
export function stepIndex(current, total, step = 1) {
  if (!total) return -1
  return (((current + step) % total) + total) % total
}

/**
 * One range replaced by literal text.
 *
 * The range is expected to come from findMatches() on this same text - the
 * panel recomputes before it acts - so there is nothing to clamp and no
 * state to second-guess: this is string surgery, and it says so.
 *
 * @param {string} text
 * @param {{start: number, end: number}} range
 * @param {string} replacement literal, including any `$`
 * @returns {string} the text with that one range swapped
 */
export function replaceRange(text, range, replacement) {
  const body = String(text ?? '')
  const value = String(replacement ?? '')
  return body.slice(0, range.start) + value + body.slice(range.end)
}

/**
 * Every match replaced at once, in one pass over the original text.
 *
 * Built from the matches as they stood before any of the replacements, so a
 * replacement that contains the query is pasted and passed over - the count
 * is the matches that were found, and the note cannot end up replacing
 * forever.
 *
 * @param {string} text
 * @param {Array<{start: number, end: number}>} matches from findMatches()
 * @param {string} replacement literal, including any `$`
 * @returns {{text: string, count: number}} the new text and what was done
 */
export function replaceAll(text, matches, replacement) {
  const body = String(text ?? '')
  const value = String(replacement ?? '')
  let out = ''
  let at = 0
  for (const range of matches) {
    out += body.slice(at, range.start) + value
    at = range.end
  }
  return {text: out + body.slice(at), count: matches.length}
}
