// The preferences: defaults, the stored contract, and the validators that
// stop a stray string in storage from deciding anything.

import assert from 'node:assert/strict'
import {test} from 'node:test'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
}

const prefs = await import('../../lib/prefs.js')

test('every switch ships the way the original shipped it', () => {
  store.clear()
  const on = ['twoColumnsEnabled', 'fileLinksEnabled', 'wikiCreateEnabled', 'switcherEnabled', 'findEnabled', 'backupEnabled', 'backupMetadata', 'trashEnabled']
  const off = ['wikilinksEnabled', 'tasksEnabled', 'tasksDoneEnabled', 'statsPreferred', 'backlinksPreferred', 'backlinkMentionsEnabled', 'writingPreferred', 'selectionToolsEnabled', 'findCase', 'findWords', 'backupEncrypt', 'backupSingleFile', 'paletteEnabled']
  for (const name of on) assert.equal(prefs[name](), true, name)
  for (const name of off) assert.equal(prefs[name](), false, name)
  assert.equal(prefs.switcherShortcut(), 'k')
  assert.equal(prefs.switcherScope(), 'titles')
  assert.equal(prefs.trashKeep(), '30')
  assert.equal(prefs.librarySort(), 'updated')
  assert.equal(prefs.wordGoal(), 0)
  assert.equal(prefs.writingInstructions(), '')
  assert.equal(prefs.writingToolEnabled('improve'), true)
})

test('a switch writes the key and the value existing profiles already hold', () => {
  store.clear()
  prefs.setWikilinks(true)
  prefs.setTrashEnabled(false)
  prefs.setWritingTool('fix', false)
  prefs.setTrashKeep(90)
  assert.equal(store.get('textarea:wikilinks'), 'on')
  assert.equal(store.get('textarea:trash'), 'off')
  assert.equal(store.get('textarea:writing-tool-fix'), 'off')
  assert.equal(store.get('textarea:trash-keep'), '90')
  assert.equal(prefs.wikilinksEnabled(), true)
  assert.equal(prefs.trashEnabled(), false)
  assert.equal(prefs.writingToolEnabled('fix'), false)
})

test('a stray stored value falls back to the default, never flips it', () => {
  store.clear()
  store.set('textarea:wikilinks', 'yes')
  store.set('textarea:trash', 'no')
  assert.equal(prefs.wikilinksEnabled(), false)
  assert.equal(prefs.trashEnabled(), true)
  assert.equal(prefs.shortcutOf('z'), 'k')
  assert.equal(prefs.shortcutOf('p'), 'p')
  assert.equal(prefs.scopeOf('everything'), 'titles')
  assert.equal(prefs.keepDaysOf('1'), '30')
  assert.equal(prefs.keepDaysOf('7'), '7')
  assert.equal(prefs.sortOf('size'), 'updated')
  assert.equal(prefs.goalOf('-5'), 0)
  assert.equal(prefs.goalOf('abc'), 0)
  assert.equal(prefs.goalOf('500.9'), 500)
})

test('storage that throws costs the reader nothing but the memory', () => {
  const real = globalThis.localStorage
  globalThis.localStorage = {
    getItem() {
      throw new Error('denied')
    },
    setItem() {
      throw new Error('denied')
    },
  }
  try {
    assert.equal(prefs.findEnabled(), true)
    assert.equal(prefs.tasksEnabled(), false)
    assert.doesNotThrow(() => prefs.setFindEnabled(false))
  } finally {
    globalThis.localStorage = real
  }
})
