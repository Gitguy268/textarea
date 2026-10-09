// The page-wide keyboard chords. The editor's own keys (undo, redo) live in
// editor.js; the menu's arrow keys live in menu.js.

import {closeSwitcher, openExport, openFind, openSwitcher, switcherIsOpen} from './features.js'
import {fileInput} from './files.js'
import {findEnabled, switcherEnabled, switcherShortcut} from './prefs.js'

export function initShortcuts() {
  addEventListener('keydown', (event) => {
    const chord = event.metaKey || event.ctrlKey
    if (chord && event.code === 'KeyS') {
      event.preventDefault()
      void openExport()
    }
    if (chord && event.code === 'KeyO') {
      event.preventDefault()
      fileInput.click()
    }
    // The switcher answers its own chord, and nothing at all when it has
    // been switched off - and which chord that is lives in settings, so
    // this compares against the stored choice rather than a name baked in
    // here. Pressing it while the palette is up closes it again.
    if (switcherEnabled() && chord && event.code === `Key${switcherShortcut().toUpperCase()}`) {
      event.preventDefault()
      if (switcherIsOpen()) closeSwitcher()
      else void openSwitcher()
    }
    // Find answers its own chord, and nothing at all when it has been
    // switched off - the browser's find keeps it then, unclaimed. Shift
    // and Alt stay out of the comparison, so the browser's own variants
    // of the shortcut are not swallowed by accident.
    if (findEnabled() && chord && !event.shiftKey && !event.altKey && event.code === 'KeyF') {
      event.preventDefault()
      void openFind()
    }
  })
}
