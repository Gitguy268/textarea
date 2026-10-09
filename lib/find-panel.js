// Find and replace, as the reader meets it.
//
// Ctrl/Cmd+F opens this instead of the browser's own find - which is what
// claiming a chord means, and the reason the whole feature carries a switch:
// off, and the chord goes back to the browser untouched. The bar is a native
// <dialog> like the quick switcher, so Escape, the backdrop and focus
// handling are the browser's job rather than ours, and it is fetched on the
// chord that needs it rather than at boot.
//
// Every question about the text is lib/find.js's; this file is the face.
// The seam it is built around is injected - the note, the selection, and the
// three ways it writes - so the panel imports nothing from the app and the
// browser suite drives the real one.

import {findMatches, stepIndex, replaceAll} from './find.js'

/**
 * Build the bar and return the handful of methods the app needs.
 *
 * @param {object} [options]
 * @param {() => string} options.getNote the note's current text
 * @param {() => {start: number, end: number, text: string}}
 *   [options.selection] the editor's current selection, which seeds the
 *     query the way every find bar does
 * @param {(start: number, end: number) => void} options.select put the
 *   selection on a range of the note, without taking the reader's focus
 * @param {(text: string) => void} options.insert replace the selection with
 *   text, undoably - this is what a replace hands its work to
 * @param {(text: string) => void} options.replace swap the whole note,
 *   undoably, for replace-all's one step
 * @param {(message: string) => void} [options.notify]
 * @param {object} [options.prefs] the two remembered defaults, as get/set
 *   pairs against the same preferences Settings' rows point at
 * @param {Document} [options.owner]
 * @returns {{element: HTMLElement, open: () => void, close: () => void,
 *   isOpen: () => boolean, refresh: () => void}}
 */
export function createFind({
  getNote,
  selection = () => ({start: 0, end: 0, text: ''}),
  select,
  insert,
  replace,
  notify,
  prefs = {},
  owner = document,
} = {}) {
  const dialog = owner.createElement('dialog')
  dialog.className = 'dialog dialog-find'
  dialog.setAttribute('aria-label', 'Find and replace')

  const body = owner.createElement('div')
  body.className = 'find-body'

  const query = owner.createElement('input')
  query.type = 'search'
  query.id = 'find-query'
  query.placeholder = 'Find in note…'
  query.spellcheck = false

  const count = owner.createElement('output')
  count.id = 'find-count'
  count.setAttribute('aria-live', 'polite')

  const prev = owner.createElement('button')
  prev.type = 'button'
  prev.id = 'find-prev'
  prev.className = 'dialog-button find-action'
  prev.textContent = '‹'
  prev.setAttribute('aria-label', 'Previous match')

  const next = owner.createElement('button')
  next.type = 'button'
  next.id = 'find-next'
  next.className = 'dialog-button find-action'
  next.textContent = '›'
  next.setAttribute('aria-label', 'Next match')

  const findRow = owner.createElement('div')
  findRow.className = 'find-row'
  findRow.append(query, count, prev, next)

  const replaceInput = owner.createElement('input')
  replaceInput.type = 'text'
  replaceInput.id = 'find-replace'
  replaceInput.placeholder = 'Replace with…'
  replaceInput.setAttribute('aria-label', 'Replace with')
  replaceInput.spellcheck = false

  const replaceOne = owner.createElement('button')
  replaceOne.type = 'button'
  replaceOne.id = 'find-replace-one'
  replaceOne.className = 'dialog-button find-action'
  replaceOne.textContent = 'Replace'

  const replaceAllButton = owner.createElement('button')
  replaceAllButton.type = 'button'
  replaceAllButton.id = 'find-replace-all'
  replaceAllButton.className = 'dialog-button find-action'
  replaceAllButton.textContent = 'Replace all'

  const replaceRow = owner.createElement('div')
  replaceRow.className = 'find-row'
  replaceRow.append(replaceInput, replaceOne, replaceAllButton)

  const caseBox = owner.createElement('input')
  caseBox.type = 'checkbox'
  caseBox.id = 'find-case'
  const caseLabel = owner.createElement('label')
  caseLabel.append(caseBox, 'Match case')

  const wordsBox = owner.createElement('input')
  wordsBox.type = 'checkbox'
  wordsBox.id = 'find-words'
  const wordsLabel = owner.createElement('label')
  wordsLabel.append(wordsBox, 'Whole words')

  const options = owner.createElement('div')
  options.className = 'find-options'
  options.append(caseLabel, wordsLabel)

  const help = owner.createElement('p')
  help.className = 'dialog-hint'
  help.textContent = 'Enter finds the next match, Shift+Enter the previous, Escape closes.'

  body.append(findRow, replaceRow, options, help)
  dialog.append(body)

  /** What the query matches in the note as it stands. */
  let matches = []
  /** Where the reader is in that list, or -1 for nowhere. */
  let current = -1

  const paint = () => {
    const total = matches.length
    count.textContent = query.value
      ? total
        ? `${current + 1} of ${total}`
        : 'No matches'
      : ''
    prev.disabled = !total
    next.disabled = !total
    replaceOne.disabled = !total
    replaceAllButton.disabled = !total
  }

  /**
   * Re-read the note, the query and the two defaults, and put the
   * selection on the match the reader is standing on.
   *
   * Also called from Settings when a default moves, which is why the
   * selection half is guarded on the dialog being up: a closed bar
   * repaints its checkboxes and leaves the note's caret alone.
   */
  const refresh = () => {
    caseBox.checked = Boolean(prefs.getCase?.())
    wordsBox.checked = Boolean(prefs.getWords?.())
    matches = findMatches(getNote(), query.value, {
      caseSensitive: caseBox.checked,
      wholeWord: wordsBox.checked,
    })
    current = matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : -1
    paint()
    if (dialog.open && current >= 0) select(matches[current].start, matches[current].end)
  }

  const step = (delta) => {
    if (!matches.length) return
    current = stepIndex(current, matches.length, delta)
    paint()
    select(matches[current].start, matches[current].end)
  }

  const replaceCurrent = () => {
    const range = matches[current]
    if (!range) return
    // Put the selection on the match and hand the text to insert(), which
    // replaces it the way a keystroke would: one undo takes it back out,
    // and the autosave hears about it in the same breath.
    select(range.start, range.end)
    insert(replaceInput.value)
    // The note is different text now. The same index is what followed the
    // match - where a reader's eye goes next - or the match the replacement
    // itself became, if it still matches.
    refresh()
  }

  const replaceEverything = () => {
    if (!matches.length) return
    const done = replaceAll(getNote(), matches, replaceInput.value)
    if (!done.count) return
    // One undo takes the whole batch back: the note is swapped once, not
    // match by match.
    replace(done.text)
    current = -1
    refresh()
    notify?.(done.count === 1 ? 'Replaced 1 match' : `Replaced ${done.count} matches`)
  }

  const rememberCase = () => {
    prefs.setCase?.(caseBox.checked)
    refresh()
  }
  const rememberWords = () => {
    prefs.setWords?.(wordsBox.checked)
    refresh()
  }

  query.addEventListener('input', () => {
    current = 0
    refresh()
  })
  query.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // A search box eats Escape to clear itself before the dialog ever
      // sees the key - the same bargain the quick switcher makes - so the
      // close it promised is handled here, where the key lands.
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    }
  })
  replaceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      replaceCurrent()
    }
  })
  prev.addEventListener('click', () => step(-1))
  next.addEventListener('click', () => step(1))
  replaceOne.addEventListener('click', replaceCurrent)
  replaceAllButton.addEventListener('click', replaceEverything)
  caseBox.addEventListener('change', rememberCase)
  wordsBox.addEventListener('change', rememberWords)

  const close = () => dialog.close()

  // The backdrop is the dialog element itself, the way the switcher closes.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close()
  })
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    close()
  })

  return {
    element: dialog,

    open() {
      // A selection the reader already made is the obvious first query,
      // the way every find bar they have used behaves - as long as it is
      // one line and short enough to be a search rather than a paste.
      if (!query.value) {
        const text = String(selection()?.text ?? '')
        if (text && !text.includes('\n') && text.length <= 200) query.value = text
      }
      current = 0
      // The element is cached after its first build, but anything can take it
      // out of the document again - the test suite's reset removes every
      // dialog so a stale one cannot break the next run's strict-mode
      // locator. showModal() throws InvalidStateError on a detached element,
      // so reattach first; the alternative is rebuilding the bar every open.
      if (!dialog.isConnected) document.body.append(dialog)
      if (!dialog.open) dialog.showModal()
      refresh()
      query.focus()
      query.select()
    },

    close,

    isOpen() {
      return dialog.open
    },

    refresh,
  }
}
