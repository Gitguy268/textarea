import assert from 'node:assert/strict'
import {test} from 'node:test'

import {findBacklinks, snippetFor} from '../../lib/backlinks.js'
import {wikiTitles} from '../../lib/markdown.js'

test('a note whose wikilink says the title is a backlink', () => {
  const entries = [
    {title: 'Beta', text: '# Beta\n\nPoints at [[Alpha]] over there.'},
    {title: 'Gamma', text: '# Gamma\n\nNothing to do with it.'},
  ]

  const found = findBacklinks(entries, 'Alpha')
  assert.equal(found.length, 1)
  assert.equal(found[0].entry.title, 'Beta')
  assert.equal(found[0].linked, true)
  // The line the link sits on comes along, so the panel can show where.
  assert.match(found[0].snippet, /Points at \[\[Alpha\]\]/)
})

test('titles match case insensitively and without their padding', () => {
  // The same bargain as the click half: [[alpha]] reaches # Alpha, and the
  // spaces a lazy typist left around a real title never have to match.
  const entries = [{title: 'Beta', text: 'see [[alpha]] and [[  Album  ]]'}]

  assert.equal(findBacklinks(entries, 'Alpha').length, 1)
  assert.equal(findBacklinks(entries, 'album').length, 1)
  assert.equal(findBacklinks(entries, 'ALPHA').length, 1)
})

test('the note on screen does not link to itself', () => {
  // Its own heading says its own title, and its own text may well say it
  // again - neither is a link from somewhere else.
  const entries = [{title: 'Alpha', text: '# Alpha\n\nAlpha again.'}]

  assert.deepEqual(findBacklinks(entries, 'Alpha'), [])
  assert.deepEqual(findBacklinks(entries, 'alpha', {mentions: true}), [])
})

test('prose that merely says the title counts only when it is asked for', () => {
  const entries = [{title: 'Gamma', text: '# Gamma\n\nAlpha ships tomorrow.'}]

  // Off by default: a mention is a weaker claim than a link, and the panel
  // would be lying about which it found.
  assert.deepEqual(findBacklinks(entries, 'Alpha'), [])

  const [found] = findBacklinks(entries, 'Alpha', {mentions: true})
  assert.equal(found.linked, false)
  assert.equal(found.entry.title, 'Gamma')
  assert.equal(found.snippet, 'Alpha ships tomorrow.')
})

test('a longer wikilink that merely starts with the title is not a link', () => {
  // [[alphabet]] is not a link to Alpha; only the prose-search could see
  // the letters, and that half is off until asked for.
  const entries = [{title: 'Beta', text: 'see [[alphabet]]'}]

  assert.deepEqual(findBacklinks(entries, 'Alpha'), [])
  assert.equal(findBacklinks(entries, 'Alpha', {mentions: true}).length, 1)
})

test('an empty title answers nothing', () => {
  const entries = [{title: 'Beta', text: '[[alpha]] and Alpha and everything'}]

  assert.deepEqual(findBacklinks(entries, ''), [])
  assert.deepEqual(findBacklinks(entries, '   '), [])
  assert.deepEqual(findBacklinks(entries, undefined), [])
  // ...and an empty library answers nothing for any title.
  assert.deepEqual(findBacklinks([], 'Alpha'), [])
})

test('the snippet is the line that carries the token, not the first line that says the word', () => {
  const text = 'The alphabet comes first\n\nthen [[alpha]] properly this time'

  // The alphabetical line would win a plain substring search and show the
  // reader a line that has nothing to do with the link.
  assert.equal(snippetFor(text, 'alpha', true), 'then [[alpha]] properly this time')
  // A mention takes the plain line, since there is no token to look for.
  assert.equal(snippetFor(text, 'alphabet', false), 'The alphabet comes first')
  assert.equal(snippetFor(text, 'unrelated', false), '')
})

test('the snippet flattens whitespace and cuts a long line', () => {
  assert.equal(snippetFor('  a   b\t c  ', 'a', false), 'a b c')

  const long = 'alpha ' + 'x'.repeat(200)
  const cut = snippetFor(long, 'alpha', false)
  assert.ok(cut.length <= 120, `expected a cut line, got ${cut.length} characters`)
  assert.ok(cut.endsWith('…'), 'the cut says so rather than pretending it ended')
})

test('wikiTitles reads exactly what the renderer would draw', () => {
  assert.deepEqual(wikiTitles('a [[One]] and [[Two]]'), ['One', 'Two'])
  // Padding is trimmed, because the trimmed title is what a link resolves to.
  assert.deepEqual(wikiTitles('[[  One  ]]'), ['One'])
  // Nothing to name, a title across two lines, and a run past the limit the
  // matcher takes: none of these draw as links, so none of them count.
  assert.deepEqual(wikiTitles('[[ ]] and [[]]'), [])
  assert.deepEqual(wikiTitles('[[one\ntwo]]'), [])
  assert.deepEqual(wikiTitles(`[[${'x'.repeat(201)}]]`), [])
})
