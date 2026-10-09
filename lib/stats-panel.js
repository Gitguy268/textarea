// The statistics panel.
//
// A small always-visible readout of how much note there is, opened from the menu
// and closed by the same menu entry. It updates as the note changes.
//
// It is not a live region, and that is deliberate. A live region rewrites its
// contents on every keystroke, so a screen reader would announce "Words: 4" then
// "Words: 5" then "Words: 6" for as long as anyone typed, and would queue the
// whole session up behind itself. The numbers are readable on demand with
// arrow keys, which is what they are actually for.
//
// The rates behind the two time estimates live in lib/stats.js and are explained
// there. Both are averages, not measurements, and the panel says so in a hint so
// nobody quotes the number as one.

import {icon} from './dialog.js'
import {countStats, formatDuration} from './stats.js'

/**
 * Build the panel and return the handful of methods the app needs.
 *
 * @param {Document} [owner]
 * @returns {{element: HTMLElement, open: (text: string) => void, close: () => void,
 *   toggle: (text: string) => void, isOpen: () => boolean, update: (text: string) => void}}
 */
export function createStatsPanel(owner = document) {
  const element = owner.createElement('aside')
  element.id = 'stats-panel'
  element.className = 'noprint'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Note statistics')
  element.hidden = true

  const head = owner.createElement('div')
  head.className = 'stats-head'

  const title = owner.createElement('p')
  title.className = 'stats-title'
  title.textContent = 'Note statistics'

  const close = owner.createElement('button')
  close.type = 'button'
  close.className = 'stats-close'
  close.setAttribute('aria-label', 'Hide the statistics')
  close.append(icon('icon-close', 16))

  head.append(title, close)

  const list = owner.createElement('dl')
  list.className = 'stats-list'

  // The order is deliberate: size first, then the two estimates, so the numbers
  // that change as you type are read before the ones that do not.
  const rows = [
    {key: 'words', label: 'Words'},
    {key: 'characters', label: 'Characters'},
    {key: 'charactersTight', label: 'Characters without spaces'},
    {key: 'lines', label: 'Lines'},
    {key: 'sentences', label: 'Sentences'},
    {key: 'speaking', label: 'Spoken aloud', format: formatDuration},
    {key: 'reading', label: 'Reading', format: formatDuration},
  ].map(({key, label}) => {
    const term = owner.createElement('dt')
    term.textContent = label
    const value = owner.createElement('dd')
    value.dataset.key = key
    list.append(term, value)
    return key
  })

  const hint = owner.createElement('p')
  hint.className = 'stats-hint'
  hint.textContent =
    'Speaking aloud is measured at 130 words a minute and reading at 220. Both are averages, not a measurement of you.'

  /** Told by the app, so it can put the preference back when the panel is closed. */
  let dismissed = null

  close.addEventListener('click', () => {
    element.hidden = true
    dismissed?.()
  })

  element.append(head, list, hint)

  const read = (text) => {
    const stats = countStats(text)
    return {
      words: String(stats.words),
      characters: String(stats.characters),
      charactersTight: String(stats.charactersTight),
      lines: String(stats.lines),
      sentences: String(stats.sentences),
      speaking: formatDuration(stats.speakingMinutes),
      reading: formatDuration(stats.readingMinutes),
    }
  }

  const update = (text) => {
    if (element.hidden) return
    const values = read(text)
    for (const key of rows) {
      const cell = list.querySelector(`dd[data-key="${key}"]`)
      if (cell) cell.textContent = values[key]
    }
  }

  return {
    element,

    open(text) {
      element.hidden = false
      update(text)
    },

    close() {
      element.hidden = true
    },

    toggle(text) {
      if (element.hidden) this.open(text)
      else this.close()
      return !element.hidden
    },

    isOpen() {
      return !element.hidden
    },

    update,

    onDismiss(handler) {
      dismissed = handler
    },
  }
}
