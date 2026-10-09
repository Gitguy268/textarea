// The find arithmetic, under Node with no browser: the rules lib/find.js
// writes down are the rules the panel is allowed to trust.

import assert from 'node:assert/strict'
import test from 'node:test'

import {findMatches, stepIndex, replaceRange, replaceAll} from '../../lib/find.js'

test('find: every non-overlapping match, in reading order', () => {
  const text = 'the fox and the fox and a foxhole'
  assert.deepEqual(
    findMatches(text, 'fox'),
    [
      {start: 4, end: 7},
      {start: 16, end: 19},
      {start: 26, end: 29},
    ],
    'the fox inside foxhole counts: the default is the substring, whole words is the option below',
  )
  assert.deepEqual(findMatches(text, 'foxhole'), [{start: 26, end: 33}])
  assert.deepEqual(findMatches(text, 'elephant'), [], 'a query that matches nothing lists nothing')
  assert.deepEqual(findMatches(text, ''), [], 'an empty query is not every position in the note')
  assert.deepEqual(findMatches('', 'fox'), [], 'an empty note holds no matches either')

  // Overlap belongs to the reader's imagination, not to the scan: aa in
  // aaa is one match, and saying so is what keeps replace-all finite.
  assert.deepEqual(findMatches('aaa', 'aa'), [{start: 0, end: 2}])
})

test('find: matching is case-blind unless the reader asks otherwise', () => {
  const text = 'The FOX and the fox'
  assert.deepEqual(findMatches(text, 'fox'), [
    {start: 4, end: 7},
    {start: 16, end: 19},
  ])
  assert.deepEqual(findMatches(text, 'fox', {caseSensitive: true}), [{start: 16, end: 19}])

  // Case folding must not move the offsets: the ranges are slices of the
  // original text, and a fold that changed their length would slice wrong.
  const accented = 'CAFÉ and café'
  assert.deepEqual(findMatches(accented, 'café'), [
    {start: 0, end: 4},
    {start: accented.indexOf('café'), end: accented.indexOf('café') + 4},
  ])
})

test('find: whole words draw the line where word characters stop', () => {
  const text = 'a cat concatenates the catalog'
  assert.deepEqual(findMatches(text, 'cat', {wholeWord: true}), [{start: 2, end: 5}])

  // A hyphen ends a word; an underscore does not, because \b counts `_`
  // among the word characters - which is the reader's own intuition of a
  // word until a variable name says otherwise.
  assert.deepEqual(findMatches('cat-x and cat_x and cat', 'cat', {wholeWord: true}), [
    {start: 0, end: 3},
    {start: 20, end: 23},
  ])

  // The option composes with the others rather than replacing them.
  assert.deepEqual(findMatches('Cat cat CAT', 'cat', {wholeWord: true}), [
    {start: 0, end: 3},
    {start: 4, end: 7},
    {start: 8, end: 11},
  ])
})

test('find: the query is a string, not a pattern', () => {
  const text = 'a.c but not abc and (x) but not x and $& is salary'
  const at = (needle) => ({start: text.indexOf(needle), end: text.indexOf(needle) + needle.length})
  assert.deepEqual(findMatches(text, 'a.c'), [at('a.c')])
  assert.deepEqual(findMatches(text, '(x)'), [at('(x)')])
  assert.deepEqual(findMatches(text, '$&'), [at('$&')])
  assert.deepEqual(findMatches(text, 'a+'), [], 'a plus means a plus')
})

test('find: walking wraps at both ends and refuses to stand on nothing', () => {
  assert.equal(stepIndex(0, 3), 1)
  assert.equal(stepIndex(2, 3), 0, 'past the last match comes the first')
  assert.equal(stepIndex(0, 3, -1), 2, 'before the first match comes the last')
  assert.equal(stepIndex(1, 3, -1), 0)
  assert.equal(stepIndex(0, 1), 0, 'one match walks to itself')
  assert.equal(stepIndex(-1, 0), -1, 'no matches is nowhere to stand')
  assert.equal(stepIndex(-1, 0, -1), -1)
  assert.equal(stepIndex(0, 0), -1)
})

test('find: one range replaced is string surgery with nothing hidden', () => {
  assert.equal(replaceRange('the fox sat', {start: 4, end: 7}, 'cat'), 'the cat sat')
  assert.equal(replaceRange('the fox sat', {start: 4, end: 7}, ''), 'the  sat')
  assert.equal(replaceRange('ab', {start: 1, end: 1}, 'X'), 'aXb', 'a caret-wide range inserts')
  // Replacement text is literal, end to end.
  assert.equal(replaceRange('say fox here', {start: 4, end: 7}, '$&!'), 'say $&! here')
})

test('find: replace-all is one pass, and the count is what was found', () => {
  const text = 'fox and fox and a hole'
  const matches = findMatches(text, 'fox')
  const done = replaceAll(text, matches, 'cat')
  assert.equal(done.text, 'cat and cat and a hole')
  assert.equal(done.count, 2)

  // A replacement that matches the query is pasted once and never re-scanned:
  // the note becomes itself twice, and stays finite.
  const looping = replaceAll('a b', findMatches('a b', 'a'), 'a a')
  assert.equal(looping.text, 'a a b')
  assert.equal(looping.count, 1)

  // And nothing found is nothing done, not a note half rebuilt.
  assert.deepEqual(replaceAll(text, [], 'cat'), {text, count: 0})
})
