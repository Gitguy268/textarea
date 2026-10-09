// Application bootstrap: the editor, the URL hash, the menu and the new file
// features.
//
// The upstream project kept all of this inline in index.html. It is a module now
// so that the file operations can live in lib/ and be imported, which a classic
// inline script cannot do.

import {applyAppearance, isCustomFont, readAppearance} from './lib/appearance.js'
import {confirmDialog, promptPassword} from './lib/dialog.js'
import {copyText} from './lib/clipboard.js'
import {readNote} from './lib/export.js'
import {
  connectFolder,
  connectToDirectory,
  disconnectFolder,
  folderSyncAvailable,
  folderSyncStatus,
  noteDeleted,
  reconnectFolder,
  restoreFolder,
  scheduleSync,
  setFolderSyncApply,
  setFolderSyncNotice,
  syncNow,
} from './lib/folder-sync.js'
import {titleOf} from './lib/front-matter.js'
import {glassAvailable, glassEnabled, setGlassEnabled, trackGlass} from './lib/glass.js'
import {activeDocumentId, getDocument, isAvailable as libraryAvailable, listDocuments, newId, putDocument, setActiveDocumentId} from './lib/library.js'
import {fileLink, parseMarkdown} from './lib/markdown.js'
import {extensionOf, readFile} from './lib/open.js'
import {PdfPasswordError} from './lib/pdf.js'
import {createStatsPanel} from './lib/stats-panel.js'
import {countStats} from './lib/stats.js'
import {sanitizeStyle} from './lib/style.js'
import {nextTheme, readTheme, withTheme} from './lib/theme.js'
import {
  DecryptError,
  decodeHash,
  decryptHash,
  encodeHash,
  encryptHash,
  ENCRYPTED_PREFIX,
  isEncryptedHash,
  isHashTooLong,
  joinContent,
  splitContent,
} from './lib/share.js'

const TWO_COLUMNS_KEY = 'textarea:two-columns'
const STATS_KEY = 'textarea:stats'
const FILE_LINKS_KEY = 'textarea:file-links'
const WIKILINKS_KEY = 'textarea:wikilinks'
const WIKILINK_CREATE_KEY = 'textarea:wikilink-create'
const BACKLINKS_KEY = 'textarea:backlinks'
const BACKLINK_MENTIONS_KEY = 'textarea:backlink-mentions'
const SWITCHER_KEY = 'textarea:switcher'
const SWITCHER_SCOPE_KEY = 'textarea:switcher-scope'
const SWITCHER_SHORTCUT_KEY = 'textarea:switcher-shortcut'
const FIND_KEY = 'textarea:find'
const FIND_CASE_KEY = 'textarea:find-case'
const FIND_WORDS_KEY = 'textarea:find-words'
const BACKUP_KEY = 'textarea:backup'
const BACKUP_METADATA_KEY = 'textarea:backup-metadata'
const BACKUP_ENCRYPT_KEY = 'textarea:backup-encrypt'
const TRASH_KEY = 'textarea:trash'
const TRASH_KEEP_KEY = 'textarea:trash-keep'
const TASKS_KEY = 'textarea:tasks'
const TASKS_DONE_KEY = 'textarea:tasks-done'

const article = document.querySelector('article')
const menu = document.querySelector('#menu')
const button = document.querySelector('#button')
const notification = document.querySelector('#notification')
const dropOverlay = document.querySelector('#drop-overlay')
const fileInput = document.querySelector('#file-input')

/** Whether the current URL hash holds an encrypted snapshot of the note. */
const state = {encrypted: false}

// The file-link switch is read here rather than cached: the highlighter runs
// often enough that a getter is cheaper than keeping a copy in sync, and a
// toggle that re-reads on the next keystroke is what makes the switch honest.
const editor = new Editor(article, (element) =>
  parseMarkdown(element, {
    fileLinks: fileLinksEnabled(),
    wikilinks: wikilinksEnabled(),
    tasks: tasksEnabled(),
  }),
)

const statsPanel = createStatsPanel()
document.body.append(statsPanel.element)

/**
 * The backlinks panel, built the first time anything asks for it.
 *
 * The feature ships off, so a reader who never opens the panel never pays
 * for the module that draws it: the import lives in ensureBacklinksPanel()
 * below, and the startup guard says the file is not part of the boot.
 */
let backlinksPanel = null

/** The tasks panel, built the first time the menu row asks for it. */
let tasksPanel = null

/**
 * The quick switcher, built the first time its shortcut is pressed.
 *
 * The feature is on by default, so the listener that answers its chord is
 * part of the boot - but the palette is not: the import lives in
 * openSwitcher() below, and the startup guard says the module is not part
 * of the boot all the same.
 */
let switcher = null

/**
 * The find bar, built the first time its chord is pressed.
 *
 * Same bargain as the switcher: on by default, so the listener that
 * answers Ctrl/Cmd+F is part of the boot - but the bar is not, and the
 * startup guard says its module is no part of the boot all the same.
 */
let find = null

/* --------------------------------------------------------------- the title */

function updateTitle() {
  // Only a level one heading on the first non-blank line names the document.
  // The old pattern required a trailing newline, so a note consisting of just
  // "# Title" lost its title, and it captured the space after the hash, so the
  // tab read " Title". Upstream issue #26. Leading blank lines are skipped, as
  // before, but "#Title" without a space and "## Sub" are not headings here:
  // only a level one heading names the tab. The rule lives in titleOf() so a
  // note imported from a folder gets the name this tab would give it.
  document.title = titleOf(article.textContent)
}

/* --------------------------------------------------------------- the hash */

/** The note as the codec sees it: the text, and the author's inline style. */
function currentContent() {
  return joinContent(article.textContent, article.getAttribute('style'))
}

/** Put a decoded note into the editor without pushing it onto the undo stack. */
function applyContent(content) {
  const {text, style} = splitContent(content)
  editor.set(text)
  // The style half of a shared link is whoever sent the link, not the reader,
  // so it goes through the allowlist before it becomes an attribute.
  const safe = sanitizeStyle(style)
  if (safe) article.setAttribute('style', safe)
  else article.removeAttribute('style')
}

/**
 * Push the note into the URL, and into the document library.
 *
 * While an encrypted snapshot is in the hash the plaintext must never reach it
 * again: autosave stops, and the link stays exactly what was shared. Reloading
 * then asks for the password again, which is the point. The library is separate
 * from the hash and keeps writing while encrypted, or turning on the encryption
 * would silently stop the backup.
 */
async function save() {
  if (!state.encrypted) {
    // The '#' is part of the URL, not of the payload the codec returns.
    const hash = '#' + (await encodeHash(currentContent()))
    if (location.hash !== hash) history.replaceState({}, '', hash)
    if (isHashTooLong(hash) && !save.warnedLong) {
      save.warnedLong = true
      notify(
        'This note is now large, and some browsers and servers will refuse a URL this long. ' +
          'Save it to a file instead.',
        {error: true, duration: 6000},
      )
    }
  }
  await saveToLibrary()
  // The folder is the library's mirror, so a note that reached the library
  // earns a file a moment later, on the same pause.
  scheduleSync()
  updateTitle()
  statsPanel.update(article.textContent)
  updateBacklinks()
  // The tasks panel answers for every note in the library, and a save is
  // how a checkbox click reaches it - pushed the news like the rest.
  updateTasks()
  // The writing tools' Run button is the one state here that changes with
  // the text itself - empty note, nothing to run - so the panel is pushed
  // the news the same way the statistics panel is.
  writingPanel?.refresh()
}

/**
 * The library row this tab is editing, or null before a note has been claimed.
 *
 * Held in memory because localStorage belongs to the origin, not to the tab: two
 * tabs of the same note would otherwise fight over one row, with the second to
 * write silently taking the first tab's note over.
 */
let currentDocumentId = null

function documentId() {
  if (currentDocumentId === null) currentDocumentId = activeDocumentId()
  return currentDocumentId
}

/** Point this tab at a different row. */
function setDocumentId(id) {
  currentDocumentId = id
  setActiveDocumentId(id)
  return id
}

/**
 * Write the note into IndexedDB as the document being edited.
 *
 * One note is one library entry, and which one is held in memory rather than
 * derived from the note. See claimDocumentForHash() for why.
 *
 * Storage that is unavailable or full must never interrupt typing, so a failure
 * here is swallowed. The worst case is that the library is behind.
 */
async function saveToLibrary() {
  if (!libraryAvailable()) return

  let id = documentId()
  if (!id) id = setDocumentId(newId())

  await putDocument({
    id,
    title: document.title,
    text: article.textContent,
    style: article.getAttribute('style'),
    // Without the '#', to match what claimDocumentForHash() compares against.
    // It is the same value the hash codec produces and the same one load() reads.
    hash: location.hash.slice(1),
    words: countStats(article.textContent).words,
  })
}

/**
 * Open a note from the library.
 *
 * The hash is rewritten as well as the editor, so the note is shareable again
 * straight away. Replacing the whole document rather than setting the hash is
 * what keeps the back button meaningful and lands the caret at the end of the
 * text, the same as opening a file.
 */
async function openDocument(entry) {
  if (!entry) return

  const ok = await confirmReplace(entry.title)
  if (!ok) return

  setDocumentId(entry.id)
  editor.replace(entry.text)
  // A library row can hold a style that arrived through a shared link, so the
  // same allowlist applies here as in applyContent().
  const safe = sanitizeStyle(entry.style)
  if (safe) article.setAttribute('style', safe)
  else article.removeAttribute('style')

  save.warnedLong = false
  await save()
  updateMenuState()
  notify(`Opened ${entry.title}`)
}

/** A new, empty note with its own library entry. */
async function newDocument() {
  if (article.textContent.trim() !== '') {
    const ok = await confirmDialog({
      title: 'Start a new note?',
      message:
        'What is in the editor now stays in your documents and can be reopened. This note becomes empty.',
      submitLabel: 'New note',
    })
    if (!ok) return
  }

  // A fresh row, or the next keystroke would write the empty note over the one
  // just left behind.
  setDocumentId(newId())
  editor.replace('')
  article.removeAttribute('style')
  save.warnedLong = false
  await save()
  statsPanel.update('')
  updateBacklinks('')
  writingPanel?.refresh()
  notify('New note')
}

/** @returns {Promise<boolean>} false when the reader changed their mind */
async function confirmReplace(what) {
  if (article.textContent.trim() === '') return true
  const ok = await confirmDialog({
    title: 'Replace the current note?',
    message: `Opening ${what} replaces what is in the editor. It can be undone.`,
    submitLabel: 'Open',
  })
  return ok
}

/**
 * Read the URL hash into the editor.
 *
 * An encrypted hash prompts for its password. A wrong one is worth another try
 * rather than a dead end, since a mistyped password is the common case.
 */
async function load() {
  const hash = location.hash.slice(1)

  await claimDocumentForHash(hash)

  if (hash === '') {
    state.encrypted = false
    updateTitle()
    statsPanel.update(article.textContent)
    updateBacklinks()
    writingPanel?.refresh()
    return
  }

  // The menu's "New" link points at #new so it opens a tab with no JavaScript
  // involved. It is not a note, so it opens an empty one. Upstream fed it to the
  // decoder instead, where it failed and the failure path cleared the editor by
  // accident: the same path a genuinely corrupt link takes, and it left the
  // hash sitting at #new. Upstream issue #37.
  if (hash === 'new') {
    state.encrypted = false
    applyContent('')
    updateTitle()
    statsPanel.update('')
    updateBacklinks('')
    writingPanel?.refresh()
    return
  }

  try {
    if (isEncryptedHash(hash)) {
      state.encrypted = true
      const content = await unlock(hash)
      if (content !== null) applyContent(content)
      updateMenuState()
    } else {
      state.encrypted = false
      applyContent(await decodeHash(hash))
      updateTitle()
    }
    // The note is on screen, so it belongs in the library even if nobody types
    // a character: a link opened and closed is exactly the note that had no
    // other copy.
    await saveToLibrary()
    statsPanel.update(article.textContent)
    updateBacklinks()
    updateTasks()
    writingPanel?.refresh()
  } catch (error) {
    if (error instanceof DecryptError) {
      article.textContent = ''
      article.removeAttribute('style')
      notify('This link could not be opened: ' + error.message, {error: true, duration: 5000})
    } else {
      article.textContent = ''
      article.removeAttribute('style')
    }
  }
}

/**
 * Decide which library row the note in the address bar belongs to.
 *
 * The rule is one row per note, not one row per hash: the hash is rewritten on
 * every keystroke, so it cannot be the identity, and matching rows on it would
 * make every character create a note. Instead the id is held in memory and
 * written through to localStorage, and it is only replaced when the address bar
 * genuinely holds a *different* note than the row in hand.
 *
 * The check is one primary-key read rather than a scan of the library, and it is
 * skipped entirely when there is nothing to compare against.
 *
 * Holding the id in memory rather than reading localStorage on every autosave is
 * also what keeps two tabs apart: localStorage is shared, so the second tab to
 * write would otherwise take over the first tab's note.
 */
async function claimDocumentForHash(hash) {
  if (!libraryAvailable()) return

  const wanted = hash === '' || hash === 'new' ? '' : hash
  const id = documentId()

  // Nothing in hand, or a first visit: start a row.
  if (!id) {
    setDocumentId(newId())
    return
  }

  const held = await getDocument(id)

  // The row in hand already holds this note, so this is a reload of the same
  // note or a return to the same link, and it stays where it is.
  if (held && held.hash === wanted) return

  // No row, or a row holding something else: this is a different note.
  setDocumentId(newId())
}

/** Prompt for the password of an encrypted hash. Returns null when cancelled. */
async function unlock(hash) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const password = await promptPassword({
      title: 'This note is encrypted',
      message: 'Enter the password this link was created with.',
      submitLabel: 'Unlock',
    })
    if (password === null) {
      notify('Unlock cancelled')
      return null
    }
    try {
      return await decryptHash(hash.slice(ENCRYPTED_PREFIX.length), password)
    } catch {
      notify('Wrong password', {error: true})
    }
  }
  return null
}

/* ---------------------------------------------------------------- the theme */

/** The chrome colour an installed app shows, per theme. */
const THEME_COLORS = {light: '#ffffff', dark: '#000000'}

/**
 * Apply a theme and tell the menu about it.
 *
 * The theme-colour meta tags are scoped to the system preference, so an explicit
 * choice has to take the media off them, or an installed app keeps its title bar
 * in the colour the system wanted rather than the one that was asked for.
 */
function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme

  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    if (theme === 'system') {
      meta.setAttribute('media', meta.dataset.systemMedia ?? '')
      meta.setAttribute('content', THEME_COLORS[meta.dataset.systemScheme ?? 'light'])
    } else {
      meta.removeAttribute('media')
      meta.setAttribute('content', THEME_COLORS[theme])
    }
  }

  updateMenuState()
}

function initTheme() {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.dataset.systemMedia = meta.getAttribute('media') ?? ''
    const scheme = meta.getAttribute('media')?.includes('dark') ? 'dark' : 'light'
    meta.dataset.systemScheme = scheme
  }

  applyTheme(readTheme(location.search))

  onMenu('theme', () => {
    const theme = nextTheme(readTheme(location.search))
    // The note in the hash has to survive this untouched.
    history.replaceState({}, '', withTheme(location.href, theme))
    applyTheme(theme)
  })
}

/* -------------------------------------------------------- encrypted sharing */

async function createEncryptedLink() {
  if (article.textContent === '') {
    notify('There is nothing to share yet', {error: true})
    return
  }

  const password = await promptPassword({
    title: 'Encrypted link',
    message:
      'The note is encrypted with AES-256 and the URL holds only ciphertext. ' +
      'Anyone with the link and the password can read it.',
    confirm: true,
    minLength: 8,
    submitLabel: 'Create',
  })
  if (password === null) return

  const payload = await encryptHash(currentContent(), password)
  const hash = '#' + ENCRYPTED_PREFIX + payload
  history.replaceState({}, '', hash)
  state.encrypted = true
  // The library row keeps the note in the clear even though the URL does not, so
  // the backup survives turning encryption on and off.
  await saveToLibrary()
  updateMenuState()

  if (await copyText(location.href)) {
    notify('Encrypted link copied. Edits no longer change the URL.')
  } else {
    notify('Link is encrypted. Copy the address bar to share it.')
  }
}

async function removeEncryption() {
  const ok = await confirmDialog({
    title: 'Remove encryption?',
    message:
      'The note will be stored in the URL unencrypted, as it was before. ' +
      'Anyone with the link will be able to read it.',
    submitLabel: 'Remove',
    danger: true,
  })
  if (!ok) return
  state.encrypted = false
  save.warnedLong = false
  await save()
  updateMenuState()
  notify('The link is no longer encrypted')
}

/* ------------------------------------------------------------ opening files */

/**
 * Every message the bubble shows gets a sequence number. Progress updates and
 * results both bump it, which is what lets the tests wait for the outcome rather
 * than for a fixed delay.
 */
let notificationSequence = 0

function showBusy(message) {
  notification.setAttribute('aria-live', 'polite')
  notification.textContent = message
  notification.dataset.sequence = String(++notificationSequence)
  notification.classList.add('visible', 'busy')
  clearTimeout(showBusy.timer)
  showBusy.timer = setTimeout(() => notification.classList.remove('visible'), 8000)
}

/**
 * Follow a `[name](file:id)` link from the note.
 *
 * The store arrives on the click, so a reader who never follows such a link
 * never downloads it. Everything that can go wrong - the record is not on
 * this machine, the browser will not re-admit the handle - is said out loud
 * rather than left as a click that did nothing, and the note itself is never
 * touched until a file has actually been read.
 */
async function openFileLink(id) {
  try {
    const {openLinkedFile} = await import('./lib/file-links.js')
    const file = await openLinkedFile(id)
    await openFiles([file])
  } catch (error) {
    notify(error?.message ?? 'That file could not be opened.', {error: true, duration: 6000})
  }
}

async function openFiles(files) {
  const list = [...files]
  if (list.length === 0) return

  if (list.length > 1) {
    // The editor holds one note, so a multi-file drop would have to invent a
    // container. Say what happened instead of silently keeping only the first.
    notify(`Only the first of ${list.length} files was opened: ${list[0].name}`)
  }

  const file = list[0]

  if (!(await confirmReplace(file.name))) return

  try {
    const result = await openWithPassword(file)
    editor.replace(result.text)
    save.warnedLong = false

    // Say what was opened first, then anything worth knowing about how it was
    // read. A note about columns or an odd encoding is a footnote, not a failure:
    // the text is in the editor either way, so replacing the confirmation with the
    // footnote would leave the user guessing whether anything happened at all.
    const kind = result.pages ? 'PDF' : 'file'
    const opened = `Opened ${result.source ?? file.name}${result.pages ? `, ${result.pages} pages` : ''} (${kind})`
    notify(result.warning ? `${opened}\n\n${result.warning}` : opened, {
      error: false,
      duration: result.warning ? 8000 : 2000,
    })
  } catch (error) {
    if (error?.message === 'Cancelled') return
    notify(error?.message ?? `Could not open ${file.name}`, {error: true, duration: 6000})
  }
}

async function openWithPassword(file) {
  const isPdf = extensionOf(file.name) === 'pdf'
  try {
    return await readFile(file, {onprogress: showBusy, twoColumns: twoColumnsEnabled()})
  } catch (error) {
    // A locked PDF falls through to the prompt below; everything else stops
    // here. Keeping the prompt outside the catch means cancelling is a decision
    // of its own rather than a new error thrown while handling this one.
    if (!(error instanceof PdfPasswordError)) throw error
    if (!isPdf) throw error
  }

  const password = await promptPassword({
    title: 'Password protected PDF',
    message: `${file.name} cannot be opened without its password.`,
    submitLabel: 'Open',
  })
  if (password === null) throw new Error('Cancelled')
  return readFile(file, {
    onprogress: showBusy,
    twoColumns: twoColumnsEnabled(),
    password,
  })
}

/* ----------------------------------------------------------------- settings */

function twoColumnsEnabled() {
  return localStorage.getItem(TWO_COLUMNS_KEY) !== 'off'
}

function toggleTwoColumns() {
  const next = !twoColumnsEnabled()
  localStorage.setItem(TWO_COLUMNS_KEY, next ? 'on' : 'off')
  updateMenuState()
  notify(next ? 'Two column PDFs will be detected' : 'Two column PDFs will be read row by row')
}

/**
 * Whether links to files on this computer are offered at all.
 *
 * On by default because the feature costs nothing until it is used: the
 * switch only decides whether the menu offers the action and whether
 * `[name](file:id)` tokens render as links. Off, the token is the text it
 * always was, which is what keeps switching it off reversible in the same
 * breath as switching it on.
 */
function fileLinksEnabled() {
  try {
    return localStorage.getItem(FILE_LINKS_KEY) !== 'off'
  } catch {
    // Storage refused: the session keeps the default.
    return true
  }
}

function toggleFileLinks() {
  const next = !fileLinksEnabled()
  try {
    localStorage.setItem(FILE_LINKS_KEY, next ? 'on' : 'off')
  } catch {
    // Storage refused: the switch still holds until the tab closes.
  }
  // Re-render from the note's own text so the tokens on screen follow the
  // switch immediately. set() does not touch history or the URL: nothing in
  // the note changed, only what the note is drawn as.
  editor.set(article.textContent)
  updateMenuState()
  notify(next ? 'File links will be offered' : 'File links are off; the tokens show as text')
}

/**
 * Whether `[[wikilinks]]` are links at all.
 *
 * Off by default: the brackets are only brackets until the reader asks for
 * them, so a note written without this fork renders exactly as it always
 * did, and switching it off again leaves the token as the text it always
 * was - nothing is added to a note that cannot be taken back out.
 */
function wikilinksEnabled() {
  try {
    return localStorage.getItem(WIKILINKS_KEY) === 'on'
  } catch {
    // Storage refused: the session keeps the default.
    return false
  }
}

function toggleWikilinks() {
  const next = !wikilinksEnabled()
  try {
    localStorage.setItem(WIKILINKS_KEY, next ? 'on' : 'off')
  } catch {
    // Storage refused: the switch still holds until the tab closes.
  }
  // Re-render from the note's own text so the tokens on screen follow the
  // switch immediately, the same way the file link switch does.
  editor.set(article.textContent)
  notify(next ? 'Wikilinks will be links' : 'Wikilinks show as text')
}

/**
 * Whether a click on a title that names nothing creates the note.
 *
 * On by default, because a reader who turns wikilinks on generally wants
 * the Obsidian behaviour where following a red link writes it; the choice
 * under the switch takes that away for anyone who would rather a click
 * never write anything.
 */
function wikiCreateEnabled() {
  try {
    return localStorage.getItem(WIKILINK_CREATE_KEY) !== 'off'
  } catch {
    // Storage refused: the session keeps the default.
    return true
  }
}

function setWikiCreate(on) {
  try {
    localStorage.setItem(WIKILINK_CREATE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/**
 * Whether `- [ ]` draws as a checkbox the reader can tick.
 *
 * Off by default, for wikilinks' reason: the bracket is only the text it
 * always was until the reader asks, so a note written without this fork
 * renders exactly as it always did - nothing is drawn that a switch cannot
 * take back out.
 */
function tasksEnabled() {
  try {
    return localStorage.getItem(TASKS_KEY) === 'on'
  } catch {
    // Storage refused: the session keeps the default.
    return false
  }
}

function setTasksEnabled(on) {
  try {
    localStorage.setItem(TASKS_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/**
 * Whether the panel lists the tasks already ticked off as well.
 *
 * Off by default: the panel earns its place answering what is left to do,
 * and the ticked work is still in the notes where it was ticked.
 */
function tasksDoneEnabled() {
  try {
    return localStorage.getItem(TASKS_DONE_KEY) === 'on'
  } catch {
    // Storage refused: the session keeps the default.
    return false
  }
}

function setTasksDoneEnabled(on) {
  try {
    localStorage.setItem(TASKS_DONE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

function toggleTasks() {
  const next = !tasksEnabled()
  setTasksEnabled(next)
  // Re-render from the note's own text so the checkboxes appear or leave
  // at once, the same bargain the file link and wikilink switches make.
  editor.set(article.textContent)
  updateMenuState()
  // The panel is the feature's face, so it goes with the feature.
  if (!next) tasksPanel?.close()
  notify(next ? 'Tasks are checkboxes' : 'Tasks show as text')
}

/**
 * Tick a task, or untick it, with the click that lands on the checkbox.
 *
 * The whole task is one character - the space or the x between the
 * brackets - so the click becomes the keystroke that writes it, through
 * the editor like any other: the change lands on the undo stack and
 * raises the input event the autosave listens for.
 */
function toggleTask(span) {
  // Where the bracket begins, measured the way the editor measures a
  // selection: a range from the top of the article to the span. The
  // note's own text is the answer rather than the span's, so a click
  // after the text has moved underneath cannot flip the wrong byte.
  const range = document.createRange()
  range.setStart(article, 0)
  range.setEnd(span, 0)
  const at = range.toString().length
  const state = article.textContent[at + 1]
  if (state !== ' ' && state !== 'x' && state !== 'X') return
  editor.select(at + 1, at + 2)
  editor.insert(state === ' ' ? 'x' : ' ')
}

/**
 * Build the backlinks panel the first time anything wants it.
 *
 * The import is the point: the whole feature is off until its switch is
 * thrown, and the panel module is fetched on the click that throws it.
 * Two clicks racing the first import would otherwise build it twice - the
 * second continuation finds the panel the first one left behind.
 */
async function ensureBacklinksPanel() {
  if (backlinksPanel) return backlinksPanel
  const {createBacklinksPanel} = await import('./lib/backlinks-panel.js')
  if (backlinksPanel) return backlinksPanel

  backlinksPanel = createBacklinksPanel({
    onOpen: (entry) => {
      void openDocument(entry)
    },
  })
  // The panel has its own close button, which is not the menu, so the menu
  // row and the panel have to be told about each other in both directions.
  backlinksPanel.onDismiss(() => {
    try {
      localStorage.setItem(BACKLINKS_KEY, 'off')
    } catch {
      // Storage refused; the preference is simply not remembered.
    }
    updateMenuState()
  })
  document.body.append(backlinksPanel.element)
  return backlinksPanel
}

function backlinksIsOpen() {
  return backlinksPanel?.isOpen() ?? false
}

/**
 * Whether prose that says the title without linking it counts as a
 * backlink as well. Off by default: a mention is a weaker claim than a
 * link, and a panel that quietly mixes them would be lying about which is
 * which. The row under the switch turns it on; the panel labels what it
 * finds either way.
 */
function backlinkMentionsEnabled() {
  try {
    return localStorage.getItem(BACKLINK_MENTIONS_KEY) === 'on'
  } catch {
    return false
  }
}

function setBacklinkMentions(on) {
  try {
    localStorage.setItem(BACKLINK_MENTIONS_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/**
 * Tell the backlinks panel what is on screen, if it has been opened.
 *
 * The panel answers only for its own title, so this is free while nothing
 * moved: a save that did not rename the note costs one comparison.
 *
 * @param {string} [text] the note to answer for; defaults to the editor
 */
function updateBacklinks(text = article.textContent) {
  backlinksPanel?.update(text, {mentions: backlinkMentionsEnabled()})
}

/**
 * Answer the panel again even though the title did not move - the library
 * lost one of the notes it was showing, or the mentions choice changed.
 */
function refreshBacklinks() {
  backlinksPanel?.update(article.textContent, {
    mentions: backlinkMentionsEnabled(),
    force: true,
  })
}

function backlinksPreferred() {
  try {
    return localStorage.getItem(BACKLINKS_KEY) === 'on'
  } catch {
    return false
  }
}

async function applyBacklinksPreference() {
  if (backlinksPreferred()) {
    const panel = await ensureBacklinksPanel()
    panel.open(article.textContent, {mentions: backlinkMentionsEnabled()})
    trackGlass(panel.element)
  }
  updateMenuState()
}

async function toggleBacklinks() {
  const panel = await ensureBacklinksPanel()
  const next = panel.toggle(article.textContent, {mentions: backlinkMentionsEnabled()})
  if (next) trackGlass(panel.element)
  try {
    localStorage.setItem(BACKLINKS_KEY, next ? 'on' : 'off')
  } catch {
    // Storage refused. The panel still works for this session.
  }
  updateMenuState()
}

/**
 * Build the tasks panel the first time the menu row asks for it.
 *
 * The same bargain as the backlinks panel: the module arrives on the
 * click that opens it, so a reader who keeps the checkboxes in their
 * notes but never wants the overview never pays for the panel either.
 */
async function ensureTasksPanel() {
  if (tasksPanel) return tasksPanel
  const {createTasksPanel} = await import('./lib/tasks-panel.js')
  if (tasksPanel) return tasksPanel

  tasksPanel = createTasksPanel({
    onOpen: (entry) => {
      void openDocument(entry)
    },
  })
  // The close button closes the panel, not the feature: the checkboxes
  // in the notes stay either way, so - unlike the backlinks panel -
  // there is no preference to hand back here.
  document.body.append(tasksPanel.element)
  return tasksPanel
}

/**
 * Open the tasks panel, or shut it if it is up.
 *
 * The menu row is a switch-gated action like Backup's: it only exists
 * while the feature is on, and it only builds the panel on the click
 * that first needs it.
 */
async function toggleTasksPanel() {
  const panel = await ensureTasksPanel()
  const open = panel.toggle({done: tasksDoneEnabled()})
  if (open) trackGlass(panel.element)
}

/**
 * Answer the tasks panel again, if it is showing.
 *
 * The question is the whole library, and a save is how a checkbox click
 * reaches the answer - so this rides along with the same news the
 * statistics panel gets, and costs nothing while the panel is shut.
 */
function updateTasks() {
  tasksPanel?.update({done: tasksDoneEnabled()})
}

/* ---------------------------------------------------- the writing tools */

const WRITING_KEY = 'textarea:writing'
const WRITING_INSTRUCTIONS_KEY = 'textarea:writing-instructions'
const WRITING_TOOL_PREFIX = 'textarea:writing-tool-'
const WRITING_SELECTION_KEY = 'textarea:writing-selection'

/** The writing tools panel, built the first time anything asks for it. */
let writingPanel = null

/**
 * Build the writing tools panel the first time anything wants it.
 *
 * The same shape as the backlinks panel: the import is the point, the
 * feature sits behind its switch, and the module arrives on the click
 * that throws it. Inside, the engine is a second, deeper lazy step -
 * gemma.js is fetched only when a tool is actually run, and it reaches
 * the vendored wasm only after every committed chunk checks out.
 */
async function ensureWritingPanel() {
  if (writingPanel) return writingPanel
  const {createWritingTools, TOOLS} = await import('./lib/writing-tools.js')
  if (writingPanel) return writingPanel

  writingPanel = createWritingTools({
    ensureModel: async (onProgress) => {
      const {loadEngine} = await import('./lib/gemma.js')
      return loadEngine({onProgress})
    },
    getText: () => article.textContent,
    // The reader's own selection, in the same flat offsets the editor and
    // the find bar speak in - read at the moment Run is pressed, from the
    // editor whether or not it still holds focus.
    getSelection: () => editor.selection(),
    selectionAware: selectionToolsEnabled,
    // The ids come from the panel's own TOOLS, captured here where the
    // module is already in hand, so the switches the settings panel
    // draws and the buttons the panel draws can never drift apart.
    getTools: () => TOOLS.filter((tool) => writingToolEnabled(tool.id)).map((tool) => tool.id),
    getInstructions: writingInstructions,
    // The result goes back the way a folder sync's edit does: through the
    // editor, so it lands on the undo stack, then a save so the hash, the
    // library and the mirror follow it. With a selection from the Run, the
    // answer goes where that Run looked - the offsets restored first, then
    // inserted over, the same two calls find's replace makes. Without one,
    // the whole note, as it always was. The notification names the way back
    // rather than asking first - the reader has already read the answer in
    // the panel before pressing the button.
    onReplace: (text, selection) => {
      if (selection) {
        editor.select(selection.start, selection.end)
        editor.insert(text)
      } else {
        editor.replace(text)
      }
      void save()
      notify(
        selection
          ? 'Selection replaced — Ctrl+Z or ⌘Z undoes it'
          : 'Note replaced — Ctrl+Z or ⌘Z undoes it',
        {duration: 4000},
      )
    },
  })
  writingPanel.onDismiss(() => {
    try {
      localStorage.setItem(WRITING_KEY, 'off')
    } catch {
      // Storage refused; the preference is simply not remembered.
    }
    updateMenuState()
  })
  document.body.append(writingPanel.element)
  return writingPanel
}

function writingIsOpen() {
  return writingPanel?.isOpen() ?? false
}

/** Whether the panel was left open: off until thrown, like every panel. */
function writingPreferred() {
  try {
    return localStorage.getItem(WRITING_KEY) === 'on'
  } catch {
    return false
  }
}

/** Each tool has its own switch, on unless the reader has thrown it off. */
function writingToolEnabled(id) {
  try {
    return localStorage.getItem(WRITING_TOOL_PREFIX + id) !== 'off'
  } catch {
    return true
  }
}

function setWritingTool(id, on) {
  try {
    localStorage.setItem(WRITING_TOOL_PREFIX + id, on ? 'on' : 'off')
  } catch {
    // Storage refused; the shelf still changes for this session.
  }
}

/** The sentence appended to every prompt, empty until one is written. */
function writingInstructions() {
  try {
    return localStorage.getItem(WRITING_INSTRUCTIONS_KEY) ?? ''
  } catch {
    return ''
  }
}

function setWritingInstructions(value) {
  try {
    localStorage.setItem(WRITING_INSTRUCTIONS_KEY, value)
  } catch {
    // Storage refused; the sentence still applies for this session.
  }
}

/**
 * Whether a Run works on the reader's selection when there is one, instead
 * of the whole note.
 *
 * Off by default: a tool quietly acting on half a note is a new behaviour,
 * and new behaviours wait to be asked for. On, the panel says which of the
 * two it ran on and the answer goes back only where the Run looked.
 */
function selectionToolsEnabled() {
  try {
    return localStorage.getItem(WRITING_SELECTION_KEY) === 'on'
  } catch {
    return false
  }
}

function setSelectionToolsEnabled(on) {
  try {
    localStorage.setItem(WRITING_SELECTION_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused; the choice holds for this session.
  }
}

async function applyWritingPreference() {
  if (writingPreferred()) {
    const panel = await ensureWritingPanel()
    panel.open()
    trackGlass(panel.element)
  }
  updateMenuState()
}

async function toggleWriting() {
  const panel = await ensureWritingPanel()
  const next = panel.toggle()
  if (next) trackGlass(panel.element)
  try {
    localStorage.setItem(WRITING_KEY, next ? 'on' : 'off')
  } catch {
    // Storage refused. The panel still works for this session.
  }
  updateMenuState()
}

/**
 * Follow a `[[wikilink]]`.
 *
 * The title is matched against the library the way the documents panel
 * would match it: case insensitively, on the first note whose heading says
 * it. No match is either a note made on the spot - a `# heading`, which is
 * what names a note everywhere else here - or a plain word about it,
 * whichever the choice under the switch says.
 *
 * @param {string} title the text between the brackets
 */
async function openWikiLink(title) {
  const entries = await listDocuments()
  const wanted = title.trim().toLowerCase()
  const found = entries.find((entry) => entry.title?.toLowerCase() === wanted)
  if (found) {
    await openDocument(found)
    return
  }

  if (!wikiCreateEnabled()) {
    notify(`No note is titled “${title}”`)
    return
  }

  await newDocument()
  // The reader was asked before the editor was emptied and said no, so the
  // click ends here rather than writing a heading over their work.
  if (article.textContent.trim() !== '') return
  editor.replace(`# ${title}`)
  await save()
  notify(`Created “${title}”`)
}

/**
 * Whether the statistics panel was left open.
 *
 * Remembered because the panel covers the bottom left corner: a reader who wants
 * it on while writing does not want to reopen it after every reload, and one who
 * does not want it should not find it on screen.
 */
function statsPreferred() {
  return localStorage.getItem(STATS_KEY) === 'on'
}

function applyStatsPreference() {
  if (statsPreferred()) {
    statsPanel.open(article.textContent)
    trackGlass(statsPanel.element)
  } else {
    statsPanel.close()
  }
  updateMenuState()
}

function toggleStats() {
  const next = statsPanel.toggle(article.textContent)
  if (next) trackGlass(statsPanel.element)
  try {
    localStorage.setItem(STATS_KEY, next ? 'on' : 'off')
  } catch {
    // Storage refused. The panel still works for this session.
  }
  updateMenuState()
}

function toggleGlass() {
  setGlassEnabled(!glassEnabled())
  updateMenuState()
}

/* --------------------------------------------------- the quick switcher */

/**
 * Whether the shortcut is armed.
 *
 * On unless it has been switched off: until its key is pressed the feature
 * is one listener, so the default is the palette being there - and the
 * switch in settings takes it away whole, chord and all, for a reader who
 * would rather Ctrl+K stayed the browser's.
 */
function switcherEnabled() {
  try {
    return localStorage.getItem(SWITCHER_KEY) !== 'off'
  } catch {
    return true
  }
}

function setSwitcherEnabled(on) {
  try {
    localStorage.setItem(SWITCHER_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/** How wide the search runs: titles, which is what jumping wants, or all of it. */
function switcherScope() {
  try {
    return localStorage.getItem(SWITCHER_SCOPE_KEY) === 'all' ? 'all' : 'titles'
  } catch {
    return 'titles'
  }
}

function setSwitcherScope(scope) {
  try {
    localStorage.setItem(SWITCHER_SCOPE_KEY, scope === 'all' ? 'all' : 'titles')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/**
 * Which chord carries the shortcut, from the three the settings panel
 * offers.
 *
 * Anything else - a stored value from a page someone edited, or nothing at
 * all - falls back to Ctrl/Cmd + K, so only these three letters ever reach
 * the keydown handler's comparison and no stored string decides which key
 * gets intercepted.
 */
function switcherShortcut() {
  try {
    const stored = localStorage.getItem(SWITCHER_SHORTCUT_KEY)
    return stored === 'p' || stored === 'e' ? stored : 'k'
  } catch {
    return 'k'
  }
}

function setSwitcherShortcut(shortcut) {
  try {
    const value = shortcut === 'p' || shortcut === 'e' ? shortcut : 'k'
    localStorage.setItem(SWITCHER_SHORTCUT_KEY, value)
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

function switcherIsOpen() {
  return switcher?.isOpen() ?? false
}

/**
 * Find claims Ctrl/Cmd+F while this is on - the browser's own find is what
 * gives way - and hands the chord back whole when it is off. On until
 * switched off, because a find bar is the one feature whose absence a
 * reader notices on the first keypress; the switch in Settings is there
 * for the reader who would rather the browser kept its own.
 */
function findEnabled() {
  try {
    return localStorage.getItem(FIND_KEY) !== 'off'
  } catch {
    return true
  }
}

function setFindEnabled(on) {
  try {
    localStorage.setItem(FIND_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/** The bar's two remembered defaults, both off until asked for. */
function findCase() {
  try {
    return localStorage.getItem(FIND_CASE_KEY) === 'on'
  } catch {
    return false
  }
}

function setFindCase(on) {
  try {
    localStorage.setItem(FIND_CASE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

function findWords() {
  try {
    return localStorage.getItem(FIND_WORDS_KEY) === 'on'
  } catch {
    return false
  }
}

function setFindWords(on) {
  try {
    localStorage.setItem(FIND_WORDS_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/**
 * Whether the menu offers a Backup row.
 *
 * On by default: the row does nothing until it is clicked, and the thing it
 * offers - every note in one archive - is the one worth having when a browser
 * profile is about to go away. The switch is for the reader who keeps notes
 * elsewhere and would rather the row were not there.
 */
function backupEnabled() {
  try {
    return localStorage.getItem(BACKUP_KEY) !== 'off'
  } catch {
    // Storage refused: the session keeps the default.
    return true
  }
}

function setBackupEnabled(on) {
  try {
    localStorage.setItem(BACKUP_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/**
 * Whether the archive carries the front matter block.
 *
 * On by default because that block is what makes the backup a backup: it is
 * how Folder sync recognises a restored file as the note it always was. Off,
 * the files are the bare markdown - for an archive meant to leave the app -
 * and restoring from them starts fresh rather than matching.
 */
function backupMetadata() {
  try {
    return localStorage.getItem(BACKUP_METADATA_KEY) !== 'off'
  } catch {
    return true
  }
}

function setBackupMetadata(on) {
  try {
    localStorage.setItem(BACKUP_METADATA_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/**
 * Whether Backup asks for a password before it writes.
 *
 * Off by default: every backup would then need a password typed, which is a
 * ceremony the reader may not want for an archive that never leaves the
 * Downloads folder. On, the archive is AES-256 the moment it lands.
 */
function backupEncrypt() {
  try {
    return localStorage.getItem(BACKUP_ENCRYPT_KEY) === 'on'
  } catch {
    return false
  }
}

function setBackupEncrypt(on) {
  try {
    localStorage.setItem(BACKUP_ENCRYPT_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/**
 * Whether a deleted note waits in the trash instead of vanishing.
 *
 * On by default: the row does nothing until it is clicked, and the thing it
 * offers - an accidental delete undone - is the one mistake worth having a
 * second chance at. Off, deletes are for good, which is what a reader who
 * means it and says so should get.
 */
function trashEnabled() {
  try {
    return localStorage.getItem(TRASH_KEY) !== 'off'
  } catch {
    // Storage refused: the session keeps the default.
    return true
  }
}

function setTrashEnabled(on) {
  try {
    localStorage.setItem(TRASH_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/**
 * How many days a trashed note earns before it goes for good.
 *
 * The three the Settings select offers and nothing else: a stray value in
 * storage - an old key, a hand edit - falls back to the shipped 30 rather
 * than into a purge schedule the reader never chose.
 */
function trashKeep() {
  try {
    const stored = localStorage.getItem(TRASH_KEEP_KEY)
    return stored === '7' || stored === '90' ? stored : '30'
  } catch {
    return '30'
  }
}

function setTrashKeep(days) {
  try {
    localStorage.setItem(TRASH_KEEP_KEY, String(days))
  } catch {
    // Storage refused: the choice holds until the tab closes.
  }
}

/**
 * Build the bar if this is the first press, then open it.
 *
 * Two presses racing the import would otherwise build it twice: the check
 * runs again once the module has arrived, and the second caller opens the
 * bar the first one left standing.
 */
async function openSwitcher() {
  if (!switcher) {
    const {createSwitcher} = await import('./lib/switcher.js')
    if (!switcher) {
      switcher = createSwitcher({
        onOpen: (entry) => {
          void openDocument(entry)
        },
      })
      document.body.append(switcher.element)
    }
  }
  switcher.open({scope: switcherScope()})
}

/**
 * Build the bar if this is the first press, then open it - the switcher's
 * double-checked import, for the same reason: two presses racing the module
 * would otherwise build two bars.
 */
async function openFind() {
  if (!find) {
    const {createFind} = await import('./lib/find-panel.js')
    if (!find) {
      find = createFind({
        getNote: () => article.textContent || '',
        selection: () => editor.selection(),
        select: (start, end) => editor.select(start, end),
        insert: (text) => editor.insert(text),
        replace: (text) => editor.replace(text),
        notify: (message) => notify(message),
        // The two defaults live here and in Settings, pointing at one
        // preference each - the bar's checkboxes and the panel's rows move
        // the same values, so the two can never disagree about them.
        prefs: {
          getCase: findCase,
          setCase: setFindCase,
          getWords: findWords,
          setWords: setFindWords,
        },
      })
      document.body.append(find.element)
    }
  }
  find.open()
}

/* -------------------------------------------------------------------- menu */

function updateMenuState() {
  document.querySelector('#menu-stats')?.setAttribute('aria-checked', String(statsPanel.isOpen()))
  document.querySelector('#menu-backlinks')?.setAttribute(
    'aria-checked',
    String(backlinksIsOpen()),
  )
  document.querySelector('#menu-writing')?.setAttribute(
    'aria-checked',
    String(writingIsOpen()),
  )
  document.querySelector('#menu-columns')?.setAttribute(
    'aria-checked',
    String(twoColumnsEnabled()),
  )

  // The padlock says which way the switch is currently pointing, so the row reads
  // correctly before it is opened as well as after.
  const encryptionIcon = document.querySelector('#menu-encryption use')
  if (encryptionIcon) {
    const href = state.encrypted ? '#icon-unlock' : '#icon-lock'
    encryptionIcon.setAttribute('href', href)
    encryptionIcon.setAttribute('xlink:href', href)
  }

  const encryption = document.querySelector('#menu-encryption-label')
  if (encryption) encryption.textContent = state.encrypted ? 'Encryption: on' : 'Encryption'

  const columns = document.querySelector('#menu-columns-label')
  if (columns) columns.textContent = 'Two column PDFs: ' + (twoColumnsEnabled() ? 'on' : 'off')

  // The switch and the action it gates travel together: without a picker the
  // row would promise something this browser cannot do, and with the switch
  // off the action would have nowhere to lead.
  const fileLinksRow = document.querySelector('#menu-filelinks')
  if (fileLinksRow) {
    const available = 'showOpenFilePicker' in window
    fileLinksRow.hidden = !available
    fileLinksRow.setAttribute('aria-checked', String(fileLinksEnabled()))
    const fileLinksLabel = document.querySelector('#menu-filelinks-label')
    if (fileLinksLabel) {
      fileLinksLabel.textContent = 'File links: ' + (fileLinksEnabled() ? 'on' : 'off')
    }
    const fileLinkAction = document.querySelector('#menu-filelink')
    if (fileLinkAction) fileLinkAction.hidden = !available || !fileLinksEnabled()
  }
  const theme = document.querySelector('#menu-theme-label')
  if (theme) theme.textContent = 'Theme: ' + readTheme(location.search)

  // A reader who has asked for reduced transparency has no effect to switch,
  // so the row is not offered rather than sitting there doing nothing.
  const glassRow = document.querySelector('#menu-glass')
  if (glassRow) {
    glassRow.hidden = !glassAvailable()
    glassRow.setAttribute('aria-checked', String(glassEnabled()))
  }
  const glass = document.querySelector('#menu-glass-label')
  if (glass) glass.textContent = 'Glass: ' + (glassEnabled() ? 'on' : 'off')

  // The Backup row is a switch-gated action like the file-link one: it hides
  // with the switch, and with the storage it would read from - a private
  // window that refuses IndexedDB has no library to put in an archive.
  const backupRow = document.querySelector('#menu-backup')
  if (backupRow) backupRow.hidden = !backupEnabled() || !libraryAvailable()

  // The Trash row hides the same way: with its switch, and with the storage
  // that would hold the notes it recovers.
  const trashRow = document.querySelector('#menu-trash')
  if (trashRow) trashRow.hidden = !trashEnabled() || !libraryAvailable()

  // The Tasks row is a switch-gated action the same way: with its switch,
  // and with the storage whose notes it would read.
  const tasksRow = document.querySelector('#menu-tasks')
  if (tasksRow) tasksRow.hidden = !tasksEnabled() || !libraryAvailable()

  // Folder sync is offered only where the browser can honour it, and the row
  // says which folder it is talking to - even one merely remembered and
  // waiting for permission, which is the folder the reader must click to
  // allow - and, past the name, how the mirror is going right now. The state
  // is read fresh on every open, the same as the share link and every other
  // row here.
  const status = folderSyncStatus()
  const folderRow = document.querySelector('#menu-folder')
  if (folderRow) folderRow.hidden = !folderSyncAvailable()
  const folder = document.querySelector('#menu-folder-label')
  if (folder) {
    folder.textContent = status.name ? `Folder sync: ${status.name}` : 'Folder sync'
    let step = ''
    if (status.active) {
      if (status.syncing) step = 'Syncing…'
      else if (status.problem) step = 'Sync problem'
      else if (status.pending) step = 'Waiting to sync'
      else if (status.lastPass) step = 'Up to date'
    }
    if (step) folder.textContent += ` · ${step}`
  }

  // The action sits beside the state it acts on, and only while there is a
  // folder to act on: a sync-now with nothing connected has nothing to say.
  const syncRow = document.querySelector('#menu-sync')
  if (syncRow) syncRow.hidden = !status.active
}

function hideMenu() {
  menu.classList.remove('visible')
  button.setAttribute('aria-expanded', 'false')
}

function notify(message, {error = false, duration = 2000} = {}) {
  clearTimeout(showBusy.timer)
  // Set before the text changes: a live region announces the mutation, so the
  // politeness has to already be right when the message lands.
  notification.setAttribute('aria-live', error ? 'assertive' : 'polite')
  notification.textContent = message
  notification.dataset.sequence = String(++notificationSequence)
  notification.classList.toggle('error', error)
  notification.classList.remove('busy')
  notification.classList.add('visible')
  setTimeout(() => notification.classList.remove('visible'), duration)
}

function onMenu(id, handler) {
  const element = document.querySelector('#menu-' + id)
  element?.addEventListener('click', (event) => {
    event.preventDefault()
    hideMenu()
    handler()
  })
}

/**
 * A file won the comparison, and this note is the one on screen.
 *
 * The editor is the half of the mirror the sync cannot see: left alone it
 * would hold the losing text and save it straight back over the winner on the
 * next keystroke. editor.replace() pushes onto the undo stack first, so the
 * change arrives undoable, which is what makes replacing what someone may be
 * halfway through typing acceptable at all.
 */
function applySyncedNote(record) {
  if (record.id !== documentId()) return
  const style = sanitizeStyle(record.style)
  const current = article.getAttribute('style')
  if (article.textContent === record.text && (current ?? null) === (style ?? null)) return
  editor.replace(record.text)
  if (style) article.setAttribute('style', style)
  else article.removeAttribute('style')
  // The reader's own version just lost to the file's, so the message has to
  // carry the way back. The app binds undo to either modifier key on every
  // platform, so naming both is the honest hint without sniffing for a Mac.
  notify('Updated from the folder — Ctrl+Z or ⌘Z undoes it', {duration: 4000})
}

/**
 * Connect to a folder, or offer to stop.
 *
 * Stopping asks first and says the files stay, because the menu row is one
 * click and a mirror that silently stops mirroring is the worse surprise of
 * the two. Reconnecting a folder from an earlier session tries its saved
 * handle before opening the picker again: Chrome's permission bubble is one
 * click, a new pick is a trip through the filesystem.
 */
async function toggleFolderSync() {
  if (folderSyncStatus().active) {
    const status = folderSyncStatus()
    const ok = await confirmDialog({
      title: 'Folder sync',
      message:
        `Every note is mirrored to "${status.name}", where any editor can open it. ` +
        'Stopping leaves every file where it is.',
      submitLabel: 'Stop syncing',
    })
    if (!ok) return
    await disconnectFolder()
    updateMenuState()
    notify('Folder sync stopped')
    return
  }

  let name = await reconnectFolder()
  if (!name) {
    let result
    try {
      result = await connectFolder()
    } catch (error) {
      notify(error?.message ?? 'The folder could not be opened.', {error: true, duration: 6000})
      return
    }
    if (result.cancelled) return
    name = result.name
  }

  updateMenuState()
  notify(`Syncing to ${name}`)
}

/** The focusable menu items, in order, skipping the one that is hidden. */
function menuItems() {
  return [...menu.querySelectorAll('.item:not([hidden])')]
}

function initMenu() {
  button.addEventListener('click', (event) => {
    if (event.clientX || event.targetTouches) ripple(event)
    const open = menu.classList.toggle('visible')
    button.setAttribute('aria-expanded', String(open))
    document.querySelector('#menu-share')?.setAttribute('href', location.href)
    updateMenuState()
    // The first time the menu opens is the first time the glass module is
    // worth fetching; before that there has been nothing to put it on.
    if (open) trackGlass(menu)
  })

  document.body.addEventListener('click', (event) => {
    const target = event.target
    if (target.closest('#menu')) return
    if (target.closest('#button')) return
    if (target.closest('.ripple')) return
    hideMenu()
  })

  // A menu opened from the keyboard has to be navigable and dismissable from the
  // keyboard, and the focus belongs back on the button that opened it.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !menu.classList.contains('visible')) return
    hideMenu()
    // The focus goes back on the next frame. Focus moved while the item that had
    // it is still visible, and the browser hands focus to the body when that item
    // finishes hiding 100ms later, which loses the handback.
    requestAnimationFrame(() => button.focus())
  })

  // Arrow keys are handled on the document rather than on the menu, so they work
  // with the focus still on the button that opened it. Tab is left to move the
  // focus out, with the menu closing behind it.
  document.addEventListener('keydown', (event) => {
    if (!menu.classList.contains('visible')) return

    if (event.key === 'Tab') {
      hideMenu()
      return
    }

    const items = menuItems()
    if (!items.length) return

    // Focus on the button counts as being before the first item, so the first
    // arrow press walks into the menu instead of skipping its first entry.
    const from = items.indexOf(document.activeElement)
    const step = {ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1}[event.key]
    let to
    if (step) to = from < 0 ? 0 : (from + step + items.length) % items.length
    else if (event.key === 'Home') to = 0
    else if (event.key === 'End') to = items.length - 1
    else return

    event.preventDefault()
    items[to].focus()
  })

  onMenu('open', () => fileInput.click())

  onMenu('filelinks', toggleFileLinks)
  onMenu('filelink', async () => {
    try {
      // Loaded on the click that needs it, like the panels: a reader who never
      // links a file never pays for the store that holds them.
      const {pickFile} = await import('./lib/file-links.js')
      const picked = await pickFile()
      editor.insert(fileLink(picked.name, picked.id))
      notify(`Linked ${picked.name}`)
    } catch (error) {
      if (error?.name === 'AbortError') return
      notify(error?.message ?? 'The file could not be linked.', {error: true, duration: 6000})
    }
  })

  // The panels a reader opens rarely are fetched when their entry is used
  // rather than parsed at boot: the click waits the few milliseconds the fetch
  // takes, and every boot that never opens them pays nothing.
  onMenu('export', async () => {
    const {exportInteractive} = await import('./lib/export-panel.js')
    exportInteractive(article, {
      notify: (message, isError) => notify(message, {error: Boolean(isError)}),
      encrypted: state.encrypted,
    })
  })

  onMenu('documents', async () => {
    const {showDocumentsPanel} = await import('./lib/library-panel.js')
    showDocumentsPanel({
      activeId: documentId(),
      onOpen: openDocument,
      onNew: newDocument,
      onDelete: (id) => {
        noteDeleted(id)
        // One of the notes on screen's list may have just left it.
        refreshBacklinks()
        // The tasks panel's rows are library-wide: one of them just left.
        updateTasks()
      },
      // The reader's switch, read at the moment the panel opens: on, a delete
      // waits in the trash; off, it is for good.
      trash: trashEnabled(),
      notify: (message, isError) => notify(message, {error: Boolean(isError)}),
    })
  })

  onMenu('folder', toggleFolderSync)
  // The note on screen joins the archive as it stands: the 500ms save may
  // still be pending when the reader clicks, and a backup that missed the last
  // few seconds of typing is exactly the one that needed to be right. The
  // module is fetched on the click that needs it, the same as the panels: a
  // reader who never backs up never pays for the code that writes the archive.
  onMenu('backup', async () => {
    try {
      await save()
      const {backupInteractive} = await import('./lib/backup.js')
      await backupInteractive({
        metadata: backupMetadata(),
        encrypt: backupEncrypt(),
        notify: (message, isError) => notify(message, {error: Boolean(isError)}),
      })
    } catch (error) {
      notify(error?.message ?? 'The backup could not be written.', {error: true, duration: 6000})
    }
  })

  // Restoring puts a note back into the library, which is the folder mirror's
  // cue to write its file again and the backlinks' cue to look again - the
  // same two things a save would have told them.
  onMenu('trash', async () => {
    try {
      const {showTrashPanel} = await import('./lib/library-panel.js')
      await showTrashPanel({
        keepDays: Number(trashKeep()),
        onRestore: () => {
          scheduleSync()
          refreshBacklinks()
          updateTasks()
        },
        notify: (message, isError) => notify(message, {error: Boolean(isError)}),
      })
    } catch (error) {
      notify(error?.message ?? 'The trash could not be opened.', {error: true, duration: 6000})
    }
  })
  // A pass on demand, with the result in the same bubble as everything else:
  // what was written, imported, or removed - or nothing, said plainly, when
  // the folder already holds every note.
  onMenu('sync', async () => {
    const counts = await syncNow()
    if (!counts) return
    const parts = []
    if (counts.written) parts.push(`${counts.written} written`)
    if (counts.imported) parts.push(`${counts.imported} imported`)
    if (counts.removed) parts.push(`${counts.removed} removed`)
    notify(parts.length ? `Synced — ${parts.join(', ')}` : 'Nothing to sync — the folder is in step')
  })

  onMenu('encryption', async () => {
    const {showEncryptionPanel} = await import('./lib/encryption-panel.js')
    showEncryptionPanel({
      encrypted: state.encrypted,
      onEncrypt: createEncryptedLink,
      onDecrypt: removeEncryption,
    })
  })

  onMenu('stats', toggleStats)
  onMenu('backlinks', () => {
    void toggleBacklinks()
  })
  onMenu('tasks', () => {
    void toggleTasksPanel()
  })
  onMenu('writing', () => {
    void toggleWriting()
  })
  onMenu('glass', toggleGlass)
  onMenu('columns', toggleTwoColumns)

  // The panel carries the switches the menu carries, as get/set pairs
  // against the same preferences, so the two can never disagree about
  // which way a switch is pointing. Each setter is the menu's own
  // handler, guarded so a click that would not change anything does not
  // ring the notification bubble either.
  onMenu('settings', async () => {
    const {showSettingsPanel} = await import('./lib/settings-panel.js')
    // The writing tools' options name their tools, and those names have
    // one home: the panel module's own TOOLS. It is a small import for a
    // settings dialog - it arrives with the dialog, never at boot - and
    // it is what keeps a switch's label the button's label.
    const {TOOLS} = await import('./lib/writing-tools.js')
    await showSettingsPanel({
      features: [
        {
          id: 'glass',
          label: 'Glass refraction',
          available: glassAvailable,
          get: glassEnabled,
          set: (on) => {
            if (glassEnabled() !== on) toggleGlass()
          },
        },
        {
          id: 'stats',
          label: 'Statistics panel',
          get: () => statsPanel.isOpen(),
          set: (on) => {
            if (statsPanel.isOpen() !== on) toggleStats()
          },
        },
        {
          id: 'backlinks',
          label: 'Backlinks panel',
          get: backlinksIsOpen,
          set: (on) => {
            if (backlinksIsOpen() !== on) void toggleBacklinks()
          },
          options: [
            {
              id: 'mentions',
              label: 'Also count plain mentions of the title',
              get: backlinkMentionsEnabled,
              set: (on) => {
                if (backlinkMentionsEnabled() === on) return
                setBacklinkMentions(on)
                // The title did not move, but the answer did.
                refreshBacklinks()
              },
            },
          ],
        },
        {
          id: 'writing',
          label: 'Writing tools',
          get: writingIsOpen,
          set: (on) => {
            if (writingIsOpen() !== on) void toggleWriting()
          },
          // The switches under the panel are the shelf the panel draws:
          // one row per tool, from the same list, and a line of prose the
          // reader can append to every prompt. A shelf changed here is
          // redrawn in the open panel at once, because both read the same
          // preferences and the panel is pushed the news when they move.
          options: [
            ...TOOLS.map((tool) => ({
              id: tool.id,
              label: tool.label,
              get: () => writingToolEnabled(tool.id),
              set: (on) => {
                setWritingTool(tool.id, on)
                writingPanel?.refresh()
              },
            })),
            {
              id: 'selection',
              label: 'Work on the selection when there is one',
              get: selectionToolsEnabled,
              set: (on) => {
                setSelectionToolsEnabled(on)
                writingPanel?.refresh()
              },
            },
            {
              id: 'instructions',
              label: 'Extra instructions for every tool',
              kind: 'text',
              placeholder: 'e.g. keep it short, use British English',
              get: writingInstructions,
              set: (value) => {
                setWritingInstructions(value)
                writingPanel?.refresh()
              },
            },
          ],
        },
        {
          id: 'switcher',
          label: 'Quick switcher',
          get: switcherEnabled,
          set: (on) => {
            if (switcherEnabled() !== on) setSwitcherEnabled(on)
          },
          options: [
            {
              id: 'scope',
              label: 'Search in',
              kind: 'select',
              choices: [
                {value: 'titles', label: 'Titles only'},
                {value: 'all', label: 'Titles and text'},
              ],
              get: switcherScope,
              set: (value) => {
                if (switcherScope() !== value) setSwitcherScope(value)
              },
            },
            {
              id: 'shortcut',
              label: 'Keyboard shortcut',
              kind: 'select',
              choices: [
                {value: 'k', label: 'Ctrl/Cmd + K'},
                {value: 'p', label: 'Ctrl/Cmd + P'},
                {value: 'e', label: 'Ctrl/Cmd + E'},
              ],
              get: switcherShortcut,
              set: (value) => {
                if (switcherShortcut() !== value) setSwitcherShortcut(value)
              },
            },
          ],
        },
        {
          id: 'find',
          label: 'Find and replace',
          get: findEnabled,
          set: (on) => {
            if (findEnabled() !== on) setFindEnabled(on)
          },
          // The two defaults the bar opens with, in step with the
          // checkboxes in the bar itself - one preference, two faces, and
          // an open bar repaints when a face moves.
          options: [
            {
              id: 'case',
              label: 'Match case by default',
              get: findCase,
              set: (on) => {
                if (findCase() !== on) setFindCase(on)
                find?.refresh()
              },
            },
            {
              id: 'words',
              label: 'Whole words by default',
              get: findWords,
              set: (on) => {
                if (findWords() !== on) setFindWords(on)
                find?.refresh()
              },
            },
          ],
        },
        {
          id: 'backup',
          label: 'Backup',
          available: () => libraryAvailable(),
          get: backupEnabled,
          set: (on) => {
            if (backupEnabled() !== on) {
              setBackupEnabled(on)
              // The switch and the row it gates travel together: off, the
              // menu has nothing to offer here, so the row leaves at once
              // rather than at the next re-render.
              updateMenuState()
            }
          },
          // What goes in the archive, in the same order the flow meets it.
          options: [
            {
              id: 'metadata',
              label: 'Include note metadata (front matter)',
              get: backupMetadata,
              set: (on) => {
                if (backupMetadata() !== on) setBackupMetadata(on)
              },
            },
            {
              id: 'encrypt',
              label: 'Encrypt with a password',
              get: backupEncrypt,
              set: (on) => {
                if (backupEncrypt() !== on) setBackupEncrypt(on)
              },
            },
          ],
        },
        {
          id: 'trash',
          label: 'Trash (recover deleted notes)',
          available: () => libraryAvailable(),
          get: trashEnabled,
          set: (on) => {
            if (trashEnabled() !== on) {
              setTrashEnabled(on)
              // The switch and the row it gates travel together, the same as
              // Backup's: off, the menu has nothing to offer here.
              updateMenuState()
            }
          },
          options: [
            {
              id: 'keep',
              label: 'Keep deleted notes for',
              kind: 'select',
              choices: [
                {value: '7', label: '7 days'},
                {value: '30', label: '30 days'},
                {value: '90', label: '90 days'},
              ],
              get: trashKeep,
              set: (value) => {
                if (trashKeep() !== value) setTrashKeep(value)
              },
            },
          ],
        },
        {
          id: 'columns',
          label: 'Two column PDFs',
          get: twoColumnsEnabled,
          set: (on) => {
            if (twoColumnsEnabled() !== on) toggleTwoColumns()
          },
        },
        {
          id: 'filelinks',
          label: 'File links',
          available: () => 'showOpenFilePicker' in window,
          get: fileLinksEnabled,
          set: (on) => {
            if (fileLinksEnabled() !== on) toggleFileLinks()
          },
        },
        {
          id: 'wikilinks',
          label: 'Wikilinks',
          get: wikilinksEnabled,
          set: (on) => {
            if (wikilinksEnabled() !== on) toggleWikilinks()
          },
          options: [
            {
              id: 'create',
              label: 'Create the note when a title matches nothing',
              get: wikiCreateEnabled,
              set: (on) => {
                if (wikiCreateEnabled() !== on) setWikiCreate(on)
              },
            },
          ],
        },
        {
          id: 'tasks',
          label: 'Tasks',
          get: tasksEnabled,
          set: (on) => {
            if (tasksEnabled() !== on) toggleTasks()
          },
          options: [
            {
              id: 'done',
              label: 'Also show completed tasks in the panel',
              get: tasksDoneEnabled,
              set: (on) => {
                if (tasksDoneEnabled() === on) return
                setTasksDoneEnabled(on)
                // The notes did not move, but the answer did.
                updateTasks()
              },
            },
          ],
        },
      ],
      // The panel reports its own fonts through the same bubble every
      // other panel uses, injected rather than imported so the settings
      // dialog never grows a piece of the page it sits in.
      notify: (message, isError) => notify(message, {error: Boolean(isError)}),
    })
  })

  // The panel has its own close button, which is not the menu, so the menu entry
  // and the panel have to be told about each other in both directions.
  statsPanel.onDismiss(() => {
    try {
      localStorage.setItem(STATS_KEY, 'off')
    } catch {
      // Storage refused; the preference is simply not remembered.
    }
    updateMenuState()
  })

  document.querySelector('#menu-share')?.addEventListener('click', async (event) => {
    event.preventDefault()
    hideMenu()
    if (!(await copyText(location.href))) {
      notify('The browser would not copy to the clipboard', {error: true})
      return
    }
    notify(state.encrypted ? 'Encrypted link copied' : 'Link copied')
  })

  fileInput.addEventListener('change', () => {
    const files = fileInput.files
    openFiles(files)
    fileInput.value = ''
  })
}

/* --------------------------------------------------------- drag and drop */

function initDragAndDrop() {
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files')

  let depth = 0

  addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    depth++
    dropOverlay.classList.add('visible')
  })

  addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return
    // Required, or the browser navigates to the dropped file instead.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  })

  addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return
    depth = Math.max(0, depth - 1)
    if (depth === 0) dropOverlay.classList.remove('visible')
  })

  addEventListener('drop', (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    depth = 0
    dropOverlay.classList.remove('visible')
    openFiles(event.dataTransfer.files)
  })
}

/* ------------------------------------------------------------- installed PWA */

function initFileHandling() {
  // Lets the app be a target in the OS "Open with" menu once installed. Both
  // globals are read off window: a bare `LaunchParams` throws a ReferenceError
  // where the interface is not exposed, which would take the whole app down.
  if (!('launchQueue' in window)) return
  if (!window.LaunchParams || !('files' in window.LaunchParams.prototype)) return

  window.launchQueue.setConsumer(async (params) => {
    if (!params?.files?.length) return
    openFiles(params.files)
  })
}

/* -------------------------------------------------------------------- boot */

/**
 * A custom font chosen in Settings, fetched and applied after the first
 * paint.
 *
 * The bytes live in IndexedDB and register through the FontFace API, so
 * this cannot be part of the synchronous line below: the built-in stack is
 * already on screen while the file is read, exactly the bargain any other
 * webfont makes. A font that is missing, unreadable, or switched off
 * leaves that stack in place and says nothing - holding the note hostage
 * to a preference would be worse than a font that did not arrive.
 */
function applyFontPreference() {
  const appearance = readAppearance(localStorage)
  if (!isCustomFont(appearance.font)) return
  void import('./lib/fonts.js')
    .then(async ({applyFont}) => {
      const stack = await applyFont(appearance.font)
      if (stack) applyAppearance(document.documentElement, appearance, {[appearance.font]: stack})
    })
    .catch(() => {
      // No shelf, or no FontFace: the default stack stays.
    })
}

function init() {
  initMenu()
  initTheme()
  // The reader's own accent and note sizing are preferences like the rest:
  // applied at boot, next to the theme, so a stored choice never flashes
  // its absence before the override lands.
  applyAppearance(document.documentElement, readAppearance(localStorage))
  applyFontPreference()
  initDragAndDrop()
  initFileHandling()
  applyStatsPreference()
  // The backlinks panel builds itself only if it was left open, so this
  // stays a no-op - and stays off the boot's fetch list - for a reader who
  // has never switched the feature on.
  void applyBacklinksPreference()
  // The same bargain for the writing tools: their module and the engine
  // behind it are fetched on the first opening, so a reader who never
  // asks for them never downloads either.
  void applyWritingPreference()
  updateMenuState()

  // Background sync has no menu to speak from, so problems land in the same
  // bubble everything else uses, and a folder remembered from the last session
  // asks Chrome for it back right away.
  setFolderSyncNotice((message, isError) => notify(message, {error: Boolean(isError), duration: 6000}))
  setFolderSyncApply(applySyncedNote)
  restoreFolder().then((name) => {
    if (name) notify(`Syncing to ${name}`)
  })

  // The title follows the first keystroke; the URL and the library are rewritten
  // on a pause, since re-compressing and re-writing a row on every character
  // would be wasteful.
  const debouncedSave = debounce(500, save)
  article.addEventListener('input', () => {
    updateTitle()
    debouncedSave()
  })
  article.addEventListener('blur', save)
  article.addEventListener('click', (event) => {
    // The checkbox is a span, not a link, and it writes the one character
    // the task is made of - which the keyboard would have typed anyway.
    if (event.target.classList.contains('md-task')) {
      toggleTask(event.target)
      return
    }
    if (event.target.tagName !== 'A') return
    // A wikilink resolves against this browser's library: its title is on
    // the element, and whether nothing is made on a miss is the reader's
    // choice under the switch.
    if (event.target.classList.contains('md-wiki')) {
      openWikiLink(event.target.dataset.wikiTitle)
      return
    }
    // A link to a file on this computer is not a URL: it resolves against
    // this browser's own records, and the module that holds them arrives on
    // the click.
    if (event.target.classList.contains('md-file')) {
      openFileLink(event.target.dataset.fileId)
      return
    }
    // noopener and noreferrer in the features string: the href is note content,
    // so the page that receives the click must not hold window.open's default
    // handle on this tab. The anchor's own rel does not apply here, because this
    // call opens the tab, not the default navigation.
    window.open(event.target.getAttribute('href'), '_blank', 'noopener,noreferrer')
  })
  article.addEventListener('dragover', (event) => {
    if (hasFileDrag(event)) event.preventDefault()
  })

  addEventListener('hashchange', load)
  addEventListener('load', () =>
    new MutationObserver(save).observe(article, {attributeFilter: ['style']}),
  )
  addEventListener('keydown', (event) => {
    // Save is the app's own name for exporting to a file, so the keyboard
    // shortcut opens the panel rather than picking a format behind the reader's
    // back.
    if ((event.metaKey || event.ctrlKey) && event.code === 'KeyS') {
      event.preventDefault()
      import('./lib/export-panel.js').then(({exportInteractive}) =>
        exportInteractive(article, {
          notify: (message, isError) => notify(message, {error: Boolean(isError)}),
          encrypted: state.encrypted,
        }),
      )
    }
    if ((event.metaKey || event.ctrlKey) && event.code === 'KeyO') {
      event.preventDefault()
      fileInput.click()
    }
    // The switcher answers its own chord, and nothing at all when it has
    // been switched off - and which chord that is lives in settings, so
    // this compares against the stored choice rather than a name baked in
    // here. Pressing it while the palette is up closes it again.
    if (
      switcherEnabled() &&
      (event.metaKey || event.ctrlKey) &&
      event.code === `Key${switcherShortcut().toUpperCase()}`
    ) {
      event.preventDefault()
      if (switcherIsOpen()) switcher?.close()
      else void openSwitcher()
    }
    // Find answers its own chord, and nothing at all when it has been
    // switched off - the browser's find keeps it then, unclaimed. Shift
    // and Alt stay out of the comparison, so the browser's own variants
    // of the shortcut are not swallowed by accident.
    if (
      findEnabled() &&
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.code === 'KeyF'
    ) {
      event.preventDefault()
      void openFind()
    }
  })

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
  }
}

function hasFileDrag(event) {
  return [...(event.dataTransfer?.types ?? [])].includes('Files')
}

function debounce(ms, fn) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

function ripple(event) {
  const circle = document.createElement('span')
  const diameter = Math.max(button.clientWidth, button.clientHeight)
  const radius = diameter / 2
  circle.style.width = circle.style.height = `${diameter}px`
  circle.style.left = `${(event.clientX || event.targetTouches[0].pageX) - button.offsetLeft - radius}px`
  circle.style.top = `${(event.clientY || event.targetTouches[0].pageY) - button.offsetTop - radius}px`
  circle.classList.add('ripple')
  const previous = button.getElementsByClassName('ripple')[0]
  if (previous) previous.remove()
  button.append(circle)
}

/* --------------------------------------------------------- markdown styling */


/* ------------------------------------------------------------------ editor */

/**
 * The editor upstream shipped, with `replace` added so that opening a file is
 * undoable and lands with the caret at the end of the new text.
 */
function Editor(element, highlight) {
  const listeners = []
  const history = []
  let at = -1
  let prev

  const debounceHighlight = debounce(30, () => {
    const pos = save()
    highlight(element)
    restore(pos)
  })

  const shouldRecord = (event) => {
    return (
      !isUndo(event) &&
      !isRedo(event) &&
      event.key !== 'Meta' &&
      event.key !== 'Control' &&
      event.key !== 'Alt' &&
      !event.key.startsWith('Arrow')
    )
  }

  let recording = false
  const debounceRecordHistory = debounce(300, (event) => {
    if (shouldRecord(event)) {
      recordHistory()
      recording = false
    }
  })

  const on = (type, fn) => {
    listeners.push([type, fn])
    element.addEventListener(type, fn)
  }

  on('keydown', (event) => {
    if (event.defaultPrevented) return
    prev = toString()
    if (isUndo(event)) doUndo(event)
    if (isRedo(event)) doRedo(event)
    if (shouldRecord(event) && !recording) {
      recordHistory()
      recording = true
    }
  })

  on('keyup', (event) => {
    if (event.defaultPrevented) return
    if (event.isComposing) return
    if (prev !== toString()) debounceHighlight()
    debounceRecordHistory(event)
  })

  on('paste', () => setTimeout(recordHistory, 10))
  on('cut', () => setTimeout(recordHistory, 10))
  on('beforeinput', (event) => {
    if (event.inputType === 'historyUndo') doUndo(event)
    if (event.inputType === 'historyRedo') doRedo(event)
  })

  /**
   * Flat character offsets of the current selection, so restore() can put it
   * back after the document has been rebuilt.
   *
   * The offsets come from a Range over the text rather than from walking the
   * tree and injecting empty text nodes wherever the selection happened to sit.
   * Those nodes went into the live DOM, which the history then snapshotted and
   * the highlighter then wiped, which is where the "Lost Node" errors in
   * upstream issue #27 come from. Measuring must not mutate the document.
   */
  function save() {
    const s = getSelection()
    const {anchorNode, anchorOffset, focusNode, focusOffset} = s

    const inside = (node) => Boolean(node) && (node === element || element.contains(node))
    if (!inside(anchorNode) || !inside(focusNode)) {
      // There is no selection in the editor to describe: the editor is not
      // focused, or focus sits elsewhere on the page. Recording history still has
      // to work, so fall back to the end of the document.
      const length = (element.textContent ?? '').length
      return {start: length, end: length, dir: '->'}
    }

    const offsetOf = (node, offset) => {
      const range = document.createRange()
      range.setStart(element, 0)
      range.setEnd(node, offset)
      return range.toString().length
    }

    // start tracks the anchor and end the focus, with dir saying which of them
    // comes first, which is the contract restore() expects.
    const start = offsetOf(anchorNode, anchorOffset)
    const end = offsetOf(focusNode, focusOffset)

    return {start, end, dir: start <= end ? '->' : '<-'}
  }

  function restore(pos) {
    const s = getSelection()
    let startNode
    let startOffset = 0
    let endNode
    let endOffset = 0

    if (!pos.dir) pos.dir = '->'
    if (pos.start < 0) pos.start = 0
    if (pos.end < 0) pos.end = 0

    if (pos.dir === '<-') {
      const {start, end} = pos
      pos.start = end
      pos.end = start
    }

    let current = 0

    visit(element, (el) => {
      if (el.nodeType !== Node.TEXT_NODE) return

      const len = (el.nodeValue || '').length
      if (current + len > pos.start) {
        if (!startNode) {
          startNode = el
          startOffset = pos.start - current
        }
        if (current + len > pos.end) {
          endNode = el
          endOffset = pos.end - current
          return 'stop'
        }
      }
      current += len
    })

    if (!startNode) {
      startNode = element
      startOffset = element.childNodes.length
    }
    if (!endNode) {
      endNode = element
      endOffset = element.childNodes.length
    }

    if (pos.dir === '<-') {
      ;[startNode, startOffset, endNode, endOffset] = [endNode, endOffset, startNode, startOffset]
    }

    {
      const startEl = uneditable(startNode)
      if (startEl) {
        const node = document.createTextNode('')
        startEl.parentNode?.insertBefore(node, startEl)
        startNode = node
        startOffset = 0
      }
      const endEl = uneditable(endNode)
      if (endEl) {
        const node = document.createTextNode('')
        endEl.parentNode?.insertBefore(node, endEl)
        endNode = node
        endOffset = 0
      }
    }

    s.setBaseAndExtent(startNode, startOffset, endNode, endOffset)
    element.normalize()
  }

  function uneditable(node) {
    while (node && node !== element) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.getAttribute('contenteditable') === 'false') return node
      }
      node = node.parentNode
    }
  }

  function doUndo(event) {
    preventDefault(event)
    at--
    const record = history[at]
    if (record) {
      // What comes back is the note's text, with the highlighter rebuilding
      // the runs over it the same way set() does. A record is the note, not a
      // snapshot of the DOM: the two cannot disagree because the DOM is
      // derived from the text, and restoring never has to trust markup that
      // was captured from a document since changed.
      element.textContent = record.text
      highlight(element)
      restore(record.pos)
    }
    if (at < 0) at = 0
  }

  function doRedo(event) {
    preventDefault(event)
    at++
    const record = history[at]
    if (record) {
      element.textContent = record.text
      highlight(element)
      restore(record.pos)
    }
    if (at >= history.length) at--
  }

  function recordHistory() {
    // The text, not the rendered markup: the runs are rebuilt from it on
    // every highlight, so two records with the same text are the same note
    // even if the markup between them has since been rendered differently.
    const text = element.textContent
    const pos = save()
    const lastRecord = history[at]
    if (
      lastRecord &&
      lastRecord.text === text &&
      lastRecord.pos.start === pos.start &&
      lastRecord.pos.end === pos.end
    ) {
      return
    }
    at++
    history[at] = {text, pos}
    history.splice(at + 1)
    const maxHistory = 10_000
    if (at > maxHistory) {
      at = maxHistory
      history.splice(0, 1)
    }
  }

  function visit(editor, visitor) {
    const queue = []
    if (editor.firstChild) queue.push(editor.firstChild)
    let el = queue.pop()
    while (el) {
      if (visitor(el) === 'stop') break
      if (el.nextSibling) queue.push(el.nextSibling)
      if (el.firstChild) queue.push(el.firstChild)
      el = queue.pop()
    }
  }

  function isCtrl(event) {
    return event.metaKey || event.ctrlKey
  }

  function isUndo(event) {
    return isCtrl(event) && !event.shiftKey && event.code === 'KeyZ'
  }

  function isRedo(event) {
    return isCtrl(event) && event.shiftKey && event.code === 'KeyZ'
  }

  function toString() {
    return element.textContent || ''
  }

  function preventDefault(event) {
    event.preventDefault()
  }

  function getSelection() {
    return element.getRootNode().getSelection()
  }

  return {
    set(content) {
      element.textContent = content
      highlight(element)
    },

    /**
     * Swap the whole document, keeping the previous text on the undo stack and
     * leaving the caret at the end.
     *
     * Setting textContent does not raise an input event, and the autosave that
     * keeps the note in the URL listens for one, so it is raised explicitly.
     */
    replace(content) {
      recordHistory()
      element.textContent = content
      highlight(element)
      const length = (element.textContent ?? '').length
      restore({start: length, end: length, dir: '->'})
      // The new text goes onto the stack as well as the old, so the next
      // undo lands on this record rather than one below it: without the
      // far side recorded, undo after a swap answers with whatever the
      // stack held before the swap ever happened - or nothing at all.
      recordHistory()
      element.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText'}))
    },

    /**
     * Put text at the caret, or at the end when the caret is not in the
     * editor, replacing any selection.
     *
     * The old text goes onto the undo stack first, exactly as replace() does
     * it, so one undo takes the insertion back out again. The input event at
     * the end is what makes the autosave and the title follow along: as far as
     * the rest of the app is concerned this was a keystroke.
     */
    insert(text) {
      const pos = save()
      recordHistory()
      const before = element.textContent.slice(0, pos.start)
      const after = element.textContent.slice(pos.end)
      element.textContent = before + text + after
      highlight(element)
      const caret = before.length + text.length
      restore({start: caret, end: caret, dir: '->'})
      // Both ends of the change go on the stack, the way a keystroke's
      // keydown and keyup leave both ends behind: undo then lands on the
      // text this insertion replaced rather than on the record below it.
      recordHistory()
      element.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText'}))
    },

    /**
     * Put the selection on a range of the note's text, by the flat offsets
     * save() speaks in, and bring it into view: a selection set from across
     * a dialog does not move the page, and a match found off-screen would
     * otherwise be highlighted invisibly. Focus is deliberately left where
     * it was - the find bar keeps it while the note behind it lights up.
     */
    select(start, end) {
      restore({start, end, dir: '->'})
      const node = getSelection().anchorNode
      const host = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node
      host?.closest('article > *')?.scrollIntoView({block: 'nearest'})
    },

    /**
     * The current selection as the flat offsets restore() takes back, with
     * the text it holds: the find bar seeds its query from a selection the
     * way every find bar the reader has used does.
     */
    selection() {
      const pos = save()
      const body = element.textContent || ''
      return {...pos, text: body.slice(pos.start, pos.end)}
    },

    destroy() {
      for (const [type, fn] of listeners) element.removeEventListener(type, fn)
    },
  }
}

/* ------------------------------------------------------------------- start */

init()

// A module script is deferred, so DOMContentLoaded may already have fired.
if (document.readyState === 'loading') {
  addEventListener('DOMContentLoaded', load)
} else {
  load()
}

// A small programmatic surface, handy from the console and used by the tests.
globalThis.textarea = {
  article,
  editor,
  openFiles,
  openDocument,
  newDocument,
  readNote: () => readNote({article}),
  statsPanel,
  // The folder the menu picks is reached the same way from here: a handle the
  // caller already holds (an OPFS directory in the tests) skips the native
  // picker every automation would have to sit through.
  folderSync: {
    available: folderSyncAvailable,
    connect: connectToDirectory,
    sync: syncNow,
    disconnect: disconnectFolder,
    get status() {
      return folderSyncStatus()
    },
  },
  // The save the input listener holds back for 500ms, callable now. A caller
  // that already knows the note is ready - the reader who just finished
  // typing, or a test that should not spend half a second on every wait -
  // makes the pending save land instead of waiting it out.
  save,
  get state() {
    return state
  },
  get documentId() {
    return documentId()
  },
}
