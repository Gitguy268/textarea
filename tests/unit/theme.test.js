import assert from 'node:assert/strict'
import {test} from 'node:test'

import {nextTheme, readTheme, THEMES, withTheme} from '../../lib/theme.js'

test('the default is to follow the system', () => {
  assert.equal(readTheme(''), 'system')
  assert.equal(readTheme('?'), 'system')
  assert.deepEqual(THEMES, ['system', 'light', 'dark'])
})

test('a query string that asks for a theme gets it', () => {
  assert.equal(readTheme('?theme=light'), 'light')
  assert.equal(readTheme('?theme=dark'), 'dark')
  assert.equal(readTheme('?theme=system'), 'system')
  // Alongside other parameters, in either order.
  assert.equal(readTheme('?a=1&theme=dark&b=2'), 'dark')
})

test('anything unrecognised falls back to the system', () => {
  // A hand-edited link should not be able to ask for something that does not
  // exist, and an old link with a stale value should still render.
  for (const search of ['?theme=', '?theme=blue', '?theme=DARK', '?theme=dark%20mode', '?theme=1']) {
    assert.equal(readTheme(search), 'system', `for ${search}`)
  }
})

test('the menu cycles and wraps', () => {
  assert.equal(nextTheme('system'), 'light')
  assert.equal(nextTheme('light'), 'dark')
  assert.equal(nextTheme('dark'), 'system')
})

test('the url carries the theme and keeps the note', () => {
  assert.equal(withTheme('https://textarea.my/#abc', 'dark'), '/?theme=dark#abc')
  assert.equal(withTheme('https://textarea.my/#abc', 'light'), '/?theme=light#abc')

  // Back to the system drops the parameter rather than writing it out, so the
  // link is exactly what it was before.
  assert.equal(withTheme('https://textarea.my/?theme=dark#abc', 'system'), '/#abc')
})

test('switching the theme does not disturb other parameters', () => {
  assert.equal(withTheme('https://textarea.my/?a=1#abc', 'dark'), '/?a=1&theme=dark#abc')
  assert.equal(withTheme('https://textarea.my/?a=1&theme=light#abc', 'dark'), '/?a=1&theme=dark#abc')
})
