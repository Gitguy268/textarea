// The document library panel: every note this browser has held.
//
// The list is rebuilt from IndexedDB each time the panel opens rather than kept
// in memory, because the notes in it are written by the autosave in the
// background while it is shut, and a stale list is worse than a slow one.
//
// There is no rename control, and that is a decision rather than an omission. A
// note's title is its first level one heading, everywhere else in the app: it is
// what names the tab and what the exported file is called. A separate stored
// title would be a second name for the same document that could disagree with the
// first, so the panel says how to rename instead.

import {icon} from './dialog.js'
import {
  deleteDocument,
  deleteForever,
  emptyTrash,
  listDocuments,
  listTrash,
  moveToTrash,
  purgeTrash,
  restoreFromTrash,
} from './library.js'

/**
 * Show the library.
 *
 * @param {object} options
 * @param {string} [options.activeId]  the note currently open, marked in the list
 * @param {(entry: object) => void} options.onOpen
 * @param {() => void} [options.onNew]  a "New note" action for the empty list
 * @param {(id: string) => void} [options.onDelete]  after a note is gone, for
 *   the folder mirror, which owns the file half of the deletion
 * @param {boolean} [options.trash]  delete through the trash rather than for
 *   good; the reader's switch, read when the panel opens
 * @param {(message: string, isError?: boolean) => void} [options.notify]
 * @returns {Promise<void>}
 */
export async function showDocumentsPanel({activeId, onOpen, onNew, onDelete, trash = false, notify} = {}) {
  const say = notify ?? (() => {})

  const dialog = document.createElement('dialog')
  dialog.className = 'dialog dialog-library'
  dialog.setAttribute('aria-label', 'My documents')

  const form = document.createElement('form')
  form.method = 'dialog'
  form.className = 'dialog-form'

  const heading = document.createElement('h2')
  heading.className = 'dialog-title'
  heading.textContent = 'My documents'
  form.append(heading)

  const description = document.createElement('p')
  description.className = 'dialog-description'
  description.textContent =
    'Every note you have written in this browser, newest first. Nothing leaves this device. ' +
    'Pick a card to open it; a note is named by its first # heading.'
  form.append(description)

  const error = document.createElement('p')
  error.className = 'dialog-error'
  error.setAttribute('role', 'alert')
  error.hidden = true
  form.append(error)

  const search = document.createElement('input')
  search.type = 'search'
  search.className = 'dialog-search'
  search.placeholder = 'Search titles and text'
  search.setAttribute('aria-label', 'Search documents')
  search.spellcheck = false
  form.append(search)

  const list = document.createElement('ul')
  list.className = 'document-list'
  form.append(list)

  const actions = document.createElement('div')
  actions.className = 'dialog-actions'

  const newNote = document.createElement('button')
  newNote.type = 'button'
  newNote.className = 'dialog-button'
  newNote.textContent = 'New note'
  newNote.addEventListener('click', () => {
    close()
    onNew?.()
  })

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'dialog-button dialog-button-primary'
  closeButton.textContent = 'Close'

  actions.append(newNote, closeButton)
  form.append(actions)
  dialog.append(form)

  const showError = (message) => {
    error.textContent = message
    error.hidden = false
  }

  const close = () => {
    dialog.close()
    dialog.remove()
  }

  /**
   * Reading the library is asynchronous, so two renders can be in flight at once
   * while someone types in the search box. Each render takes a number, and only
   * the newest one is allowed to write to the list, or a slow earlier read lands
   * last and shows the results for a search that has already moved on.
   */
  let renderNumber = 0

  function render() {
    const mine = ++renderNumber
    list.replaceChildren()

    listDocuments().then((entries) => {
      if (mine !== renderNumber) return

      const needle = search.value.trim().toLowerCase()
      const matches = needle
        ? entries.filter(
            (entry) =>
              entry.title.toLowerCase().includes(needle) || entry.text.toLowerCase().includes(needle),
          )
        : entries

      search.disabled = entries.length === 0
      list.replaceChildren()

      if (!entries.length) {
        list.append(emptyRow('No notes yet.', 'Everything you write is kept here as you type.'))
        return
      }

      if (!matches.length) {
        list.append(emptyRow('Nothing matches that search.', null))
        return
      }

      for (const entry of matches) list.append(renderRow(entry))
    })
  }

  search.addEventListener('input', render)

  /** One card: the whole card opens the note, and the corner button forgets it. */
  function renderRow(entry) {
    const row = document.createElement('li')
    row.className = 'document-row'
    if (entry.id === activeId) row.dataset.current = 'true'

    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'document-open'

    const title = document.createElement('span')
    title.className = 'document-title'
    title.textContent = entry.title || 'Untitled note'

    const preview = document.createElement('span')
    preview.className = 'document-preview'
    preview.textContent = previewOf(entry.text)

    // Only the date is printed on the card. The word count stays out of it for
    // the same reason, and lives in the description below instead: a card
    // has to be scannable, and a second line of numbers is what stops it
    // being one.
    const meta = document.createElement('span')
    meta.className = 'document-meta'
    meta.textContent = formatWhen(entry.updated)

    // The name is the verb and then the card's own text, so what a
    // voice-control user reads off the screen is in what the button answers
    // to (WCAG 2.5.3); the word count the card has no room for rides along
    // as the description.
    open.append(srOnly('Open '), title, preview, meta)
    open.setAttribute('aria-description', `${entry.words} words`)
    open.addEventListener('click', () => {
      close()
      onOpen?.(entry)
    })

    const forget = document.createElement('button')
    forget.type = 'button'
    forget.className = 'document-delete'
    forget.setAttribute('aria-label', `Delete ${entry.title || 'Untitled note'}`)
    forget.append(icon('icon-delete', 18))
    forget.addEventListener('click', async () => {
      // Ask before deleting. The note is still in the URL, so it is not gone the
      // moment the row disappears, but after closing the tab it would be.
      const confirmed = await confirmInPanel(
        dialog,
        `Delete “${entry.title || 'Untitled note'}”?`,
        trash
          ? 'The note will wait in the trash, where it can be put back, until its keep days are up.'
          : 'The note is removed from this browser. If its link is still in the address bar it can be reopened from there.',
      )
      if (!confirmed) return
      forget.disabled = true
      const removed = trash ? await moveToTrash(entry.id) : await deleteDocument(entry.id)
      if (!removed) {
        forget.disabled = false
        showError('That note could not be deleted.')
        return
      }
      row.remove()
      if (!list.children.length) render()
      // The file half of a mirrored note goes with it. After the row is gone,
      // so a failure there cannot bring the note back into the panel.
      onDelete?.(entry.id)
      say(trash ? `Moved ${entry.title || 'the note'} to the trash` : `Deleted ${entry.title || 'the note'}`)
    })

    row.append(open, forget)
    return row
  }

  closeButton.addEventListener('click', close)
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    close()
  })
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close()
  })

  document.body.append(dialog)
  dialog.showModal()
  render()
  search.focus()
}

/**
 * Show the trash: the notes that were deleted, newest first, each with the
 * days it has left - and the two ways out, put the note back or take it for
 * good. The purge runs on the way in: the trash is read nowhere else, so this
 * is all the housekeeping it needs.
 *
 * @param {object} options
 * @param {number} [options.keepDays]  how long a note earns in the trash
 * @param {() => void} [options.onRestore]  after a note is back in the
 *   library, for the folder mirror and the backlinks, which both just gained
 * @param {(message: string, isError?: boolean) => void} [options.notify]
 * @returns {Promise<void>}
 */
export async function showTrashPanel({keepDays = 30, onRestore, notify} = {}) {
  const say = notify ?? (() => {})

  const dialog = document.createElement('dialog')
  dialog.className = 'dialog dialog-library'
  dialog.setAttribute('aria-label', 'Trash')

  const form = document.createElement('form')
  form.method = 'dialog'
  form.className = 'dialog-form'

  const heading = document.createElement('h2')
  heading.className = 'dialog-title'
  heading.textContent = 'Trash'

  const description = document.createElement('p')
  description.className = 'dialog-description'
  description.textContent =
    'Notes you deleted from My documents, newest first. Each waits here for its keep days - set in ' +
    'Settings - and is then gone for good. Pick a card to put a note back.'

  const error = document.createElement('p')
  error.className = 'dialog-error'
  error.setAttribute('role', 'alert')
  error.hidden = true

  const list = document.createElement('ul')
  list.className = 'document-list'

  const actions = document.createElement('div')
  actions.className = 'dialog-actions'

  const empty = document.createElement('button')
  empty.type = 'button'
  empty.className = 'dialog-button'
  empty.textContent = 'Empty trash'
  empty.disabled = true
  empty.addEventListener('click', async () => {
    const confirmed = await confirmInPanel(
      dialog,
      'Empty the trash?',
      'Every note in it is removed from this browser for good. This cannot be undone.',
    )
    if (!confirmed) return
    const cleared = await emptyTrash()
    if (!cleared) {
      showError('The trash could not be emptied.')
      return
    }
    await render()
    say('The trash is empty')
  })

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'dialog-button dialog-button-primary'
  closeButton.textContent = 'Close'

  actions.append(empty, closeButton)
  form.append(heading, description, error, list, actions)
  dialog.append(form)

  const showError = (message) => {
    error.textContent = message
    error.hidden = false
  }

  const close = () => {
    dialog.close()
    dialog.remove()
  }

  /** One card: the whole card puts the note back, the corner button forgets it. */
  function renderRow(entry) {
    const row = document.createElement('li')
    row.className = 'document-row'

    const restore = document.createElement('button')
    restore.type = 'button'
    restore.className = 'document-open'

    const title = document.createElement('span')
    title.className = 'document-title'
    title.textContent = entry.title || 'Untitled note'

    const preview = document.createElement('span')
    preview.className = 'document-preview'
    preview.textContent = previewOf(entry.text)

    const meta = document.createElement('span')
    meta.className = 'document-meta'
    meta.textContent = `deleted ${formatWhen(entry.deletedAt)}`

    restore.append(srOnly('Restore '), title, preview, meta)
    restore.addEventListener('click', async () => {
      const putBack = await restoreFromTrash(entry.id)
      if (!putBack) {
        showError('That note could not be put back.')
        return
      }
      row.remove()
      if (!list.children.length) render()
      onRestore?.()
      say(`Restored ${entry.title || 'Untitled note'}`)
    })

    const forever = document.createElement('button')
    forever.type = 'button'
    forever.className = 'document-delete'
    forever.setAttribute('aria-label', `Delete ${entry.title || 'Untitled note'} for good`)
    forever.append(icon('icon-delete', 18))
    forever.addEventListener('click', async () => {
      const confirmed = await confirmInPanel(
        dialog,
        `Delete “${entry.title || 'Untitled note'}” for good?`,
        'The note is removed from this browser for good. This cannot be undone.',
      )
      if (!confirmed) return
      forever.disabled = true
      const gone = await deleteForever(entry.id)
      if (!gone) {
        forever.disabled = false
        showError('That note could not be deleted.')
        return
      }
      row.remove()
      if (!list.children.length) render()
      say(`Deleted ${entry.title || 'the note'} for good`)
    })

    row.append(restore, forever)
    return row
  }

  async function render() {
    await purgeTrash(keepDays * 86_400_000)
    const entries = await listTrash()
    list.replaceChildren()
    empty.disabled = entries.length === 0
    if (!entries.length) {
      list.append(emptyRow('The trash is empty.', 'Notes wait here until their keep days are up.'))
      return
    }
    for (const entry of entries) list.append(renderRow(entry))
  }

  closeButton.addEventListener('click', close)
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    close()
  })
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close()
  })

  document.body.append(dialog)
  dialog.showModal()
  await render()
}

/** A row with no actions, for the empty and no-match states. */
function emptyRow(title, detail) {
  const row = document.createElement('li')
  row.className = 'document-row document-row-empty'
  const label = document.createElement('p')
  label.className = 'document-title'
  label.textContent = title
  row.append(label)
  if (detail) {
    const hint = document.createElement('p')
    hint.className = 'document-meta'
    hint.textContent = detail
    row.append(hint)
  }
  return row
}

/** The first line or two of a note, flattened so a card can show a little of it. */
/** A word for the accessible name that the card itself has no room for. */
function srOnly(text) {
  const span = document.createElement('span')
  span.className = 'sr-only'
  span.textContent = text
  return span
}

function previewOf(text) {
  // The level one heading is dropped rather than flattened into the preview:
  // it is the title already printed on the card, and repeating it is the one
  // thing a preview should not do.
  const flat = String(text ?? '')
    .replace(/^(?:[ \t]*\n)*[ \t]*#[ \t]+[^\n]*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > 110 ? flat.slice(0, 110).trimEnd() + '…' : flat || 'Empty note'
}

/**
 * A yes/no question on top of an open panel.
 *
 * `showDialog` cannot stack on top of another modal dialog, so this is a
 * `<dialog>` opened while the first one is still up: nested modals are allowed
 * and the topmost one owns Escape.
 *
 * @param {HTMLElement} parent  the panel the question sits on
 * @param {string} message  the question itself
 * @param {string} detail  what a yes actually does - it differs between a
 *   note that waits in the trash and one gone for good
 */
function confirmInPanel(parent, message, detail) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.className = 'dialog dialog-confirm'

    const form = document.createElement('form')
    form.method = 'dialog'
    form.className = 'dialog-form'

    const heading = document.createElement('h2')
    heading.className = 'dialog-title'
    heading.textContent = message

    const description = document.createElement('p')
    description.className = 'dialog-description'
    description.textContent = detail

    const actions = document.createElement('div')
    actions.className = 'dialog-actions'

    const no = document.createElement('button')
    no.type = 'button'
    no.className = 'dialog-button'
    no.textContent = 'Cancel'

    const yes = document.createElement('button')
    yes.type = 'button'
    yes.className = 'dialog-button dialog-button-danger'
    yes.textContent = 'Delete'

    actions.append(no, yes)
    form.append(heading, description, actions)
    dialog.append(form)

    const finish = (value) => {
      dialog.close()
      dialog.remove()
      resolve(value)
    }

    no.addEventListener('click', () => finish(false))
    yes.addEventListener('click', () => finish(true))
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(false)
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false)
    })

    parent.append(dialog)
    dialog.showModal()
    yes.focus()
  })
}

const RELATIVE = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86_400, 3600, 'hour'],
  [604_800, 86_400, 'day'],
]

/**
 * "3 hours ago", "yesterday", or a date once it stops being news.
 *
 * `Intl.RelativeTimeFormat` handles the grammar, so a translated browser says
 * "vor 3 Stunden" rather than the English string this would otherwise produce.
 */
function formatWhen(timestamp) {
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const magnitude = Math.abs(seconds)

  if (magnitude < 45) return 'just now'

  for (const [limit, divisor, unit] of RELATIVE) {
    if (magnitude < limit) {
      const value = Math.round(seconds / divisor)
      if (typeof Intl?.RelativeTimeFormat === 'function') {
        return new Intl.RelativeTimeFormat(undefined, {numeric: 'auto'}).format(value, unit)
      }
      return unit === 'day' && Math.abs(value) === 1 ? 'yesterday' : `${Math.abs(value)} ${unit}s ago`
    }
  }

  return new Date(timestamp).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'})
}
