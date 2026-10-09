// The editor: a contenteditable element whose text is the note, with its own
// undo stack, and a highlighter that redraws the markup over that text.

export function debounce(ms, fn) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

/**
 * The editor upstream shipped, with `replace` added so that opening a file is
 * undoable and lands with the caret at the end of the new text.
 */
export function Editor(element, highlight) {
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
