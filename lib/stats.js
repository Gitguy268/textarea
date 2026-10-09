// How much note there is: words, characters, lines, and how long it takes to
// read.
//
// Every function here is pure, so the numbers can be unit tested under Node
// without a browser and the panel in the menu is a rendering of one call.
//
// The two reading rates are the only judgement calls in the file, and they are
// deliberately conservative averages rather than anything precise:
//
//   Speaking aloud - 130 words a minute. Measured presentation pace sits around
//   140-150, but nobody reads a note aloud at a keynote, and this number is most
//   often used to answer "can I get through this before the meeting".
//
//   Silent reading - 220 words a minute. Brysbaert (2019) puts English prose
//   non-fiction at 238 wpm, but that figure is measured on young adults reading
//   on a screen with no distractions. A note is usually read once, under time
//   pressure, so the lower number is the more honest estimate.
//
// Both rates are exported, so a reader who disagrees can be told the exact
// arithmetic rather than a bare "6 min".

export const SPOKEN_WPM = 130
export const SILENT_WPM = 220

/**
 * Characters that count as one word each rather than as part of a run.
 *
 * A Japanese or Chinese note has no spaces, so splitting on whitespace calls
 * half a page of prose a single word. Each ideograph, kana and pre-composed
 * Hangul syllable is treated as one word instead, which is how Japanese word
 * counters such as those in Word and Pages behave.
 *
 * Punctuation and the CJK punctuation block are excluded on purpose: a comma
 * is not a word.
 */
const CJK_WORD =
  /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff66-\uff9f]/

/**
 * Characters that end a word without being one.
 *
 * Whitespace obviously. The rest is CJK punctuation, which is why the two
 * classes above have to be kept apart: `、` and `。` sit in U+3000-U+303F, well
 * below the kana block, so a note in Japanese would otherwise count every comma
 * and full stop as an extra word. The fullwidth forms are here for the same
 * reason, and stop short of U+FF21 and U+FF41 because those are letters.
 */
const SEPARATOR = /[\s\u3000-\u303f\ufe10-\ufe1f\uff01-\uff20\uff3b-\uff40\uff5b-\uff65]/

/**
 * @typedef {object} NoteStats
 * @property {number} words            words, counting CJK characters one by one
 * @property {number} characters       every character, spaces and line breaks included
 * @property {number} charactersTight  the same, without whitespace
 * @property {number} lines            as the caret counts them, so a trailing newline opens a line
 * @property {number} paragraphs       runs of non-blank lines
 * @property {number} sentences        ends on . ! ? or …, approximate around abbreviations
 * @property {number} speakingMinutes  at SPOKEN_WPM
 * @property {number} readingMinutes   at SILENT_WPM
 */

/**
 * Count everything the statistics panel shows.
 *
 * @param {string} text
 * @returns {NoteStats}
 */
export function countStats(text) {
  const value = String(text ?? '')
  const words = countWords(value)

  return {
    words,
    characters: [...value].length,
    charactersTight: [...value].length - (value.match(/\s/g)?.length ?? 0),
    lines: countLines(value),
    paragraphs: countParagraphs(value),
    sentences: countSentences(value),
    speakingMinutes: words / SPOKEN_WPM,
    readingMinutes: words / SILENT_WPM,
  }
}

/**
 * Words as an editor counts them.
 *
 * Runs of non-separator characters are one word each, so "well-known" and
 * "don't" stay whole, which is what Word, Pages and LibreOffice do. Iterating
 * with `for...of` walks code points rather than code units, so an emoji or a
 * character outside the Basic Multilingual Plane counts once.
 */
function countWords(text) {
  let words = 0
  let insideRun = false

  for (const character of text) {
    if (CJK_WORD.test(character)) {
      words++
      insideRun = false
    } else if (SEPARATOR.test(character)) {
      insideRun = false
    } else if (!insideRun) {
      words++
      insideRun = true
    }
  }

  return words
}

/**
 * Lines as the caret sees them.
 *
 * A note with one line and a trailing newline shows two lines in the editor,
 * because the newline moves the caret to the second, so it is counted here too.
 * An empty note reports zero rather than the one line an empty editor displays:
 * "0 words, 0 lines" reads as an empty note, "0 words, 1 line" reads as a bug.
 */
function countLines(text) {
  if (text === '') return 0
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++
  }
  return lines
}

/** Blocks of non-blank lines. Leading and trailing blank lines are ignored. */
function countParagraphs(text) {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return trimmed.split(/\n[ \t]*\n+/).length
}

/**
 * Sentences, ending on `.`, `!`, `?` or `…` followed by whitespace or the end.
 *
 * This overcounts abbreviations ("e.g." reads as two sentences), which every
 * regex-based counter does. It is shown next to a reading time, where being a
 * few percent out does not matter, so a sentence segmenter is not worth its
 * weight here.
 */
function countSentences(text) {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return trimmed.split(/(?<=[.!?…])[ \t]+|[ \t]*\n+/).filter((part) => part !== '').length
}

/**
 * A duration in minutes as something a person would say out loud.
 *
 * Under a minute the seconds are more useful than a rounded zero, and past an
 * hour the minutes alone stop meaning anything. This is only ever used for a
 * reading estimate, so `12 min` rather than `12.3 min` is the right trade: a
 * false precision on top of an already approximate rate would be misleading.
 *
 * @param {number} minutes
 * @returns {string}
 */
export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 sec'

  const seconds = Math.round(minutes * 60)
  if (seconds < 60) return `${seconds} sec`

  const wholeMinutes = Math.round(minutes)
  if (wholeMinutes < 60) return `${wholeMinutes} min`

  const hours = Math.floor(wholeMinutes / 60)
  const rest = wholeMinutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')} min`
}
