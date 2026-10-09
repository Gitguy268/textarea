// llms.txt, checked against the llmstxt.org spec and against this repository.
//
// The file is written by hand, because the site is one page and there is
// nothing for a crawler to extract — which means nothing but care keeps it
// correct, and care is not a test. These checks are the part that does: the
// shape the spec asks for, a file list an agent can act on, and every link that
// claims to point into this repository landing on a file that is really there.
//
// llms-full.txt is the same three documents concatenated, so it is compared
// against what they say right now rather than trusted to be current.

import assert from 'node:assert/strict'
import {readFile, stat} from 'node:fs/promises'
import test from 'node:test'

import {buildFull, SOURCES} from '../llms.js'

const read = (name) => readFile(new URL(`../../${name}`, import.meta.url), 'utf8')

/** Raw text from this repository, so a link is markdown and not a web page. */
const RAW = 'https://raw.githubusercontent.com/gitguy268/textarea/main/'

test('llms.txt is in the shape the spec asks for', async () => {
  const text = await read('llms.txt')
  const lines = text.split('\n')

  assert.equal(lines[0], '# Textarea', 'the file opens with an H1 naming the project')

  const summary = lines.slice(1).join('\n').trimStart()
  assert.match(summary, /^> /, 'a blockquote summary follows the H1 and nothing else')

  // Everything between the H1 and the first H2 has to be prose: the spec puts
  // the file lists behind H2s, and a stray heading in the middle would be read
  // as a section that lists files.
  const headings = lines.filter((line) => /^#+\s/.test(line))
  assert.equal(headings[0], '# Textarea')
  for (const heading of headings.slice(1)) {
    assert.match(heading, /^## [A-Z]/, `sections are H2s in title case, got ${heading}`)
  }

  const firstSection = lines.findIndex((line) => line.startsWith('## '))
  assert.ok(firstSection > 0, 'the file needs at least one file list')

  // A file list entry is `[name](url)`, optionally followed by `: notes`.
  const entries = lines.slice(firstSection).filter((line) => line.startsWith('- '))
  assert.ok(entries.length >= SOURCES.length, 'the documentation has to be listed')
  for (const entry of entries) {
    assert.match(entry, /^- \[[^\]]+\]\([^)]+\)(: .+)?$/, `not a file list entry: ${entry}`)
  }

  // The spec's own guidance: the file stays small enough to read whole, and the
  // detail lives behind the links. Without a ceiling this is where a full copy
  // of the README would end up.
  assert.ok(text.length < 8192, `the file should stay in context; it is ${text.length} bytes`)
})

test('every link into this repository lands on a file that exists', async () => {
  const text = await read('llms.txt')
  const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1])

  const local = links.filter((url) => url.startsWith(RAW))
  assert.ok(
    local.length >= SOURCES.length + 1,
    `the docs and llms-full.txt should be linked as raw text, found ${local.length} such links`,
  )

  for (const url of local) {
    const name = url.slice(RAW.length)
    assert.doesNotMatch(name, /^\.\./, `a link climbs out of the repository: ${url}`)
    await stat(new URL(`../../${name}`, import.meta.url)).catch(() => {
      assert.fail(`${url} points at a file that is not in the repository`)
    })
  }
})

test('index.html points at the file', async () => {
  // `describedby` is the relation llmstxt.org recommends, and a file no page
  // mentions is a file nothing finds by following the site.
  const html = await read('index.html')
  assert.match(html, /<link rel="describedby" href="llms\.txt">/)
})

test('llms-full.txt is still the three documents it is made of', async () => {
  const full = await read('llms-full.txt')
  // Compared with ok() rather than equal(): the whole point of the file is that
  // it is large, and a failing assertion should not print it.
  assert.ok(
    full === (await buildFull()),
    'llms-full.txt has drifted from README.md, CHANGELOG.md and CONTRIBUTING.md; run `npm run llms-full`',
  )
  assert.match(full.split('\n')[0], /^# /, 'the full file opens with an H1 too')
})
