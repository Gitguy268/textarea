// The quick switcher.
//
// A palette over the note, summoned from its shortcut: type a few letters,
// arrow through what matches, Enter to open. It is the keyboard-first face
// of the search the documents panel already offers - the same library, read
// through filterNotes() below - so a reader who lives on the keyboard never
// opens that panel at all, and a reader who does not want the shortcut never
// has it: Settings > Quick switcher switches the whole thing off, and its
// two choices are the width of the search (titles, which is what jumping
// wants, or titles and text the way the documents panel searches) and which
// Ctrl/Cmd chord carries it.
//
// filterNotes() is pure in the shape lib/stats.js and lib/backlinks.js are
// pure: entries and a query in, ranked matches out, no document and no
// storage - which is how the ranking is unit tested without a browser. The
// rest is the modal: a native <dialog>, so Escape, the backdrop and focus
// handling are the browser's job rather than ours.

import {listDocuments} from './library.js'

/**
 * The notes a query matches, best first.
 *
 * A title match always outranks a text match, because a palette that lists
 * a passing mention above the note actually named by the query feels broken
 * no matter how the ranking is justified. A text match carries the line it
 * was found on so the reader can see why it is in the list at all; a title
 * match needs no reason.
 *
 * @param {Array<{title?: string, text?: string}>} entries the library
 * @param {string} query what the reader typed
 * @param {'titles' | 'all'} [scope] 'titles' matches titles only; 'all'
 *   searches the text as well
 * @returns {Array<{entry: object, hint: string}>}
 */
export function filterNotes(entries, query, scope = 'titles') {
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle) return entries.map((entry) => ({entry, hint: ''}))

  const titled = []
  const mentioned = []
  for (const entry of entries) {
    if (String(entry.title ?? '').toLowerCase().includes(needle)) {
      titled.push({entry, hint: ''})
    } else if (
      scope === 'all' &&
      String(entry.text ?? '')
        .toLowerCase()
        .includes(needle)
    ) {
      mentioned.push({entry, hint: matchingLine(entry.text, needle)})
    }
  }
  return [...titled, ...mentioned]
}

/**
 * The first line of `text` that says `needle`, flattened to one line.
 *
 * The palette's list is one row per note, and a paragraph that runs the
 * width of the screen would wrap the row into unreadability - so the line
 * collapses its whitespace and is cut where it gets long, the same bargain
 * the backlinks panel makes with its snippets.
 *
 * @param {string} text
 * @param {string} needle already lower case
 * @returns {string} the line, or '' when no single line says it
 */
function matchingLine(text, needle) {
  const line = String(text ?? '')
    .split('\n')
    .find((candidate) => candidate.toLowerCase().includes(needle))
  if (!line) return ''
  const flat = line.replace(/\s+/g, ' ').trim()
  return flat.length > 120 ? flat.slice(0, 119) + '…' : flat
}

/**
 * Build the palette and return the handful of methods the app needs.
 *
 * Built once and reused - the shortcut can be pressed dozens of times an
 * hour - with the library re-read on every open, so a note written a second
 * ago is already in the list.
 *
 * @param {object} [options]
 * @param {(entry: object) => void} [options.onOpen] called with the library
 *   entry the reader picked
 * @param {Document} [options.owner]
 * @returns {{element: HTMLElement, open: (options?: {scope?: string}) => void,
 *   close: () => void, isOpen: () => boolean}}
 */
export function createSwitcher({onOpen, owner = document, list: read = listDocuments, words = {}} = {}) {
  // The command palette is this same component over a different list, so
  // what the list is read from and what the palette calls itself are the
  // caller's to say; left alone, it is the note switcher it always was.
  const say = {
    id: 'switcher',
    label: 'Quick switcher',
    placeholder: 'Jump to a note…',
    filter: 'Filter notes',
    matches: 'Matching notes',
    empty: 'No note matches.',
    help: 'Arrow keys move, Enter opens, Escape closes.',
    ...words,
  }
  const dialog = owner.createElement('dialog')
  dialog.className = 'dialog dialog-switcher'
  dialog.setAttribute('aria-label', say.label)

  const body = owner.createElement('div')
  body.className = 'switcher-body'

  const input = owner.createElement('input')
  input.type = 'search'
  input.className = 'switcher-input'
  input.placeholder = say.placeholder
  input.setAttribute('aria-label', say.filter)
  input.setAttribute('aria-controls', `${say.id}-list`)
  input.setAttribute('aria-autocomplete', 'list')
  input.spellcheck = false

  const list = owner.createElement('ul')
  list.className = 'switcher-list'
  list.id = `${say.id}-list`
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', say.matches)
  // A long list scrolls, and a region that scrolls has to be reachable from
  // the keyboard on its own (WCAG 2.1.1): Tab lands here and the arrow keys
  // scroll it, beside the box's own arrows that move the selection.
  list.tabIndex = 0

  const empty = owner.createElement('p')
  empty.className = 'switcher-empty'
  empty.textContent = say.empty
  empty.hidden = true

  const help = owner.createElement('p')
  help.className = 'dialog-hint'
  help.textContent = say.help

  body.append(input, list, empty, help)
  dialog.append(body)

  /** The library as it stood when the palette opened. */
  let entries = []
  /** What the query keeps, as {entry, hint}. */
  let matches = []
  /** The row the arrow keys are on. */
  let active = 0
  /** How wide the search runs, chosen in settings and read at open. */
  let scope = 'titles'
  /**
   * True once the library read lands: until then a short list means "still
   * reading", not "nothing matches", and the empty state stays quiet.
   */
  let loaded = false
  /**
   * Reads take numbers, the way the documents panel numbers its renders:
   * each open reads the library again, and a read from an open that has
   * since been left behind must not write itself into this one's list.
   */
  let readNumber = 0

  const close = () => dialog.close()

  const pick = (entry) => {
    close()
    onOpen?.(entry)
  }

  const applyActive = () => {
    const rows = list.querySelectorAll('[role="option"]')
    rows.forEach((row, index) => {
      row.setAttribute('aria-selected', String(index === active))
    })
    const chosen = rows[active]
    if (chosen) input.setAttribute('aria-activedescendant', chosen.id)
    else input.removeAttribute('aria-activedescendant')
    chosen?.scrollIntoView({block: 'nearest'})
  }

  const render = () => {
    list.replaceChildren()
    matches.forEach((match, index) => {
      const row = owner.createElement('li')
      row.className = 'switcher-item'
      row.setAttribute('role', 'option')
      row.id = `${say.id}-option-${index}`
      row.setAttribute('aria-selected', String(index === active))

      const name = owner.createElement('span')
      name.className = 'switcher-name'
      name.textContent = match.entry.title || 'Untitled'
      row.append(name)

      if (match.hint) {
        const hint = owner.createElement('span')
        hint.className = 'switcher-hint'
        hint.textContent = match.hint
        row.append(hint)
      }

      row.addEventListener('click', () => pick(match.entry))
      list.append(row)
    })
    // Shown only once the library has answered and still nothing matches:
    // before the read lands an empty list means "reading", not "no match".
    empty.hidden = !loaded || matches.length > 0
    applyActive()
  }

  const filter = () => {
    matches = filterNotes(entries, input.value, scope)
    active = 0
    render()
  }

  input.addEventListener('input', filter)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // A search box eats Escape to clear itself before the dialog ever
      // sees the key, which would leave the palette open behind an emptied
      // query - so the close it promised is handled here, where the key
      // lands, and the browser's default is stood down for both.
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!matches.length) return
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      active = Math.min(Math.max(active + step, 0), matches.length - 1)
      applyActive()
      return
    }
    if (event.key === 'Enter') {
      const match = matches[active]
      if (!match) return
      event.preventDefault()
      pick(match.entry)
    }
  })

  // The backdrop is the dialog element itself, the way the documents panel
  // closes: a click that did not land on the card's contents dismisses it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close()
  })

  // And Escape from anywhere else in the card closes it the same way -
  // focus can sit on the dialog itself after a click on its padding.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    close()
  })

  return {
    element: dialog,

    open(options = {}) {
      scope = options.scope === 'all' ? 'all' : 'titles'
      input.value = ''
      active = 0
      matches = []
      loaded = false
      render()
      if (!dialog.open) dialog.showModal()
      input.focus()

      const mine = ++readNumber
      void Promise.resolve(read()).then((all) => {
        if (mine !== readNumber) return
        entries = all
        loaded = true
        // The reader may have typed while this read was in flight, so the
        // list is filtered from the box's contents rather than the query
        // that was current when the read began.
        filter()
      })
    },

    close,

    isOpen() {
      return dialog.open
    },
  }
}
