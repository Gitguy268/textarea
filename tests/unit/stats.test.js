import assert from 'node:assert/strict'
import {test} from 'node:test'

import {countStats, formatDuration, SILENT_WPM, SPOKEN_WPM} from '../../lib/stats.js'

test('an empty note measures nothing', () => {
  assert.deepEqual(countStats(''), {
    words: 0,
    characters: 0,
    charactersTight: 0,
    lines: 0,
    paragraphs: 0,
    sentences: 0,
    speakingMinutes: 0,
    readingMinutes: 0,
  })
})

test('null and undefined are treated as an empty note', () => {
  // The panel updates on every input event, including the ones that clear it.
  assert.equal(countStats(null).words, 0)
  assert.equal(countStats(undefined).characters, 0)
})

test('words are counted the way an editor counts them', () => {
  assert.equal(countStats('one two three').words, 3)
  assert.equal(countStats('  one   two  \n three  ').words, 3)
  // Punctuation on its own is not a word, and a hyphen does not split one.
  assert.equal(countStats("well-known, don't").words, 2)
  assert.equal(countStats('a b c d e').words, 5)
})

test('CJK text is counted character by character', () => {
  // Splitting on whitespace would call this whole line a single word, which is
  // how a Japanese note ends up reported as one word and read as empty.
  assert.equal(countStats('日本語のテキスト').words, 8)
  assert.equal(countStats('中文字符测试').words, 6)
  assert.equal(countStats('안녕하세요').words, 5)

  // Mixed with Latin: the runs still count as one word each.
  assert.equal(countStats('hello 世界 goodbye').words, 4)
})

test('CJK punctuation is not a word', () => {
  // 、 and 。 sit below the kana block, so they need excluding on their own or
  // every comma in a Japanese note becomes an extra word.
  assert.equal(countStats('はい、いいえ。').words, 5)
  assert.equal(countStats('一、二、三。').words, 3)
  // The ideographic space separates too.
  assert.equal(countStats('一　二').words, 2)
  // As do the fullwidth forms, which are punctuation rather than letters.
  assert.equal(countStats('ａ、ｂ').words, 2)
})

test('characters outside the basic plane count once', () => {
  // An emoji is two UTF-16 code units. Counting code units would report two.
  assert.equal(countStats('🎉').characters, 1)
  assert.equal(countStats('🎉').words, 1)
  assert.equal(countStats('a🎉b').characters, 3)
})

test('lines are counted as the caret counts them', () => {
  assert.equal(countStats('one line').lines, 1)
  assert.equal(countStats('one\ntwo').lines, 2)
  // A trailing newline moves the caret onto a new line, so it counts.
  assert.equal(countStats('one\n').lines, 2)
  assert.equal(countStats('one\n\n\ntwo').lines, 4)
})

test('characters are counted with and without whitespace', () => {
  const note = 'ab cd\nef'
  assert.equal(countStats(note).characters, 8)
  assert.equal(countStats(note).charactersTight, 6)
})

test('paragraphs are blocks of non-blank lines', () => {
  assert.equal(countStats('one\ntwo').paragraphs, 1)
  assert.equal(countStats('one\n\ntwo').paragraphs, 2)
  assert.equal(countStats('one\n \n\ntwo').paragraphs, 2)
  // Leading and trailing blank lines are not a paragraph of their own.
  assert.equal(countStats('\n\none\n\n\n').paragraphs, 1)
  assert.equal(countStats('   \n  ').paragraphs, 0)
})

test('sentences end on a full stop, a question or an ellipsis', () => {
  assert.equal(countStats('One. Two. Three.').sentences, 3)
  assert.equal(countStats('Really? Yes! No.').sentences, 3)
  assert.equal(countStats('Wait… then go.').sentences, 2)
  // No terminator at all is still one sentence.
  assert.equal(countStats('no terminator here').sentences, 1)
})

test('reading time uses the two published rates', () => {
  const stats = countStats('word '.repeat(260).trim())
  assert.equal(stats.words, 260)
  assert.equal(stats.speakingMinutes, 260 / SPOKEN_WPM)
  assert.equal(stats.readingMinutes, 260 / SILENT_WPM)

  // Speaking aloud always takes longer than reading, which is the only claim the
  // panel makes about them.
  assert.ok(stats.speakingMinutes > stats.readingMinutes)
  assert.equal(SPOKEN_WPM, 130)
  assert.equal(SILENT_WPM, 220)
})

test('durations are said the way a person would say them', () => {
  assert.equal(formatDuration(0), '0 sec')
  assert.equal(formatDuration(0.1), '6 sec')
  assert.equal(formatDuration(0.99), '59 sec')
  assert.equal(formatDuration(1), '1 min')
  assert.equal(formatDuration(6.9), '7 min')
  assert.equal(formatDuration(59), '59 min')
  assert.equal(formatDuration(60), '1 h')
  assert.equal(formatDuration(65), '1 h 05 min')
  assert.equal(formatDuration(125.4), '2 h 05 min')
})

test('a nonsense duration is zero rather than NaN', () => {
  // formatDuration is handed the output of countStats, but a panel that rendered
  // "NaN min" would be worse than one that renders nothing useful.
  assert.equal(formatDuration(NaN), '0 sec')
  assert.equal(formatDuration(Infinity), '0 sec')
  assert.equal(formatDuration(-5), '0 sec')
})

test('a goal is progress towards it, and no goal is nothing to print', async () => {
  const {goalProgress} = await import('../../lib/stats.js')
  assert.equal(goalProgress(120, 0), '')
  assert.equal(goalProgress(0, 500), '0 of 500 (0%)')
  assert.equal(goalProgress(499, 500), '499 of 500 (99%)')
  assert.equal(goalProgress(500, 500), '500 of 500 (100%)')
  assert.equal(goalProgress(750, 500), '750 of 500 (150%)')
})
