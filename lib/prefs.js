// The reader's switches, each one a key in localStorage.
//
// Every preference is a get/set pair over one `textarea:*` key, and the menu,
// the Settings panel and the code that acts on a switch all read the same
// pair, so no two of them can disagree about which way it points. The key
// names and the stored values are a contract with every browser profile that
// already holds them: nothing here may be renamed.
//
// Storage that refuses (a private window, a full quota) never throws out of
// here. A read answers the shipped default and a write is dropped, so the
// switch still works until the tab closes.

function read(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage refused: the choice is simply not remembered.
  }
}

/**
 * An on/off switch. `shipped` is what a profile that never touched it gets:
 * a switch that ships on is on unless the stored value is 'off', and one that
 * ships off is off unless the stored value is 'on', so a stray value in
 * storage can never flip a default.
 */
function flag(key, shipped) {
  return [
    () => (shipped ? read(key) !== 'off' : read(key) === 'on'),
    (on) => write(key, on ? 'on' : 'off'),
  ]
}

// The three validators are pure and exported for the tests: whatever string
// is in storage, only a value the Settings panel offers ever comes back, so
// no stored string decides which key is intercepted or when a note is purged.

/** @returns {'k' | 'p' | 'e'} */
export const shortcutOf = (stored) => (stored === 'p' || stored === 'e' ? stored : 'k')

/** @returns {'titles' | 'all'} */
export const scopeOf = (stored) => (stored === 'all' ? 'all' : 'titles')

/** @returns {'7' | '30' | '90'} */
export const keepDaysOf = (stored) => (stored === '7' || stored === '90' ? stored : '30')

/** @returns {'updated' | 'created' | 'title'} */
export const sortOf = (stored) => (stored === 'created' || stored === 'title' ? stored : 'updated')

/** A whole number of words from 1 to a million, or 0 for "no goal". */
export function goalOf(stored) {
  const words = Math.floor(Number(stored))
  return words >= 1 && words <= 1_000_000 ? words : 0
}

// Reading PDFs and drawing the note.
export const [twoColumnsEnabled, setTwoColumns] = flag('textarea:two-columns', true)
export const [fileLinksEnabled, setFileLinks] = flag('textarea:file-links', true)
// Off as it ships, so a note written without this fork renders as it always did.
export const [wikilinksEnabled, setWikilinks] = flag('textarea:wikilinks', false)
export const [wikiCreateEnabled, setWikiCreate] = flag('textarea:wikilink-create', true)
export const [tasksEnabled, setTasksEnabled] = flag('textarea:tasks', false)
export const [tasksDoneEnabled, setTasksDoneEnabled] = flag('textarea:tasks-done', false)

// Panels remember whether they were left open.
export const [statsPreferred, setStatsPreferred] = flag('textarea:stats', false)
export const [backlinksPreferred, setBacklinksPreferred] = flag('textarea:backlinks', false)
// A mention is a weaker claim than a link, so it waits to be asked for.
export const [backlinkMentionsEnabled, setBacklinkMentions] = flag('textarea:backlink-mentions', false)
export const [writingPreferred, setWritingPreferred] = flag('textarea:writing', false)
export const [selectionToolsEnabled, setSelectionToolsEnabled] = flag('textarea:writing-selection', false)

/** Each writing tool has its own switch, on unless the reader threw it off. */
export const writingToolEnabled = (id) => read('textarea:writing-tool-' + id) !== 'off'
export const setWritingTool = (id, on) => write('textarea:writing-tool-' + id, on ? 'on' : 'off')

/** The sentence appended to every prompt, empty until one is written. */
export const writingInstructions = () => read('textarea:writing-instructions') ?? ''
export const setWritingInstructions = (value) => write('textarea:writing-instructions', value)

// The quick switcher: on, because until its chord is pressed it is one listener.
export const [switcherEnabled, setSwitcherEnabled] = flag('textarea:switcher', true)
export const switcherScope = () => scopeOf(read('textarea:switcher-scope'))
export const setSwitcherScope = (scope) => write('textarea:switcher-scope', scopeOf(scope))
export const switcherShortcut = () => shortcutOf(read('textarea:switcher-shortcut'))
export const setSwitcherShortcut = (key) => write('textarea:switcher-shortcut', shortcutOf(key))

// Find claims Ctrl/Cmd+F while it is on, and hands the chord back whole when off.
export const [findEnabled, setFindEnabled] = flag('textarea:find', true)
export const [findCase, setFindCase] = flag('textarea:find-case', false)
export const [findWords, setFindWords] = flag('textarea:find-words', false)

// Backup: the front matter is what lets Folder sync recognise a restored file.
export const [backupEnabled, setBackupEnabled] = flag('textarea:backup', true)
export const [backupMetadata, setBackupMetadata] = flag('textarea:backup-metadata', true)
export const [backupEncrypt, setBackupEncrypt] = flag('textarea:backup-encrypt', false)

// Trash: a delete waits here unless the reader says deletes are for good.
export const [trashEnabled, setTrashEnabled] = flag('textarea:trash', true)
export const trashKeep = () => keepDaysOf(read('textarea:trash-keep'))
export const setTrashKeep = (days) => write('textarea:trash-keep', String(days))

// New in this rebuild, all off (or unchanged behaviour) as they ship.
export const [paletteEnabled, setPaletteEnabled] = flag('textarea:palette', false)
export const librarySort = () => sortOf(read('textarea:library-sort'))
export const setLibrarySort = (sort) => write('textarea:library-sort', sortOf(sort))
export const wordGoal = () => goalOf(read('textarea:word-goal'))
export const setWordGoal = (words) => write('textarea:word-goal', String(goalOf(words)))
