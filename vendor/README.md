# Vendored third-party code

These files are checked in on purpose: this project has no build step and is
deployed as plain static files straight from the repository root. Keeping the
libraries here means the app works offline and does not depend on a CDN.

Nothing in this directory is loaded on the initial page load. Every library here
is fetched with a dynamic `import()` / `<script>` injection the first time a PDF
is opened, a ZIP is written, a QR code is drawn, a glass panel appears or the
on-device model is asked for, and the service worker caches them on first use.

## `zip.js/`

| | |
|---|---|
| Project | [gildas-lormeau/zip.js](https://github.com/gildas-lormeau/zip.js) |
| Package | [`@zip.js/zip.js`](https://www.npmjs.com/package/@zip.js/zip.js) |
| Version | 2.23.0 |
| License | BSD-3-Clause (see `zip.js/LICENSE`) |

`zip.min.js` is the prebuilt UMD bundle. It exposes the API as the `zip` global
and embeds its own web worker code and WebAssembly deflate implementation.

Used for writing and reading ZIP archives, including **WinZip AES AE-2
encryption** (`password` + `encryptionStrength: 3` → AES-256). The output opens
in 7-Zip, Keka, WinZip and Windows Explorer.

Why this and not a separate AES library: WinZip AE-2 is the only widely
interoperable password-protected ZIP format, and zip.js implements it natively.
A standalone AES implementation would produce a `.aes256` blob that no other
tool can open.

`Urban82/Aes256` was evaluated and rejected: it is a C++/CMake library (LGPL),
not JavaScript, so it cannot run in a browser.

## `pdfjs/`

| | |
|---|---|
| Project | [mozilla/pdf.js](https://github.com/mozilla/pdf.js) |
| Package | [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist) |
| Version | 6.4.299 |
| License | Apache-2.0 (see `pdfjs/LICENSE`) |

| Path | Size | Purpose |
|---|---|---|
| `pdf.min.mjs` | 459 KB | API: parsing, `streamTextContent()` |
| `pdf.worker.min.mjs` | 1.26 MB | Parsing worker |
| `cmaps/*.bcmap` | 1.6 MB (168 files) | Required for CJK encodings; without them those PDFs extract blank or mojibake |
| `standard_fonts/*.pfb` | 816 KB (10 files) | Fallback metrics for the 14 standard fonts |

The `wasm/` directory from the package is deliberately **not** vendored: it holds
JPEG 2000 and JBIG2 image decoders, which are only needed to render images in a
PDF, never to extract its text.

### Why pdf.js

Two Java libraries were evaluated for PDF text extraction and rejected as
unusable in a browser:

- [JonathanLink/PDFLayoutTextStripper](https://github.com/JonathanLink/PDFLayoutTextStripper)
  — a Java class extending Apache PDFBox's `PDFTextStripper`.
- [p2r3/convert](https://github.com/p2r3/convert) — a Bun + Vite application
  licensed GPL-2.0, not an embeddable library.

`lib/pdf-layout.js` re-implements the *idea* behind PDFLayoutTextStripper —
group text runs by their baseline, sort each line left to right, infer word
breaks from horizontal gaps and paragraph breaks from vertical gaps — on top of
the positioned text items pdf.js returns. That algorithm is a few dozen lines
of geometry and does not need the PDFBox machinery.

### Browser note

`page.getTextContent()` is **not** used. pdf.js implements it with
`for await (... of readableStream)`, and Safari has no
`ReadableStream.prototype[Symbol.asyncIterator]` before Safari 27, so the call
throws for every PDF there (mozilla/pdf.js#21557). `lib/pdf.js` consumes
`page.streamTextContent()` through `getReader()` instead, which works
everywhere.

## `qr/`

| | |
|---|---|
| Project | [kazuhikoarase/qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) |
| Package | [`qrcode-generator`](https://www.npmjs.com/package/qrcode-generator) |
| Version | 2.0.4 |
| License | MIT (see `qr/LICENSE`) |

| Path | Size | Purpose |
|---|---|---|
| `qrcode.mjs` | 52 KB | Reed-Solomon encoder and the module matrix |
| `qrcode_UTF8.mjs` | 1.6 KB | Replaces the default byte encoder with UTF-8 |

### Why qrcode-generator

A QR encoder is a few hundred lines of bit twiddling against the ISO/IEC 18004
tables, and getting the mask penalty scores or the format information bits wrong
produces a symbol that *looks* right and scans as nothing. Vendoring a
permissively licensed implementation is cheaper than owning that.

Two candidates were compared:

- [`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator) —
  chosen. No dependencies, 52 KB of plain ESM, and it hands back the raw module
  matrix through `isDark(row, column)`, which means `lib/qr.js` owns the SVG
  output instead of emitting the library's opinionated markup. Its byte encoder
  is patched with `qrcode_UTF8.mjs`; without that patch any character above
  U+00FF is silently mangled, since the default encoder masks each code unit with
  `& 0xFF`.
- [`node-qrcode`](https://github.com/soldair/node-qrcode) — rejected. Correct, and
  it does UTF-8 itself, but the browser build is roughly twice the size, pulls in
  graph traversal and a PNG encoder to produce output this project does not want
  (SVG), and its browser entry point is not a native ES module.

Because `qrcode.mjs` is ordinary ESM with no DOM references, the encoder is
importable under Node, so `tests/unit/qr.test.js` asserts the module matrix of
`HELLO WORLD` against the published reference symbol instead of merely checking
that a string came back.

## `liquid-glass/`

| | |
|---|---|
| Project | [deepika-builds/liquid-glass](https://github.com/deepika-builds/liquid-glass) |
| Version | commit [`98ed97bd`](https://github.com/deepika-builds/liquid-glass/tree/98ed97bd99def529493fd37177228810f6422f6d) (upstream has no tags) |
| License | MIT (see `liquid-glass/LICENSE`) |

`liquid-glass.js` is the entire project: one dependency-free file exposing a
single `liquidGlass(element, options)` function. It draws a displacement map
on a canvas, wires it into an SVG filter, and points the element's
`backdrop-filter` at that filter so the page behind a panel visibly bends at
the rim — the defining trick of Apple's liquid glass, which a plain blur
cannot produce. The module owns the optics only; the tint, highlights and
shadows that make a panel read as glass are ordinary CSS in `index.html`.
Where the browser cannot use an SVG filter as a backdrop (Safari, Firefox),
it falls back to a frosted blur, which is close to the blur the menu had
before.

Used by `lib/glass.js` for the menu, the dialogs and the statistics panel,
behind the **Glass** row in the menu. Loaded on demand, like everything else
here.

The technique follows [Aave's write-up](https://aave.com/design/building-glass-for-the-web)
and [rizroze/liquid-glass](https://github.com/rizroze/liquid-glass), credited
in the file's own header.

### Why this one

Two other implementations were evaluated:

- [shuding/liquid-glass](https://github.com/shuding/liquid-glass) — a console
  demo, not a library: it spawns one hardcoded 300×200 draggable rectangle at
  the centre of the screen rather than styling an element you choose, and logs
  to the console on creation.
- [DevBehindYou/LiquidLens](https://github.com/DevBehindYou/LiquidLens) — a
  multi-platform monorepo whose web core is two CSS files plus one JS file
  behind a global `init()`, with no release history to pin.

`deepika-builds/liquid-glass` was the only one of the three shaped like the
libraries already vendored here: a single file, no dependencies, a per-element
API with `refresh()`/`destroy()` for open/close lifecycles, an automatic
fallback, and an MIT licence with a standalone `LICENSE` file.

## `wllama/`

| | |
|---|---|
| Project | [ngxson/wllama](https://github.com/ngxson/wllama) |
| Package | [`@wllama/wllama`](https://www.npmjs.com/package/@wllama/wllama) and [`@wllama/wllama-compat`](https://www.npmjs.com/package/@wllama/wllama-compat) |
| Version | 3.8.1 |
| License | MIT (see `wllama/LICENSE`) |

| Path | Size | Purpose |
|---|---|---|
| `wllama.js` | 324 KB | The ESM bundle: `Wllama`, its OpenAI-compatible completion API, the cache and model managers |
| `wllama.wasm` | 8.4 MB | llama.cpp compiled for wasm with JSPI and memory64 — the build modern browsers run |
| `wllama-compat.js` | 168 KB | Worker for the compatibility build |
| `wllama-compat.wasm` | 15 MB | wasm32 llama.cpp for browsers without JSPI or memory64 (older Safari and Firefox), handed to `setCompat()` so those browsers work without a CDN |

Nothing here loads until the reader opens the writing tools: `lib/gemma.js`
imports `wllama.js` on that first open, and the worker, the wasm and the model
in `../models/` are fetched only when **Load model** is pressed. The worker code
for the modern build lives inside the bundle itself and runs from a blob URL,
which the CSP's `worker-src 'self' blob:` already allowed before this arrived.

The wasm is why the service worker's content security policy gained
`'wasm-unsafe-eval'`: compiling a `WebAssembly.Module` counts as script
execution, and `'wasm-unsafe-eval'` grants exactly that and nothing weaker —
plain `'unsafe-eval'` stays banned, which the header tests assert both before
and after the amendment.

### Why wllama

The requirement was a model that ships *in the repository*: no download step, no
Hugging Face fetch at runtime, nothing that stops working offline. Two larger
names were evaluated against that:

- [`@huggingface/transformers`](https://github.com/huggingface/transformers.js)
  — runs ONNX models through onnxruntime-web with its own graph runners. It
  would work, but the model would have to be converted out of GGUF into ONNX
  (shards, external data, a second conversion of the tokenizer), the runtime is
  several megabytes more, and GGUF is the format this model is published and
  checksummed in.
- [`web-llm`](https://github.com/mlc-ai/web-llm) — excellent engine, but its
  whole design assumes models are fetched from a CDN catalog of hosted
  quantizations; a model committed to a repository is a thing it has no path
  for, and its scheduler machinery is far beyond "run one prompt".

wllama is one MIT-licensed ESM file plus llama.cpp as wasm, it loads `Blob[]`
straight from disk-shaped URLs, and it exposes the same `createChatCompletion`
shape as the online APIs — so `lib/gemma.js` stays a thin adapter and the
quantization the reader gets is byte-for-byte the GGUF in `models/`.

### The model itself

The weights are **not** vendored here — they live in `../models/` as transport
chunks with their own README (source, quantization, SHA-256, licence). This
directory is code only; that directory is the 253 MB the code runs on.

## Refreshing

```sh
npm pack @zip.js/zip.js@<version> pdfjs-dist@<version> qrcode-generator@<version>
tar xzf zip.js-zip.js-<version>.tgz -C zip --strip-components=1
tar xzf pdfjs-dist-<version>.tgz -C pdfjs --strip-components=1
tar xzf qrcode-generator-<version>.tgz
cp zip/dist/zip.min.js zip/LICENSE vendor/zip.js/
cp pdfjs/build/pdf.min.mjs pdfjs/build/pdf.worker.min.mjs pdfjs/LICENSE vendor/pdfjs/
cp pdfjs/cmaps/*.bcmap vendor/pdfjs/cmaps/
cp pdfjs/standard_fonts/*.pfb vendor/pdfjs/standard_fonts/
cp package/dist/qrcode.mjs package/dist/qrcode_UTF8.mjs vendor/qr/
```

`qrcode-generator` ships no `LICENSE` file, only the MIT notice in the header of
each source file, so `vendor/qr/LICENSE` is transcribed from that header rather
than copied.

`liquid-glass` is not fetched from npm; it is pinned to a commit on GitHub:

```sh
curl -o vendor/liquid-glass/liquid-glass.js \
  https://raw.githubusercontent.com/deepika-builds/liquid-glass/<commit>/liquid-glass.js
curl -o vendor/liquid-glass/LICENSE \
  https://raw.githubusercontent.com/deepika-builds/liquid-glass/<commit>/LICENSE
```

wllama is two npm packages, since the main build and the compatibility build
version together:

```sh
npm pack @wllama/wllama@<version> @wllama/wllama-compat@<version>
tar xzf wllama-wllama-<version>.tgz -C wllama --strip-components=1
tar xzf wllama-wllama-compat-<version>.tgz -C wllama-compat --strip-components=1
cp wllama/esm/index.min.js vendor/wllama/wllama.js
cp wllama/esm/wasm/wllama.wasm vendor/wllama/wllama.wasm
cp wllama-compat/wasm/wllama.js vendor/wllama/wllama-compat.js
cp wllama-compat/wasm/wllama.wasm vendor/wllama/wllama-compat.wasm
```

Neither wllama tarball ships a licence file — the repository spells it
`LICENCE` — so `vendor/wllama/LICENSE` is transcribed from
[the repository's copy](https://github.com/ngxson/wllama/blob/master/LICENCE).

Update the version tables above and the cache version in `sw.js` in the same
commit.
