// Generates small, deterministic PDFs for the browser tests.
//
// Real PDF files would make the assertions depend on fonts and compression of
// whatever produced them. These are written byte by byte so the expected output
// is exact: page 1 is a two column layout, page 2 is a table.

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842

/** Escape a string for a PDF literal string object. */
function literal(text) {
  return text.replace(/([\\()])/g, '\\$1')
}

/** One text run at an absolute position, which is what pdf.js reports as a baseline. */
function run(text, x, y, size = 11) {
  return `BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${literal(text)}) Tj ET`
}

function buildContent(commands) {
  return commands.join('\n')
}

function twoColumnPage() {
  const commands = [run('Column layout test', 50, 780, 16)]
  for (let i = 1; i <= 16; i++) {
    const y = 750 - i * 13
    commands.push(run(`Left line ${i}`, 50, y))
    commands.push(run(`Right line ${i}`, 320, y))
  }
  return buildContent(commands)
}

function tablePage() {
  const rows = [
    ['name', 'qty', 'price'],
    ['apples', '3', '2.50'],
    ['pears', '12', '4.75'],
    ['kiwi', '1', '9.99'],
  ]
  const columns = [50, 200, 320]
  const commands = [run('Table layout test', 50, 780, 16)]
  rows.forEach((cells, row) => {
    cells.forEach((cell, column) => {
      commands.push(run(cell, columns[column], 720 - row * 16))
    })
  })
  return buildContent(commands)
}

/**
 * Assemble a PDF from page content streams.
 *
 * @param {string[]} streams one content stream per page
 * @returns {Buffer}
 */
export function makePdf(streams) {
  const objects = []

  const pageIds = streams.map((_, index) => 3 + index * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => id + ' 0 R').join(' ')}] /Count ${streams.length} >>`

  streams.forEach((stream, index) => {
    const pageId = pageIds[index]
    const contentId = pageId + 1
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 ${3 + streams.length * 2} 0 R >> >> /Contents ${contentId} 0 R >>`
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  })

  const fontId = 3 + streams.length * 2
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'

  let pdf = '%PDF-1.4\n'
  const offsets = []

  for (let id = 1; id < objects.length; id++) {
    if (!objects[id]) continue
    offsets[id] = Buffer.byteLength(pdf)
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }

  const xrefOffset = Buffer.byteLength(pdf)
  const size = objects.length
  pdf += `xref\n0 ${size}\n`
  pdf += '0000000000 65535 f \n'
  for (let id = 1; id < size; id++) {
    pdf +=
      offsets[id] === undefined
        ? '0000000000 65535 f \n'
        : String(offsets[id]).padStart(10, '0') + ' 00000 n \n'
  }
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

/** Two column page followed by a table page. */
export function makeLayoutPdf() {
  return makePdf([twoColumnPage(), tablePage()])
}
