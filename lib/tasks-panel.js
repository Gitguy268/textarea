// The tasks panel.
//
// A floating card - top left, beside the backlinks panel, which answers the
// same neighbourhood of question: other notes. This one lists every unticked
// `- [ ]` across the library, newest note first, each row opening the note it
// came from.
//
// What counts as a task is the renderer's own answer: tasksIn() walks the tree
// the note is drawn from, so a bracket inside a fenced block never reaches the
// panel, and a line the panel counts is a line the note draws as a checkbox.
// The scan is a library read, so it runs only while the panel shows; a scan
// finishing after a newer one began is dropped, the way the backlinks panel
// drops a slow answer.
//
// Not a live region, for the reason the statistics panel gives: one would
// announce every line as it is rebuilt while the reader is still typing.
//
// The reading itself lives in lib/markdown.js and knows nothing about any of
// this.

import {icon} from './dialog.js'
import {listDocuments} from './library.js'
import {tasksIn} from './markdown.js'

/**
 * Build the panel and return the handful of methods the app needs.
 *
 * @param {object} [options]
 * @param {(entry: object) => void} [options.onOpen] called with the library
 *   entry of the task the reader picked
 * @param {Document} [options.owner]
 * @returns {{element: HTMLElement, open: (options?: object) => void,
 *   close: () => void, toggle: (options?: object) => boolean,
 *   isOpen: () => boolean, update: (options?: object) => void,
 *   onDismiss: (handler: () => void) => void}}
 */
export function createTasksPanel({onOpen, owner = document} = {}) {
  const element = owner.createElement('aside')
  element.id = 'tasks-panel'
  element.className = 'noprint'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Open tasks across the library')
  element.hidden = true

  const head = owner.createElement('div')
  head.className = 'tasks-head'

  const title = owner.createElement('p')
  title.className = 'tasks-title'
  title.textContent = 'Tasks'

  const close = owner.createElement('button')
  close.type = 'button'
  close.className = 'tasks-close'
  close.setAttribute('aria-label', 'Hide the tasks')
  close.append(icon('icon-close', 16))

  head.append(title, close)

  const list = owner.createElement('ul')
  list.className = 'tasks-list'

  const empty = owner.createElement('p')
  empty.className = 'tasks-empty'
  empty.textContent = 'No open tasks.'

  /** Told by the app, so it can put the row back when the panel is closed. */
  let dismissed = null

  close.addEventListener('click', () => {
    element.hidden = true
    dismissed?.()
  })

  element.append(head, list, empty)

  /** Counts scans so a slow one that lost the race stays off the panel. */
  let scanNumber = 0

  const row = ({entry, task, done}) => {
    const item = owner.createElement('li')
    item.className = done ? 'task-row task-row-done' : 'task-row'

    const pick = owner.createElement('button')
    pick.type = 'button'
    pick.className = 'task-open'

    const name = owner.createElement('span')
    name.className = 'task-name'
    name.textContent = entry.title || 'Untitled'
    pick.append(name)

    // The label is the source the note holds - the same words the checkbox
    // draws over - so the row never promises text the note does not have.
    if (task.text) {
      const words = owner.createElement('span')
      words.className = 'task-text'
      words.textContent = task.text
      pick.append(words)
    }

    pick.addEventListener('click', () => onOpen?.(entry))
    item.append(pick)
    return item
  }

  const render = (rows, showDone) => {
    list.replaceChildren()

    if (!rows.length) {
      empty.textContent = showDone ? 'No tasks in any note.' : 'No open tasks.'
      empty.hidden = false
      return
    }

    empty.hidden = true
    for (const found of rows) list.append(row(found))
  }

  const scan = async (options) => {
    const mine = ++scanNumber
    const entries = await listDocuments()
    if (mine !== scanNumber) return
    const rows = []
    for (const entry of entries) {
      for (const task of tasksIn(entry.text || '')) {
        if (task.done && !options.done) continue
        rows.push({entry, task, done: task.done})
      }
    }
    if (mine !== scanNumber) return
    render(rows, options.done)
  }

  /**
   * Answer the panel with the whole library, if it is showing.
   *
   * Every answer can move: a save ticks a box, the trash gives a note back,
   * the folder brings one in. The app says when to look again.
   *
   * @param {{done?: boolean}} [options] whether to list the ticked tasks too
   */
  const update = (options = {}) => {
    if (element.hidden) return
    void scan({done: Boolean(options.done)})
  }

  return {
    element,

    open(options = {}) {
      element.hidden = false
      // Opening is a fresh question, whatever the last answer was.
      update(options)
    },

    close() {
      element.hidden = true
    },

    toggle(options = {}) {
      if (element.hidden) this.open(options)
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
