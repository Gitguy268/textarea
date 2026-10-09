// Boot and typing measurements, and the way to repeat them.
//
//   node tests/perf.js             what the boot costs: FCP, LCP, transfer,
//                                  the main-thread window, the eager graph
//   node tests/perf.js 1024        plus what one highlight cycle costs on a
//                                  note of that many kilobytes
//
// Numbers rather than impressions. The same static server and the same
// browser the suite drives, so a baseline written into a commit message can
// be re-taken by anyone with the repo - which is the point: every performance
// change in this project has to name the number it moved.
//
// This is a measurement tool, not a gate: budgets vary per machine, so
// nothing here fails on a threshold. The tests hold the behaviour; this file
// holds the evidence.

import {promises as fs} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {chromium} from 'playwright'

import {listen} from './serve.js'

const ROOT = resolve(import.meta.dirname, '..')

/** The static-import graph from a file: what the boot must parse and eval. */
async function eagerGraph(entry) {
  const seen = new Set()
  const dynamic = new Set()
  const files = []
  const stack = [entry]

  while (stack.length) {
    const file = stack.pop()
    if (seen.has(file)) continue
    seen.add(file)
    files.push(file)

    const source = await fs.readFile(file, 'utf8')
    for (const match of source.matchAll(
      /import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g,
    )) {
      const [staticSpec, dynamicSpec] = [match[1], match[2]]
      if (dynamicSpec) {
        if (dynamicSpec.startsWith('.')) dynamic.add(resolve(dirname(file), dynamicSpec))
        continue
      }
      if (staticSpec?.startsWith('.')) stack.push(resolve(dirname(file), staticSpec))
    }
  }

  const withBytes = await Promise.all(
    files.map(async (file) => ({
      name: file.slice(ROOT.length + 1),
      bytes: (await fs.stat(file)).size,
    })),
  )
  withBytes.sort((a, b) => b.bytes - a.bytes)
  return {
    modules: withBytes.length,
    bytes: withBytes.reduce((sum, file) => sum + file.bytes, 0),
    files: withBytes,
    dynamic: [...dynamic].map((file) => file.slice(ROOT.length + 1)).sort(),
  }
}

/** Everything the page reports about its own boot, collected from frame one. */
function watchBoot(page) {
  return page.addInitScript(() => {
    const perf = {paint: {}, lcp: 0, resources: [], navigation: null}
    globalThis.__perf = perf
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) perf.paint[entry.name] = entry.startTime
    }).observe({type: 'paint', buffered: true})
    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      perf.lcp = entries[entries.length - 1]?.startTime ?? 0
    }).observe({type: 'largest-contentful-paint', buffered: true})
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perf.resources.push({
          name: entry.name,
          kind: entry.initiatorType,
          bytes: entry.encodedBodySize,
          transfer: entry.transferSize,
        })
      }
    }).observe({type: 'resource', buffered: true})
    // Read on demand: loadEventEnd only has a value after the load event has
    // finished dispatching, so a handler that reads it in the moment would
    // always report zero.
    globalThis.__readPerf = () => {
      const [navigation] = performance.getEntriesByType('navigation')
      perf.navigation = {
        responseEnd: navigation.responseEnd,
        domContentLoaded: navigation.domContentLoadedEventEnd,
        load: navigation.loadEventEnd,
      }
      return perf
    }
  })
}

const ms = (value) => `${Number(value).toFixed(1)} ms`
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`

async function measureBoot(origin) {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await watchBoot(page)

  await page.goto(origin + '/')
  await page.waitForFunction(() => Boolean(globalThis.textarea))
  await page.waitForLoadState('load')
  // Give the observers a beat to see what load pulls in (the service worker's
  // own first-install fetches among it) before the numbers are read.
  await page.waitForTimeout(500)

  const perf = await page.evaluate(() => globalThis.__readPerf())
  await browser.close()

  const graph = await eagerGraph(resolve(ROOT, 'app.js'))
  const encoded = perf.resources.reduce((sum, resource) => sum + resource.bytes, 0)
  const transfer = perf.resources.reduce((sum, resource) => sum + resource.transfer, 0)
  const scripts = perf.resources.filter((resource) => resource.kind === 'script')

  const lines = [
    'Boot',
    `  FCP                   ${ms(perf.paint['first-contentful-paint'] ?? 0)}`,
    // This browser reports no LCP entry for the page; saying zero would be a
    // measurement, and it is an absence.
    `  LCP                   ${perf.lcp ? ms(perf.lcp) : 'not reported by this browser'}`,
    `  DOMContentLoaded      ${ms(perf.navigation?.domContentLoaded ?? 0)}` +
      `  (response ended at ${ms(perf.navigation?.responseEnd ?? 0)})`,
    `  load event            ${ms(perf.navigation?.load ?? 0)}`,
    `  transfer              ${perf.resources.length} requests, ` +
      `${kb(encoded)} encoded, ${kb(transfer)} transferred`,
    `  scripts               ${scripts.length} requests, ` +
      `${kb(scripts.reduce((sum, script) => sum + script.bytes, 0))} encoded`,
    `  eager graph           ${graph.modules} modules, ${kb(graph.bytes)} to parse and eval`,
    '  modules by size',
    ...graph.files.map((file) => `    ${kb(file.bytes).padStart(10)}  ${file.name}`),
    '  loaded on demand',
    ...(graph.dynamic.length ? graph.dynamic.map((name) => `    ${name}`) : ['    (none)']),
  ]
  if (errors.length) lines.push(`  page errors           ${errors.join('; ')}`)
  return lines
}

/** One highlight cycle on a note of `size` kilobytes, median of five. */
async function measureTyping(origin, size) {
  // Paragraph-shaped, the way a written note is: a single unbroken line of
  // this size is its own edge case (see the commit that recorded the
  // baseline) and would not describe what readers actually have open.
  const line = 'The quick brown fox jumps over the lazy dog and keeps running on. '
  const paragraphs = []
  while (paragraphs.join('\n\n').length < size * 1024) paragraphs.push(line + line)
  const note = `# Perf note\n\n${paragraphs.join('\n\n')}`

  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(origin + '/')
  await page.waitForFunction(() => Boolean(globalThis.textarea))
  await page.evaluate((text) => globalThis.textarea.editor.replace(text), note)

  const samples = await page.evaluate(() => {
    const article = document.querySelector('article')
    const cycles = []
    for (let i = 0; i < 5; i++) {
      const start = performance.now()
      // The whole synchronous path a keystroke's highlight takes: the text
      // set, the document rebuilt over it, the caret put back.
      globalThis.textarea.editor.replace(article.textContent + (i % 2 ? ' ' : ''))
      cycles.push(performance.now() - start)
    }
    const handlerStart = performance.now()
    article.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText'}))
    const handler = performance.now() - handlerStart
    cycles.sort((a, b) => a - b)
    return {median: cycles[2], worst: cycles[cycles.length - 1], handler}
  })

  await browser.close()
  const sizeKb = Buffer.byteLength(note) / 1024
  return [
    `Typing on a ${sizeKb.toFixed(0)} kB note`,
    `  replace + highlight   ${ms(samples.median)} (median of 5, worst ${ms(samples.worst)})`,
    `  input handler         ${ms(samples.handler)}`,
  ]
}

const {origin, close} = await listen()
try {
  const lines = await measureBoot(origin)
  const size = Number(process.argv[2])
  if (Number.isFinite(size) && size > 0) lines.push(...(await measureTyping(origin, size)))
  console.log(lines.join('\n'))
} finally {
  await close()
}
