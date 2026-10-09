// Rebuild readable text from the positioned runs a PDF page gives us.
//
// A PDF has no notion of a line, a word or a paragraph. It has text-showing
// operators that place a run of glyphs at an exact point on the page, and the
// reader has to infer the structure back. pdf.js hands us the result of that
// first pass:
//
//   { str, width, height, transform: [a, b, c, d, x, y], hasEOL, dir }
//
// where x/y are the baseline start of the run and width/height its advance and
// em size in PDF points (1/72 inch, y growing upwards).
//
// The algorithm is the one behind JonathanLink/PDFLayoutTextStripper, a Java
// class extending Apache PDFBox's PDFTextStripper: it groups runs into lines by
// baseline, sorts each line left to right, inserts word breaks from horizontal
// gaps and paragraph breaks from vertical gaps, so tables and columns survive
// the round trip. That class cannot run in a browser, so the geometry is
// reimplemented here over pdf.js items. See vendor/README.md.
//
// Everything in this module is pure: it takes items, it returns a string.

const COLUMN_MIN_ITEMS = 30
const COLUMN_MIN_SHARE = 0.3
const COLUMN_MAX_STRADDLE = 0.1
const COLUMN_MIN_GUTTER_EM = 0.6
// Padding stops growing past this many spaces, so a very wide column gap does
// not turn into a screenful of whitespace.
const MAX_PAD_SPACES = 40

/**
 * Runs whose height is 0 (pdf.js emits these for some space-only runs) would
 * otherwise poison every threshold that scales with font size, so they fall back
 * to the page's median height.
 */
function medianHeight(items) {
  const heights = items
    .map((item) => item.height)
    .filter((height) => height > 0.4)
    .sort((a, b) => a - b)
  if (heights.length === 0) return 12
  return heights[heights.length >> 1]
}

/**
 * pdf.js runs carry the full transform matrix. Text drawn on an axis-aligned
 * baseline has b === 0 and c === 0; anything else is rotated or mirrored, and
 * the line grouping below would scramble it.
 */
function isUpright(item) {
  const t = item.transform
  return Math.abs(t[1]) < 0.01 && Math.abs(t[2]) < 0.01 && t[3] > 0
}

function toRun(item, fallbackHeight) {
  const height = item.height > 0.4 ? item.height : fallbackHeight
  return {
    str: item.str,
    x: item.transform[4],
    y: item.transform[5],
    width: item.width > 0 ? item.width : 0,
    height,
    eol: item.hasEOL === true,
  }
}

/**
 * Whitespace-only runs are dropped before any geometry happens.
 *
 * pdf.js reports the spaces between words as runs of their own, and in a two
 * column layout the gutter between the columns is one long such run: in the test
 * fixture it is a single space 222pt wide. It looks like text, but it carries no
 * character, and its width spans exactly the boundary we are trying to find, so
 * leaving it in makes every candidate boundary look straddled and no columns are
 * ever detected. The position of the run that follows already encodes the gap,
 * so nothing is lost by discarding these.
 */
function hasContent(items) {
  return (items ?? []).filter((item) => typeof item?.str === 'string' && item.str.trim().length > 0)
}

/**
 * pdf.js text items -> the flat run shape the geometry below works with.
 * Exported so the helpers can be exercised directly in tests.
 */
export function normalizeItems(items, fallbackHeight = 12) {
  return hasContent(items).map((item) => toRun(item, fallbackHeight))
}

/**
 * Vertical tolerance for "is this run on the same line as the previous one".
 * Sups and subscripts sit a few points off the baseline and must not start a
 * new line, hence a fraction of the font size rather than a fixed 1pt.
 */
function lineTolerance(height) {
  return Math.max(1, Math.min(0.5 * height, 4))
}

/**
 * Group runs into lines, top down. Runs are sorted by descending baseline (PDF y
 * grows upwards) and a new line starts whenever the baseline moves further than
 * the tolerance.
 *
 * pdf.js does not promise to hand items over in reading order, so the sort lives
 * here rather than being assumed of the caller.
 */
export function groupLines(runs, tolerance = null) {
  const lines = []
  let current = null
  let currentY = 0
  let currentHeight = 0

  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x)

  for (const run of sorted) {
    const tol = tolerance ?? lineTolerance(Math.max(run.height, currentHeight))
    if (current === null || Math.abs(run.y - currentY) > tol) {
      current = {y: run.y, height: run.height, runs: [run]}
      currentY = run.y
      currentHeight = run.height
      lines.push(current)
    } else {
      current.runs.push(run)
      currentY = (currentY * (current.runs.length - 1) + run.y) / current.runs.length
      currentHeight = Math.max(currentHeight, run.height)
    }
  }

  for (const line of lines) line.runs.sort((a, b) => a.x - b.x)
  return lines
}

/**
 * Join the runs of one line.
 *
 * Prose collapses every wide gap to a single space. Tables pad instead: the
 * number of spaces is derived from the gap so columns line up, which is what
 * makes an extracted table readable as text rather than a run-on sentence.
 */
export function joinRuns(runs, em = 12, {pad = false} = {}) {
  const spaceWidth = Math.max(0.25 * em, 1)
  let line = ''

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    if (i > 0) {
      const prev = runs[i - 1]
      const gap = run.x - (prev.x + prev.width)
      const reference = Math.min(prev.height, run.height)
      const needsSpace = gap > 0.25 * reference
      const alreadySpaced = /\s$/.test(line) || /^\s/.test(run.str)
      if (needsSpace && !alreadySpaced) {
        // Only a gap of at least one em is unmistakably a column separation; a
        // narrower one is an ordinary word space and padding it out would just
        // look like a typo.
        const isColumn = gap >= reference
        const count = pad && isColumn ? Math.min(MAX_PAD_SPACES, Math.max(1, Math.round(gap / spaceWidth))) : 1
        line += ' '.repeat(count)
      }
    }
    line += run.str
  }

  return line.replace(/\s+$/, '')
}

/**
 * Detect a two-column page by looking for a vertical gutter that no run
 * crosses. Candidate boundaries are scanned across the middle of the text block
 * and scored by how evenly they split the runs, with hard requirements on the
 * gutter width and on how many runs straddle it so that single-column pages with
 * wide margins, figures or centred titles are left alone.
 *
 * Returns the boundary's x coordinate, or null.
 */
export function detectColumnBoundary(runs, em = 12) {
  if (runs.length < COLUMN_MIN_ITEMS) return null

  let xMin = Infinity
  let xMax = -Infinity
  for (const run of runs) {
    if (run.x < xMin) xMin = run.x
    if (run.x + run.width > xMax) xMax = run.x + run.width
  }

  const textWidth = xMax - xMin
  if (textWidth <= 0) return null

  let best = null
  for (let fraction = 0.35; fraction <= 0.65; fraction += 0.02) {
    const boundary = xMin + textWidth * fraction
    let left = 0
    let right = 0
    let straddle = 0
    let leftEdge = -Infinity
    let rightEdge = Infinity

    for (const run of runs) {
      const runRight = run.x + run.width
      if (runRight <= boundary) {
        left++
        if (runRight > leftEdge) leftEdge = runRight
      } else if (run.x >= boundary) {
        right++
        if (run.x < rightEdge) rightEdge = run.x
      } else {
        straddle++
      }
    }

    if (straddle > COLUMN_MAX_STRADDLE * runs.length) continue
    if (left / runs.length < COLUMN_MIN_SHARE) continue
    if (right / runs.length < COLUMN_MIN_SHARE) continue
    if (boundary - leftEdge < COLUMN_MIN_GUTTER_EM * em) continue
    if (rightEdge - boundary < COLUMN_MIN_GUTTER_EM * em) continue

    const score = Math.min(left, right)
    if (best === null || score > best.score) best = {score, boundary}
  }

  return best?.boundary ?? null
}

function assignColumn(run, boundary) {
  const runRight = run.x + run.width
  if (runRight <= boundary) return 0
  if (run.x >= boundary) return 1
  // Straddles the gutter: give it to whichever side it overlaps more.
  return run.x + run.width / 2 < boundary ? 0 : 1
}

/**
 * Is this page a table rather than prose?
 *
 * The distinguishing feature is not the spacing but the shape of the lines: a
 * table row is split into cells by a horizontal gap several ems wide, while
 * prose is broken by gaps of a fraction of an em. That matters because table rows
 * are spaced like paragraphs are, so a rule that inserts a blank line on a large
 * vertical gap would shred a table into fragments.
 */
function isTableLike(lines, em) {
  if (lines.length < 3) return false
  let wide = 0
  for (const line of lines) {
    let maxGap = 0
    for (let i = 1; i < line.runs.length; i++) {
      const prev = line.runs[i - 1]
      maxGap = Math.max(maxGap, line.runs[i].x - (prev.x + prev.width))
    }
    if (maxGap > 3 * em) wide++
  }
  return wide / lines.length >= 0.3
}

/**
 * Every detected line becomes one output line: a PDF stores glyph positions, not
 * line breaks, so the line structure is being rebuilt here. A paragraph break is
 * added only where the vertical gap says there is one.
 */
function linesToText(lines, em) {
  // Prose leads at roughly 1.2 em and breaks paragraphs at 1.5 em or more; table
  // rows are spaced just as loosely, so they get a much higher bar before a blank
  // line is inserted.
  const tableLike = isTableLike(lines, em)
  const ratio = tableLike ? 2.4 : 1.35

  const out = []
  let previous = null

  for (const line of lines) {
    const text = joinRuns(line.runs, em, {pad: tableLike})
    if (text === '' && out.length > 0) {
      previous = line
      continue
    }
    if (previous !== null) {
      const gap = previous.y - line.y
      const reference = Math.max(previous.height, line.height)
      if (gap > ratio * reference && gap > 1.5) out.push('')
    }
    out.push(text)
    previous = line
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/**
 * Turn one page's items into text.
 *
 * @param {Array} items  pdf.js text content items for a single page
 * @param {object} [options]
 * @param {boolean} [options.twoColumns]  auto-detect and split columns (default true)
 * @returns {{text: string, columns: number}}
 */
export function itemsToPageText(items, options = {}) {
  const {twoColumns = true} = options

  const candidates = hasContent(items)
  if (candidates.length === 0) return {text: '', columns: 0}

  const em = medianHeight(candidates)
  const upright = candidates.filter(isUpright)

  // Rotated or mirrored text: guessing a reading order would do more harm than
  // good, so emit the runs in the order the file lists them.
  if (upright.length < candidates.length * 0.9) {
    return {
      text: candidates.map((item) => item.str + (item.hasEOL ? '\n' : '')).join(''),
      columns: 0,
    }
  }

  const runs = upright.map((item) => toRun(item, em))

  if (twoColumns) {
    const boundary = detectColumnBoundary(runs, em)
    if (boundary !== null) {
      const left = []
      const right = []
      for (const run of runs) {
        ;(assignColumn(run, boundary) === 0 ? left : right).push(run)
      }
      const text = [linesToText(groupLines(left), em), linesToText(groupLines(right), em)]
        .filter((part) => part.trim() !== '')
        .join('\n\n')
      if (text.trim() !== '') return {text, columns: 2}
    }
  }

  return {text: linesToText(groupLines(runs), em), columns: 1}
}

/**
 * Assemble a whole document. Pages are separated by a form feed so the boundary
 * survives editing, and by a blank line, which is what most editors expect when
 * text is pasted in.
 */
export function pagesToText(pages, options = {}) {
  return pages
    .map((page) => (typeof page === 'string' ? page : itemsToPageText(page, options).text))
    .map((text) => text.trim())
    .join('\n\f\n\n')
}

/**
 * A PDF with no text layer (a scan, or a pure image) yields nothing but
 * whitespace. Callers use this to tell the user what actually went wrong instead
 * of opening an empty note.
 */
export function hasExtractableText(text) {
  return typeof text === 'string' && text.replace(/\s/g, '').length > 0
}
