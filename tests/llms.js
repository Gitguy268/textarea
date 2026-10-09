// Build llms-full.txt: the long documents concatenated for a single fetch.
//
// This is not a build step for the app. `index.html` never loads it, the site
// deploys without it, and nothing in `lib/` knows it exists — the hard rule in
// CONTRIBUTING is about shipping a page that needs a toolchain, and this ships
// nothing. It exists so the file cannot quietly drift away from the three it is
// made of: `tests/unit/llms.test.js` compares what is committed against what
// this produces and says to run `npm run llms-full` when they disagree.

import {readFile, writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'

/** The documents llms-full.txt is made of, in the order they appear. */
export const SOURCES = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md']

const root = new URL('../', import.meta.url)

const HEADER = `# Textarea — full documentation

> The README, the changelog and the contributing guide in one file, for a reader
> that would rather take one fetch than three. Each document follows verbatim
> below, marked with a comment naming the file it came from.`

/**
 * llms-full.txt as it should be committed.
 *
 * The separators are thematic breaks with a blank line on both sides, so none
 * of them can be read as a setext heading under the line above, whatever that
 * line happens to be.
 *
 * @returns {Promise<string>}
 */
export async function buildFull() {
  const parts = await Promise.all(
    SOURCES.map(async (name) => {
      const text = (await readFile(new URL(name, root), 'utf8')).trim()
      return `<!-- ${name} -->\n\n${text}`
    }),
  )
  return [HEADER, ...parts].join('\n\n---\n\n') + '\n'
}

// Written when run, read when imported, so the test and the regeneration cannot
// be two different ideas of what the file contains.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(new URL('llms-full.txt', root), await buildFull())
  console.log('wrote llms-full.txt')
}
