// The end-to-end check the gate refuses to be: press Run in the real writing
// tools and wait for the real committed model to answer.
//
// `npm run check:model`
//
// Not part of test:all on purpose. It moves 241 MB of chunks through the
// service worker, starts a wasm engine and runs inference - tens of seconds
// to minutes, where a gate is expected to stay under a minute. What the
// committed suite proves instead is everything up to this script's first
// line: the prompt the panel builds, the loader's checks over a stubbed
// fetch, the service worker's cache, and the wiring. This script is the one
// place where all of it runs at once, against the bytes in models/.
//
// It exits non-zero - and says why - if the answer does not arrive, if any
// model file had to come down twice, if a fetch escaped this origin, or if
// the page threw.

import {chromium} from 'playwright'

import {listen} from './serve.js'

/** Generous: a cold start pays a download, a wasm compile and a warm-up. */
const RUN_TIMEOUT_MS = Number(process.env.MODEL_CHECK_TIMEOUT ?? 300_000)

const {origin, close} = await listen(0)
const browser = await chromium.launch()

let failed = false
const complain = (message) => {
  failed = true
  console.error(`  ✗ ${message}`)
}

try {
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await page.goto(origin + '/')

  // A note worth rewriting: short enough that the prompt is quick to eval,
  // long enough that "Improve wording" has a sentence to work on.
  await page.evaluate(async () => {
    globalThis.textarea.editor.replace(
      'we talked about the plan for a while and then everybody agreed. it should start next week.',
    )
    await globalThis.textarea.save()
  })

  // The panel the way a reader opens it: menu row, not a test hook.
  await page.locator('#button').click()
  await page.locator('#menu').waitFor({state: 'visible'})
  await page.locator('#menu-writing').click()
  const panel = page.locator('#writing-panel')
  await panel.waitFor({state: 'visible'})

  const probe = () =>
    panel.evaluate((root) => ({
      status: root.querySelector('.writing-status').textContent.trim(),
      error: root.querySelector('.writing-status').classList.contains('error'),
      output: root.querySelector('.writing-output').textContent.trim(),
      runEnabled: !root.querySelector('.writing-run').disabled,
    }))

  /** Watch the status line until the run settles: it is the only progress shown. */
  const untilSettled = async (label) => {
    let last = ''
    let sawBusy = false
    const deadline = Date.now() + RUN_TIMEOUT_MS
    for (;;) {
      const state = await probe()
      if (state.status && state.status !== last) {
        last = state.status
        console.log(`  ${label}: ${last}`)
      }
      if (state.status) sawBusy = true
      if (state.error) throw new Error(`${label} reported an error: ${state.status}`)
      if (sawBusy && state.status === '' && state.runEnabled && state.output) return state
      if (Date.now() > deadline) {
        throw new Error(`${label} timed out after ${RUN_TIMEOUT_MS}ms; last status: ${last}`)
      }
      await page.waitForTimeout(250)
    }
  }

  console.log('First run - download, verify, compile, warm up, write:')
  const cold = Date.now()
  await panel.locator('.writing-run').click()
  await untilSettled('cold run')
  console.log(`  first answer after ${((Date.now() - cold) / 1000).toFixed(1)}s`)

  const firstAnswer = await probe()
  console.log(`  answer: ${firstAnswer.output.replace(/\s+/g, ' ')}`)

  console.log('Second run - the engine is up; this one is inference only:')
  const warm = Date.now()
  await panel.locator('.writing-run').click()
  await untilSettled('warm run')
  console.log(`  second answer after ${((Date.now() - warm) / 1000).toFixed(1)}s`)

  // What the two runs together have to have looked like from outside.
  const timing = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => entry.name),
  )
  const partNames = [1, 2, 3, 4].map((n) => `/models/gemma-3-270M-it-Q4_K_M.part${n}`)
  for (const part of partNames) {
    const count = timing.filter((name) => name.endsWith(part)).length
    if (count !== 1) complain(`${part} was fetched ${count} times, expected exactly once`)
  }
  if (!timing.some((name) => name.endsWith('/vendor/wllama/wllama.js'))) {
    complain('the vendored engine was never fetched')
  }
  // The wasm is fetched inside wllama's worker, where the page's resource
  // timing cannot see it - so what is asked instead is the cache the service
  // worker would have filled had it seen the request, which for a request for
  // an origin path it does. If neither shows it, print what was seen.
  const wasmSaw = timing.filter((name) => name.includes('wllama') || name.endsWith('.wasm'))
  const vendorCached = await page.evaluate(async () => {
    const names = await caches.keys()
    const name = names.find((entry) => entry.startsWith('textarea-vendor'))
    if (!name) return []
    const cache = await caches.open(name)
    return (await cache.keys()).map((request) => new URL(request.url).pathname)
  })
  const wasmFetched = wasmSaw.some((name) => name.endsWith('/vendor/wllama/wllama.wasm'))
  const wasmCached = vendorCached.includes('/vendor/wllama/wllama.wasm')
  if (!wasmFetched && !wasmCached) {
    complain(
      `the vendored wasm cannot be accounted for; timing: ${wasmSaw.join(', ') || '(none)'}; ` +
        `vendor cache: ${vendorCached.join(', ') || '(none)'}`,
    )
  }
  if (vendorCached.some((name) => name.includes('jsdelivr'))) {
    complain(`the compat files came from a CDN after all: ${vendorCached.join(', ')}`)
  }
  const escaped = timing.filter(
    (name) => name.includes('jsdelivr') || (name.startsWith('http') && !name.startsWith(origin)),
  )
  if (escaped.length) complain(`fetches left this origin: ${escaped.join(', ')}`)

  const cached = await page.evaluate(async () => {
    const cache = await caches.open('textarea-models')
    return (await cache.keys()).map((request) => new URL(request.url).pathname)
  })
  for (const path of ['/models/manifest.json', ...partNames]) {
    if (!cached.includes(path)) complain(`${path} is not in the model cache`)
  }

  if (pageErrors.length) complain(`the page threw: ${pageErrors.join(' | ')}`)

  if (failed) {
    process.exitCode = 1
    console.error('\nThe model check failed.')
  } else {
    console.log('\nOK - the committed model answered twice, from this origin, from cache.')
  }
} catch (error) {
  process.exitCode = 1
  console.error(`\nThe model check failed: ${error.message}`)
} finally {
  await browser.close()
  await close()
}
