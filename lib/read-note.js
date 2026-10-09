// The note as every exporter takes it. On its own so the test seam and the
// console can read the note without loading the export module.

/**
 * Collect everything an exporter needs from the live editor.
 *
 * @param {object} editor  the article element and its controller
 * @returns {{text: string, title: string, style: string|null, hash: string, exportedAt: string}}
 */
export function readNote(editor) {
  const {article} = editor
  return {
    text: article.textContent,
    title: document.title,
    style: article.getAttribute('style'),
    hash: location.hash,
    exportedAt: new Date().toISOString(),
  }
}
