# Parity with textarea-master

The source is `textarea-master` at revision `a70829e`. This repository began
as a byte-for-byte copy of it, so every item below started ticked; a tick
stays only while the test named beside it passes. The original's 250 unit
tests and 105 browser tests are all still here, none deleted or weakened.

`U:` names a file in `tests/unit/`, `B:` a test title in `tests/browser/run.js`.

## Note and URL

- [x] Plain hash codec, byte-compatible with upstream links — U: `share.test.js`; B: *the editor boots and shares a note through the URL*
- [x] Encrypted `#!` links, PBKDF2 + AES-GCM, password asked on load — U: `share.test.js`; B: *an encrypted link round trips through a reload*
- [x] Plaintext never autosaved behind an encrypted link — B: *an encrypted note is never autosaved into a plaintext hash*
- [x] Remove encryption — B: *removing encryption rewrites the link in the clear*
- [x] Style sanitiser — B: *a shared link cannot smuggle a style that covers the interface*
- [x] `replaceState` only; theme in `?theme=` survives — B: *a theme in the url survives a reload without touching the note*
- [x] First `#` heading names the tab — B: *only a first level one heading names the document*
- [x] `#new` — B: *the New menu link opens a tab with an empty note*, *following a #new link clears the note in the same tab*
- [x] Limits: PBKDF2 1,000–5,000,000 iterations, inflate 64 MiB, style 4,096 chars — U: `share.test.js`

## Editor and markdown

- [x] Caret survives re-highlighting — B: *the caret survives the editor rebuilding its own DOM*, *the caret stays between formatted runs*
- [x] Own undo/redo — B: *undo after typing leaves the note as it was*, *undo puts a selected run back under the cursor*, *undo and redo bring a typed html marker back as text*
- [x] Markdown tree: headings, bold, italic, strike, code, fences, lists — U: `markdown.test.js`; B: *the rendered markup still looks like it used to*, *a bulleted list is drawn as one and keeps its text*
- [x] Links: URLs, `mailto:`, `google:` — U: `links.test.js`; B: *an email address in the note is a link to the mail client*, *google: in the note is a link to the search results*, *links in the note open without handing back window.opener*
- [x] Wikilinks, off by default, create-on-miss — B: *a wikilink opens the note its title names, and is off until it is switched on*
- [x] Tasks as checkboxes — U: `markdown.test.js`; B: *a task in the note draws as a checkbox and ticks off in place*

## Find, panels, switcher

- [x] Find and replace — U: `find.test.js`; B: *find claims Ctrl+F, walks the matches, and replaces one or all*, *the find switch and its two defaults are the reader’s, and persist*
- [x] Backlinks panel — U: `backlinks.test.js`; B: *a backlinks panel counts the notes that reach this one, and only while it is on*
- [x] Tasks panel — B: *the tasks panel gathers every open task in the library and opens its note*
- [x] File links — U: `file-links.test.js`; B: the four *file link* tests
- [x] Quick switcher, K/P/E, title or body scope — U: `switcher.test.js`; B: *the quick switcher jumps to a note from the keyboard and can be switched off*
- [x] Statistics panel — U: `stats.test.js`; B: *the statistics panel counts the note and follows along as it changes*, *the statistics panel survives a reload when it was left open*

## Files in

- [x] Text, BOM, Windows-1252 — U: `open.test.js`; B: *opens a plain text file and puts it in the editor*, *reads a UTF-8 file with a byte order mark*, *reads a Windows-1252 file and says so*
- [x] Replace is confirmed — B: *warns when the editor already holds text instead of dropping it silently*
- [x] PDF, two columns, no text layer — U: `pdf-layout.test.js`; B: *extracts a two column PDF and a table from a real PDF*, *reports a PDF with no text layer instead of opening an empty note*, *the two column toggle flips and persists*
- [x] ZIP in, password, read limits — B: *reopens an encrypted ZIP through the file input*, *a wrong ZIP password is reported rather than silently emptying the note*, *an archive past the read limits is refused instead of decompressed*
- [x] Drag and drop — B: *drag and drop shows the overlay and opens the file*, *a text drag inside the editor is not hijacked by the file handler*
- [x] PWA file handler and `launch_handler` — `manifest.json`; U: `sw.test.js`

## Files out

- [x] Nine formats, one converter — U: `formats.test.js`; B: *exports every format and writes the expected bytes*, *an exported HTML page is self contained and renders the note*
- [x] Four destinations — B: *the Export panel offers four destinations and names the button for each*, *Copy puts the converted note on the clipboard in one click*, *copying the link says so when the clipboard refuses*
- [x] File System Access with download fallback — B: *uses the File System Access API when the browser offers it*
- [x] ZIP, AES-256 — B: *writes an AES-256 encrypted ZIP that a wrong password cannot open*, *an archive with only the password ticked is refused*, *writes a plain ZIP when encryption is declined*
- [x] QR, 2,331-byte cap — U: `qr.test.js`; B: *the QR panel draws the note link and saves it as a vector file*, *a note too long for a QR code says so and still offers the link*

## Library, trash, backup, folder sync

- [x] Library row per note — U: `library.test.js`; B: *a note is kept in the library as it is typed, and reopens after a reload*, *a note opened from a link is in the library without being typed*
- [x] Documents panel — B: *the documents panel opens a stored note and deletes another*, *the documents panel searches titles and text*
- [x] Trash, 7/30/90 days — B: the three *trash* tests
- [x] Backup — U: `backup.test.js`; B: the three *Backup* tests
- [x] Front matter round trip — U: `front-matter.test.js`
- [x] Folder sync and its budgets — U: `folder-sync.test.js`; B: the sixteen *folder sync:* tests

## Appearance

- [x] Theme — U: `theme.test.js`; B: *the theme follows the system until the menu says otherwise*
- [x] Glass — U: `glass.test.js`; B: *the glass row switches the refraction on the floating panels*
- [x] Accent, font, size, spacing — U: `appearance.test.js`; B: *the appearance choices reach the stylesheet and survive a reload*
- [x] Font shelf, 10 fonts, 5 MB, GitHub only — U: `fonts.test.js`; B: *a custom font file joins the note fonts, applies, survives a reload, and comes off*, *a font can be imported from a public GitHub link, and only from GitHub*

## Writing tools

- [x] Prompt, tools, 24,000-character cut — U: `writing-tools.test.js`
- [x] Model chunks verified before use — U: `gemma.test.js`; `npm run check:model` for the real chain
- [x] Panel, selection, Replace with one undo — B: the four *writing* tests

## Speech to text

Added to both repositories at once, so it has no upstream to be compared with; the tests are the same in each.

- [x] Chunks verified and stitched, language list, mono mix — U: `whisper.test.js`
- [x] Panel through a fake engine: language, progress, Cancel, Insert — B: *the speech panel transcribes a file through an injected engine and hands the text back*
- [x] Menu row, no engine before audio, language remembered — B: *the speech to text row opens its panel without an engine, and the language is remembered*
- [x] The real chain: file, microphone, offline — `npm run check:whisper`

## Send to a device

Added to both repositories at once, like speech to text; the tests are the same in each.

- [x] Pairing codes, chunked transfer, accept first, byte cap, a webcam-sized symbol jsQR reads — U: `nearby.test.js`
- [x] Two tabs over WebRTC, paired through the panels, accepted — B: *Send to a device carries a note to another tab over WebRTC, after it accepts* (skipped on macOS, where the firewall drops Playwright's peer traffic; passes under headless Brave)
- [x] A code that is not one is refused — B: *Receive from a device turns away a code that is not one*
- [ ] Camera scan on real devices — manual

## Menu, dialogs, settings

- [x] Menu roles and keys — B: *the arrow keys walk the menu*, *the menu closes when the keyboard tabs away from it*, *the editor and the menu button have accessible names*
- [x] Notification bubble — B: *notifications are announced, errors more insistently*
- [x] Settings rows — B: *a settings option can be a line of text, written once and read back*
- [x] Icons — U: `icons.test.js`; B: *every icon the menu and panels use resolves to a drawing*
- [x] Storage names unchanged (`textarea:*`, the four databases, the three caches) — every browser test that reloads

## PWA, boot, repository

- [x] Service worker — U: `sw.test.js`; B: *the service worker registers and precaches the shell*, *pdf.js is fetched on demand and cached, not precached*, *the model is fetched on demand and cached, never precached*
- [x] Boot stays small — B: *startup: panels rarely opened are fetched when their entry is used*; `node tests/perf.js`
- [x] Security headers — U: `headers.test.js`; B: *the server sends the security headers*
- [x] Clean console — B: *an unhandled rejection in a page reaches the error gate*, *nothing logged an error along the way*
- [x] Docs do not drift — U: `llms.test.js`
- [x] Vendored code and model identical to the original — `diff -r` against the original, SHA-256 against `models/manifest.json`

## Added by the rebuild

Not parity, but held to the same standard: each has a test.

- [x] Modules split out of `app.js`; shell lists every one — U: `sw.test.js`, `prefs.test.js`
- [x] Save on hide and on a real tab close — B: *a tab hidden mid-pause saves at once instead of waiting the pause out*
- [x] Library write failures are reported — B: *a library that stops keeping notes says so, once*
- [x] Early long-link notice — U: `share.test.js`
- [x] Patching renderer — B: *an edit redraws only the part of the note it touched*
- [x] WCAG A/AA under axe, landmark, reduced motion, keyboard reach — B: *axe finds no WCAG A or AA failure in either theme, on the page or in its panels* and the three tests after it
- [x] Command palette — B: *the command palette is off until asked for, then lists the menu and runs a row*
- [x] Library sort — U: `library.test.js`; B: *the documents panel sorts by edit, by creation and by title, and remembers which*
- [x] Word-count goal — U: `stats.test.js`; B: *a word-count goal shows in the statistics only once one is set*
- [x] Library as one Markdown file — U: `backup.test.js`; B: *Backup can write the whole library as one Markdown file instead*
- [x] Print stylesheet — B: *on paper there is the note and nothing else*
- [x] Model download progress and cancel — U: `gemma.test.js`; B: *a model download can be cancelled, and cancelling is not an error*
- [x] Lazy file readers, export formats and sync engine — B: *startup: panels rarely opened are fetched when their entry is used*, *a reader who never asked for folder sync never loads it, and gets no database for it*
- [x] A returning tab reopens its unfinished text — B: *a tab that closed mid-keystroke reopens on what was typed, without a second copy*
- [x] Glass as a material, and on the menu button — B: *the glass row switches the refraction on the floating panels*, *a label on glass still reads 4.5:1 with the note’s own ink behind it*
- [x] Tags — U: `markdown.test.js`, `filter.test.js`; B: *a tag is drawn in the note, counted in My documents, and filters the list*
- [x] Pin — U: `library.test.js`; B: *a pinned note leads the list and stays pinned while it is typed in*
- [x] Archive — U: `filter.test.js`; B: *an archived note leaves the list until the archive is asked for*
- [x] Activity calendar — U: `filter.test.js`; B: *the calendar lights the days notes were written, and a day filters the list*
- [x] Quick capture — B: *a jotted note goes into the library without leaving the panel*
- [x] Timeline and saved filters — U: `prefs.test.js`; B: *the timeline and a saved filter are remembered across a reload*
- [x] Firefox and WebKit — the whole suite under `BROWSER=firefox` / `BROWSER=webkit`
