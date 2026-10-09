// Which notes link back to the one on screen.
//
// This is the half of the backlinks feature that has no opinion about how it
// is shown: given the library's entries and the title of the note in the
// editor, it answers with the entries that name it, each carrying the line it
// was found on so the panel can show where. It is pure in the same sense
// lib/stats.js is - no document, no storage, no asynchronous work - which is
// what lets the unit tests exercise the whole search without a browser.
//
// A note counts as linking when one of its `[[wikilinks]]` says this title,
// matched case insensitively the way the click half matches it. Plain prose
// that merely says the title is not a link, and does not count unless the
// reader has asked for mentions as well: the two are different claims about
// a note, and the panel says which one it is showing.

import {wikiTitles} from './markdown.js'

/**
 * The notes that link to `title`, newest first as the library holds them.
 *
 * @param {Array<{title?: string, text?: string}>} entries the library
 * @param {string} title the note on screen
 * @param {{mentions?: boolean}} [options] whether prose that says the title
 *   without linking it counts as well
 * @returns {Array<{entry: object, linked: boolean, snippet: string}>}
 */
export function findBacklinks(entries, title, {mentions = false} = {}) {
  const wanted = String(title ?? '').trim().toLowerCase()
  if (!wanted) return []

  const found = []
  for (const entry of entries) {
    // The note does not link to itself. Titles are the identity everywhere
    // in this app, so this is the same check the click half uses to find a
    // link's target.
    if (String(entry.title ?? '').trim().toLowerCase() === wanted) continue

    const text = String(entry.text ?? '')
    const linked = wikiTitles(text).some((candidate) => candidate.toLowerCase() === wanted)
    if (linked) {
      found.push({entry, linked: true, snippet: snippetFor(text, wanted, true)})
    } else if (mentions && text.toLowerCase().includes(wanted)) {
      found.push({entry, linked: false, snippet: snippetFor(text, wanted, false)})
    }
  }
  return found
}

/**
 * The line worth showing under a backlink's title.
 *
 * For a real link, the line that carries the token - not merely any line
 * that says the title, which could be an unrelated word that happens to
 * start with it. For a mention, any line that says it. Whitespace collapses
 * to single spaces so a paragraph reads as one line in the panel, and a
 * long one is cut rather than wrapping the row.
 *
 * @param {string} text the note's text
 * @param {string} wanted the title to look for, any case
 * @param {boolean} linked whether the note links rather than mentions it
 * @returns {string} the line, flattened, or '' when there is nothing to show
 */
export function snippetFor(text, wanted, linked) {
  const needle = String(wanted ?? '').trim().toLowerCase()
  if (!needle) return ''

  const lines = String(text ?? '').split('\n')
  const line = linked
    ? lines.find((candidate) =>
        wikiTitles(candidate).some((title) => title.toLowerCase() === needle),
      )
    : lines.find((candidate) => candidate.toLowerCase().includes(needle))
  if (!line) return ''

  const flat = line.replace(/\s+/g, ' ').trim()
  return flat.length > 120 ? flat.slice(0, 119) + '…' : flat
}
