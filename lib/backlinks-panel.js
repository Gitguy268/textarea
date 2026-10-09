// The backlinks panel.
//
// A floating card - top left, because the statistics panel has the bottom
// left and the menu button the bottom right - listing the notes that link to
// the one on screen. Opened from the menu and closed by the same row or by
// its own button, exactly as the statistics panel does it.
//
// The answer is for the note's title, so it is refreshed when the panel
// opens, when a different note comes on screen, and when the app says the
// library moved underneath it - the three ways the answer can change while
// the panel is up. The scan is a library read, so it runs only while the
// panel shows and only when the answer could have moved; a scan finishing
// after a newer one began is dropped, the way the documents panel drops a
// slow render.
//
// Not a live region, for the reason the statistics panel gives: one would
// announce every line as it is rebuilt while the reader is still typing.
//
// The search itself lives in lib/backlinks.js and knows nothing about any
// of this.

import {findBacklinks} from './backlinks.js'
import {icon} from './dialog.js'
import {titleOf} from './front-matter.js'
import {listDocuments} from './library.js'

/**
 * Build the panel and return the handful of methods the app needs.
 *
 * @param {object} [options]
 * @param {(entry: object) => void} [options.onOpen] called with the library
 *   entry of a backlink the reader picked
 * @param {Document} [options.owner]
 * @returns {{element: HTMLElement, open: (text: string, options?: object) => void,
 *   close: () => void, toggle: (text: string, options?: object) => boolean,
 *   isOpen: () => boolean, update: (text: string, options?: object) => void,
 *   onDismiss: (handler: () => void) => void}}
 */
export function createBacklinksPanel({onOpen, owner = document} = {}) {
  const element = owner.createElement('aside')
  element.id = 'backlinks-panel'
  element.className = 'noprint'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Backlinks to this note')
  element.hidden = true

  const head = owner.createElement('div')
  head.className = 'backlinks-head'

  const title = owner.createElement('p')
  title.className = 'backlinks-title'
  title.textContent = 'Backlinks'

  const close = owner.createElement('button')
  close.type = 'button'
  close.className = 'backlinks-close'
  close.setAttribute('aria-label', 'Hide the backlinks')
  close.append(icon('icon-close', 16))

  head.append(title, close)

  const list = owner.createElement('ul')
  list.className = 'backlinks-list'

  const empty = owner.createElement('p')
  empty.className = 'backlinks-empty'
  empty.textContent = 'Nothing links to this title yet.'

  /** Told by the app, so it can put the preference back when the panel is closed. */
  let dismissed = null

  close.addEventListener('click', () => {
    element.hidden = true
    dismissed?.()
  })

  element.append(head, list, empty)

  /** The title the newest completed scan answered for. */
  let scannedTitle = null
  /** Counts scans so a slow one that lost the race stays off the panel. */
  let scanNumber = 0

  const row = ({entry, linked, snippet}) => {
    const item = owner.createElement('li')
    item.className = 'backlink-row'

    const pick = owner.createElement('button')
    pick.type = 'button'
    pick.className = 'backlink-open'

    const name = owner.createElement('span')
    name.className = 'backlink-name'
    name.textContent = entry.title || 'Untitled'
    pick.append(name)

    // The panel shows both claims but does not conflate them: prose that
    // merely says the title is labelled, so it is never mistaken for a link.
    if (!linked) {
      const kind = owner.createElement('span')
      kind.className = 'backlink-kind'
      kind.textContent = 'mention'
      pick.append(kind)
    }

    if (snippet) {
      const line = owner.createElement('span')
      line.className = 'backlink-snippet'
      line.textContent = snippet
      pick.append(line)
    }

    pick.addEventListener('click', () => onOpen?.(entry))
    item.append(pick)
    return item
  }

  const render = (noteTitle, results) => {
    list.replaceChildren()

    if (!noteTitle.trim()) {
      empty.textContent = 'This note has no title yet.'
      empty.hidden = false
      return
    }
    if (!results.length) {
      empty.textContent = 'Nothing links to this title yet.'
      empty.hidden = false
      return
    }

    empty.hidden = true
    for (const result of results) list.append(row(result))
  }

  const scan = async (noteTitle, options) => {
    const mine = ++scanNumber
    const entries = await listDocuments()
    if (mine !== scanNumber) return
    const results = findBacklinks(entries, noteTitle, options)
    if (mine !== scanNumber) return
    render(noteTitle, results)
  }

  /**
   * Answer the panel for what is on screen, if it is showing.
   *
   * A title change is a new question; so is a forced refresh, which is
   * what the app sends when the library lost a note or the mentions
   * choice moved and the title stayed where it was.
   *
   * @param {string} text the note on screen
   * @param {{mentions?: boolean, force?: boolean}} [options]
   */
  const update = (text, options = {}) => {
    if (element.hidden) return
    const noteTitle = titleOf(text)
    if (!options.force && noteTitle === scannedTitle) return
    scannedTitle = noteTitle
    void scan(noteTitle, {mentions: Boolean(options.mentions)})
  }

  return {
    element,

    open(text, options = {}) {
      element.hidden = false
      // Opening is a fresh question, whatever the last answer was.
      update(text, {...options, force: true})
    },

    close() {
      element.hidden = true
    },

    toggle(text, options = {}) {
      if (element.hidden) this.open(text, options)
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
