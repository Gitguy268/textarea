// The writing tools panel: what the model in ../models/ is actually for.
//
// A reader picks a tool, presses Run, and the note on screen goes through
// Gemma-3-270M on this device - no request leaves the machine, which is the
// whole reason the weights are committed to the repository rather than
// fetched. The panel draws the choice and the result; it never touches the
// model itself. Everything it needs from the app arrives as a function:
// `ensureModel` builds (or answers from cache) an engine with a `run`,
// `getText` reads the note, `getSelection`/`selectionAware` say whether the
// reader's selection stands in for that note, `getTools`/`getInstructions`
// read the settings that decide which tools exist and what extra
// instruction rides along, and `onReplace` puts a result back - the second
// argument naming the selection it belongs to, when it belongs to one -
// confirmation and saving being the app's business, the same way opening a
// link from a wikilink is.
//
// The selection is read when Run is pressed and kept, not re-read when
// Replace is: the reader replaces what was run on, even if the caret has
// wandered since, and one undo takes the whole thing back.
//
// That seam is deliberate: the browser test drives the entire panel through
// a fake engine, so the wasm, the 241 MB of weights and a slow first fetch
// are not what stands between a broken panel and a green suite. The real
// engine lives in lib/gemma.js and arrives through the same door.

import {icon} from './dialog.js'

/**
 * The tools the panel knows how to ask for, in the order they are offered.
 *
 * Each instruction is written for a small model: one job, stated
 * imperatively, plus the line that stops it from translating the reader's
 * prose into English on the way out.
 */
export const TOOLS = [
  {
    id: 'improve',
    label: 'Improve wording',
    instruction:
      'Rewrite the text so it reads better: smoother phrasing, clearer sentences, ' +
      'the same meaning, and the same language as the original.',
  },
  {
    id: 'shorten',
    label: 'Shorten',
    instruction:
      'Shorten the text, keeping every fact and dropping only what is redundant. ' +
      'Keep the same language as the original.',
  },
  {
    id: 'summarize',
    label: 'Summarize',
    instruction:
      'Summarize the text in a few sentences that make sense on their own. ' +
      'Use the same language as the original.',
  },
  {
    id: 'fix',
    label: 'Fix spelling & grammar',
    instruction:
      'Fix every spelling and grammar mistake. Change nothing else: the wording ' +
      'is the author’s.',
  },
  {
    id: 'casual',
    label: 'Make more casual',
    instruction:
      'Rewrite the text in a casual, conversational tone, keeping its meaning. ' +
      'Use the same language as the original.',
  },
]

/**
 * The most note text one prompt will carry.
 *
 * A 270M model on a modest context is not a place to find out the hard way
 * that a novel was pasted in: the text is cut here, in plain sight, and the
 * panel says it did - a silent cut would be the tool lying about what it
 * worked on.
 */
export const NOTE_LIMIT = 24_000

/**
 * The messages for one tool run.
 *
 * @param {string} toolId one of TOOLS
 * @param {string} text the note on screen
 * @param {string} [instructions] the reader's custom instructions, if any
 * @returns {{messages: Array<{role: string, content: string}>,
 *   truncated: boolean}}
 * @throws {Error} for a tool id the panel does not ship
 */
export function buildPrompt(toolId, text, instructions = '') {
  const tool = TOOLS.find((candidate) => candidate.id === toolId)
  if (!tool) throw new Error(`unknown writing tool: ${toolId}`)

  const body = String(text ?? '')
  const truncated = body.length > NOTE_LIMIT
  const used = truncated ? body.slice(0, NOTE_LIMIT) : body

  const extra = String(instructions ?? '').trim()
  const user = [`Text:\n\n${used}`, extra ? `Extra instructions: ${extra}` : null]
    .filter(Boolean)
    .join('\n\n')

  return {
    truncated,
    messages: [
      {
        role: 'system',
        content:
          `${tool.instruction}\n\n` +
          'Reply with the finished text only: no preamble, no explanation, ' +
          'and no quotation marks around it.',
      },
      {role: 'user', content: user},
    ],
  }
}

/**
 * Build the panel and return the handful of methods the app needs.
 *
 * The panel is built once and hidden rather than built per opening, like the
 * statistics and backlinks panels: the tool buttons are redrawn on every
 * open from whatever settings say now, so a tool switched off in settings is
 * gone from the row the next time anyone looks, and the active tool falls
 * back to the first one still offered.
 *
 * @param {object} options
 * @param {(onProgress: (message: string) => void) =>
 *   Promise<{run: (messages: Array<{role: string, content: string}>) =>
 *   Promise<string>}>} options.ensureModel
 *   build or answer the engine, reporting progress into the status line
 * @param {() => string} options.getText the note on screen
 * @param {() => {start: number, end: number, text: string}} [options.getSelection]
 *   the reader's selection, in the same flat offsets the note is read in
 * @param {() => boolean} [options.selectionAware]
 *   the reader's switch: work on the selection when there is one
 * @param {() => string[]} options.getTools the enabled tool ids
 * @param {() => string} options.getInstructions the extra instructions
 * @param {(text: string, selection: {start: number, end: number} | null) =>
 *   void} options.onReplace a result to put back, and the selection it
 *   belongs to - null when the run was the whole note
 * @param {Document} [options.owner]
 * @returns {{element: HTMLElement, open: () => void, close: () => void,
 *   refresh: () => void, toggle: () => boolean, isOpen: () => boolean,
 *   onDismiss: (handler: () => void) => void}}
 */
export function createWritingTools({
  ensureModel,
  getText,
  getSelection = () => ({start: 0, end: 0, text: ''}),
  selectionAware = () => false,
  getTools,
  getInstructions,
  onReplace,
  owner = document,
} = {}) {
  const panel = owner.createElement('aside')
  panel.id = 'writing-panel'
  panel.setAttribute('role', 'group')
  panel.setAttribute('aria-label', 'Writing tools')
  panel.hidden = true

  const head = owner.createElement('div')
  head.className = 'writing-head'

  const title = owner.createElement('p')
  title.className = 'writing-title'
  title.textContent = 'Writing tools'

  const closeButton = owner.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'writing-close'
  closeButton.setAttribute('aria-label', 'Close writing tools')
  closeButton.append(icon('icon-close', 16))
  head.append(title, closeButton)

  const extra = owner.createElement('p')
  extra.className = 'writing-extra'
  extra.hidden = true

  const tools = owner.createElement('div')
  tools.className = 'writing-tools'
  tools.setAttribute('role', 'group')
  tools.setAttribute('aria-label', 'Tools')

  const run = owner.createElement('button')
  run.type = 'button'
  run.className = 'dialog-button dialog-button-primary writing-run'
  run.textContent = 'Run'

  const status = owner.createElement('p')
  status.className = 'writing-status'
  status.setAttribute('aria-live', 'polite')

  const result = owner.createElement('div')
  result.className = 'writing-result'
  result.hidden = true

  const output = owner.createElement('p')
  output.className = 'writing-output'

  const replace = owner.createElement('button')
  replace.type = 'button'
  replace.className = 'dialog-button dialog-button-primary writing-replace'
  replace.textContent = 'Replace the note'

  result.append(output, replace)

  panel.append(head, extra, tools, run, status, result)

  /** The tool the next Run will use, kept as an id so a redraw can find it. */
  let active = TOOLS[0].id
  /** A Run is in flight; nothing starts a second one. */
  let running = false
  /**
   * The selection the visible result belongs to, captured when that Run
   * started. Replace hands it back with the answer; null for a run that was
   * the whole note.
   */
  let planned = null
  let dismissed = null

  const setStatus = (text, {error = false} = {}) => {
    status.textContent = text
    status.classList.toggle('error', error)
  }

  /**
   * What the next Run will work on: the selection when the reader has asked
   * for selection-aware tools and there is one, the note otherwise. The
   * offsets ride along so Replace can put the answer back where the Run
   * looked, whatever has happened to the caret in the meantime.
   *
   * Whitespace-only selections are no selection: a stray drag across a line
   * break should not quietly halve the note the model is asked about.
   */
  const working = () => {
    const selection = getSelection()
    if (selectionAware() && selection.text.trim()) {
      return {selection: {start: selection.start, end: selection.end}, text: selection.text}
    }
    return {selection: null, text: getText()}
  }

  /**
   * Redraw the tool row from the settings and work out whether Run may be
   * pressed. Returns false when there is nothing to run at all - no tools
   * switched on - which is a settings answer, not a note one.
   */
  const syncState = () => {
    const enabled = getTools()
    const available = TOOLS.filter((tool) => enabled.includes(tool.id))

    tools.replaceChildren()
    if (!available.some((tool) => tool.id === active)) active = available[0]?.id ?? null

    for (const tool of available) {
      const button = owner.createElement('button')
      button.type = 'button'
      button.className = 'writing-tool'
      button.dataset.tool = tool.id
      button.textContent = tool.label
      button.setAttribute('aria-pressed', String(tool.id === active))
      button.addEventListener('click', () => {
        active = tool.id
        for (const peer of tools.querySelectorAll('.writing-tool')) {
          peer.setAttribute('aria-pressed', String(peer.dataset.tool === active))
        }
      })
      tools.append(button)
    }

    const instruction = String(getInstructions() ?? '').trim()
    extra.textContent = instruction ? `Extra: ${instruction}` : ''
    extra.hidden = !instruction

    if (!available.length) {
      setStatus('No tools are switched on in settings.')
      return false
    }
    if (!working().text.trim()) {
      setStatus('There is nothing on screen to work on.')
      return false
    }
    if (!running) setStatus('')
    return true
  }

  const runTool = async () => {
    if (running || !syncState()) return

    const {selection, text} = working()
    const {messages, truncated} = buildPrompt(active, text, getInstructions())
    running = true
    run.disabled = true
    setStatus(truncated ? 'Working from the first 24,000 characters…' : 'Writing…')

    try {
      const engine = await ensureModel((message) => {
        if (running) setStatus(message)
      })
      const answer = await engine.run(messages)
      output.textContent = answer
      // The button says which of the two the answer is for, so nobody has to
      // remember what the selection was when they pressed Run - and planned
      // keeps those offsets beside the answer they belong to. Set here, not
      // when the Run starts: a failed Run leaves the previous result, and
      // its offsets, on show.
      replace.textContent = selection ? 'Replace the selection' : 'Replace the note'
      planned = selection
      result.hidden = false
      setStatus('')
    } catch (error) {
      setStatus(error?.message || String(error), {error: true})
    } finally {
      running = false
      refresh()
    }
  }

  run.addEventListener('click', () => void runTool())

  replace.addEventListener('click', () => {
    const answer = output.textContent
    if (!answer) return
    result.hidden = true
    const selection = planned
    planned = null
    onReplace(answer, selection)
  })

  closeButton.addEventListener('click', () => {
    panel.hidden = true
    dismissed?.()
  })

  /**
   * Re-read everything the panel does not own - the note, the tools, the
   * instructions - and work out whether Run may be pressed. The app calls
   * this on every note change, the way the statistics panel is pushed its
   * counts: without it a button disabled for an empty note would have no
   * way to notice the reader has typed one, and would be a dead end.
   */
  const refresh = () => {
    const available = syncState()
    run.disabled = running || !available
  }

  const open = () => {
    panel.hidden = false
    result.hidden = true
    refresh()
  }

  const close = () => {
    panel.hidden = true
  }

  return {
    element: panel,
    open,
    close,
    refresh,

    toggle() {
      if (panel.hidden) open()
      else close()
      return !panel.hidden
    },

    isOpen() {
      return !panel.hidden
    },

    onDismiss(handler) {
      dismissed = handler
    },
  }
}
