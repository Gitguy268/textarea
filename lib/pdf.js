// Lazy access to pdf.js, plus the extraction loop.
//
// pdf.js is ~1.7 MB with its worker, so it is only fetched when a PDF is
// actually opened. The service worker caches it on first use.

import {hasExtractableText, itemsToPageText, pagesToText} from './pdf-layout.js'

const PDFJS_URL = new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url)
const WORKER_URL = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url)
const CMAP_URL = new URL('../vendor/pdfjs/cmaps/', import.meta.url)
const FONTS_URL = new URL('../vendor/pdfjs/standard_fonts/', import.meta.url)

let library = null

export class PdfPasswordError extends Error {
  constructor() {
    super('This PDF is password protected')
    this.name = 'PdfPasswordError'
    this.passwordRequired = true
  }
}

export class PdfEmptyError extends Error {
  constructor() {
    super('No text found in this PDF. It is most likely a scan, which needs OCR.')
    this.name = 'PdfEmptyError'
  }
}

async function getPdfjs() {
  library ??= (async () => {
    const pdfjs = await import(PDFJS_URL.href)
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL.href
    return pdfjs
  })().catch((error) => {
    library = null
    throw error
  })
  return library
}

/**
 * Collect a page's text content.
 *
 * `page.getTextContent()` is deliberately avoided: pdf.js implements it with
 * `for await (... of readableStream)`, and Safari has no
 * `ReadableStream.prototype[Symbol.asyncIterator]` before Safari 27, so the call
 * throws on every PDF there (mozilla/pdf.js#21557). Reading the same stream
 * through getReader() works everywhere.
 */
async function readPage(page) {
  const items = []
  const reader = page.streamTextContent().getReader()
  try {
    for (;;) {
      const {value, done} = await reader.read()
      if (done) break
      if (value?.items) items.push(...value.items)
    }
  } finally {
    reader.releaseLock()
  }
  return items
}

/**
 * Extract the text of a PDF.
 *
 * @param {ArrayBuffer|Uint8Array} data
 * @param {object} [options]
 * @param {string} [options.password]  for an encrypted PDF; the caller retries
 *   with the password when a PdfPasswordError comes back.
 * @param {boolean} [options.twoColumns]  auto-detect and split two column pages
 * @param {(page: number, total: number) => void} [options.onprogress]
 * @returns {Promise<{text: string, pages: number, columns: number[]}>}
 */
export async function extractPdf(data, options = {}) {
  const {password, twoColumns = true, onprogress} = options
  const pdfjs = await getPdfjs()

  const task = pdfjs.getDocument({
    data,
    password,
    // These are only consulted for CJK encodings and the standard fonts. Pointing
    // at the vendored copies keeps the app working offline; the fetch is lazy, so
    // a Latin-only PDF never downloads them.
    cMapUrl: CMAP_URL.href,
    cMapPacked: true,
    standardFontDataUrl: FONTS_URL.href,
    // Fonts in a PDF can carry JavaScript for the viewer. Nothing here needs it.
    isEvalSupported: false,
  })

  const pages = []
  const columns = []
  let total

  // The task owns a worker, so it is destroyed on every exit path including the
  // ones that throw before the document ever arrives. A password prompt is the
  // common one: it is not a failure, but leaving the worker behind on each retry
  // would add one per attempt.
  try {
    let document_
    try {
      document_ = await task.promise
    } catch (error) {
      if (error?.name === 'PasswordException') throw new PdfPasswordError()
      throw error
    }

    total = document_.numPages

    for (let number = 1; number <= total; number++) {
      const page = await document_.getPage(number)
      try {
        const items = await readPage(page)
        const result = itemsToPageText(items, {twoColumns})
        pages.push(result.text)
        columns.push(result.columns)
      } finally {
        // Release the page's operator list and images as we go; a 500 page
        // document otherwise holds every page's resources in memory at once.
        page.cleanup()
      }
      onprogress?.(number, total)
    }
  } finally {
    // destroy() lives on the loading task, not on the document proxy: it aborts
    // the transport and terminates the worker.
    await task.destroy()
  }

  const text = pagesToText(pages)
  if (!hasExtractableText(text)) throw new PdfEmptyError()

  return {text, pages: total, columns}
}

/** Just the document metadata, for a nicer default filename and title. */
export async function readPdfMetadata(data, {password} = {}) {
  const pdfjs = await getPdfjs()
  const task = pdfjs.getDocument({data, password, isEvalSupported: false})
  try {
    const document_ = await task.promise
    const {info} = (await document_.getMetadata()) ?? {}
    return {title: info?.Title ?? '', author: info?.Author ?? '', pages: document_.numPages}
  } catch (error) {
    if (error?.name === 'PasswordException') throw new PdfPasswordError()
    throw error
  } finally {
    await task.destroy()
  }
}
