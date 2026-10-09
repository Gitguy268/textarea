import assert from 'node:assert/strict'
import test from 'node:test'

import {
  convert,
  FORMATS,
  getFormat,
  sanitizeFilename,
  toCsv,
  toRtf,
  toTex,
  toYaml,
} from '../../lib/formats.js'

const note = {
  title: 'Shopping list',
  text: 'Milk\nEggs & ham\n\nLine with "quotes"',
  style: 'color: red',
  hash: '#abcdef',
  exportedAt: '2026-10-05T12:00:00.000Z',
}

test('sanitizeFilename strips path separators and control characters', () => {
  assert.equal(sanitizeFilename('my/note:2026'), 'my_note_2026')
  assert.equal(sanitizeFilename('bad\u0000name'), 'bad_name')
  assert.equal(sanitizeFilename('tab\there'), 'tab_here')
})

test('sanitizeFilename never yields an empty, hidden or reserved name', () => {
  assert.equal(sanitizeFilename(''), 'note')
  assert.equal(sanitizeFilename('   '), 'note')
  assert.equal(sanitizeFilename('...'), 'note')
  assert.equal(sanitizeFilename('.hidden'), 'hidden')
  assert.equal(sanitizeFilename('CON'), '_CON')
  assert.equal(sanitizeFilename('lpt1.txt'), '_lpt1.txt')
  assert.equal(sanitizeFilename('..'), 'note')
  assert.equal(sanitizeFilename(undefined), 'note')
})

test('sanitizeFilename drops trailing dots and spaces that Windows discards', () => {
  assert.equal(sanitizeFilename('report.  '), 'report')
})

test('sanitizeFilename truncates to a byte budget without splitting characters', () => {
  const name = sanitizeFilename('é'.repeat(200))
  assert.ok(new TextEncoder().encode(name).length <= 180)
  assert.equal(name, 'é'.repeat(90))
})

test('sanitizeFilename folds newlines from a document title', () => {
  assert.equal(sanitizeFilename('# Title\n\nBody'), '# Title Body')
})

test('csv escapes quotes and uses CRLF line endings', () => {
  const csv = toCsv('a,b\nHe said "hi"\n')
  assert.equal(csv, 'line,text\r\n1,"a,b"\r\n2,"He said ""hi"""\r\n')
})

test('csv does not invent a row for the trailing newline', () => {
  assert.equal(toCsv('one\n').split('\r\n').length, 3)
  assert.equal(toCsv('').split('\r\n').length, 2)
})

test('csv neutralises formula prefixes so a spreadsheet cannot execute them', () => {
  const csv = toCsv('=HYPERLINK("http://evil.example")\n+1\n-2\n@SUM(A1)\n\tindented\nnormal')
  assert.equal(
    csv,
    [
      'line,text',
      `1,"'=HYPERLINK(""http://evil.example"")"`,
      `2,"'+1"`,
      `3,"'-2"`,
      `4,"'@SUM(A1)"`,
      `5,"'\tindented"`,
      '6,"normal"',
      '',
    ].join('\r\n'),
  )
})

test('rtf escapes braces, backslashes and newlines', () => {
  const rtf = toRtf('a{b}c\\d\ne')
  assert.ok(rtf.includes('a\\{b\\}c\\\\d'))
  assert.ok(rtf.includes('\\par'))
  assert.ok(rtf.startsWith('{\\rtf1'))
  assert.ok(rtf.trimEnd().endsWith('}'))
})

test('rtf escapes non-ascii as \\uN including negative values above 32767', () => {
  const rtf = toRtf('café ✓ \u{1F600}')
  assert.ok(rtf.includes('\\u233?')) // é is U+00E9
  assert.ok(rtf.includes('\\u10003?')) // ✓ is U+2713 = 10003
  // U+1F600 arrives as a surrogate pair, both halves must be escaped.
  assert.ok(rtf.includes('\\u-10179?')) // 0xD83D
  assert.ok(rtf.includes('\\u-8704?')) // 0xDE00
})

test('latex escapes specials and keeps fenced code in verbatim', () => {
  const tex = toTex({
    title: 'Cost & benefit',
    text: 'Costs $5 #1 50%\n\n```js\nconst a = 1_000\n```',
    exportedAt: '2026-10-05T12:00:00.000Z',
  })
  assert.ok(tex.includes('\\documentclass'))
  assert.ok(tex.includes('Cost \\& benefit') || tex.includes('Cost \\&'))
  assert.ok(tex.includes('\\$5'))
  assert.ok(tex.includes('\\#1'))
  assert.ok(tex.includes('50\\%'))
  assert.ok(tex.includes('\\begin{verbatim}'))
  assert.ok(tex.includes('const a = 1_000'), 'code block must stay literal')
  assert.ok(tex.includes('\\end{document}'))
})

test('yaml uses a literal block scalar and keeps blank lines', () => {
  const yaml = toYaml(note)
  assert.ok(yaml.startsWith('title: Shopping list\n'))
  assert.ok(yaml.includes('exportedAt: 2026-10-05T12:00:00.000Z'))
  assert.ok(yaml.includes('source: "#abcdef"'), 'a value with # must be quoted')
  assert.ok(yaml.includes('text: |-\n'))
  assert.ok(yaml.includes('  Milk\n  Eggs & ham\n\n  Line with "quotes"\n'))
})

test('yaml quotes values that would otherwise parse as another type', () => {
  const yaml = toYaml({title: '123', text: 'yes', exportedAt: '2026-01-01T00:00:00.000Z'})
  assert.ok(yaml.includes('title: "123"'))
  assert.ok(yaml.includes('text: |-\n  yes'))
})

test('json round trips the note exactly', () => {
  const json = JSON.parse(convert(note, 'json').text)
  assert.equal(json.title, 'Shopping list')
  assert.equal(json.text, note.text)
  assert.equal(json.style, 'color: red')
  assert.equal(json.hash, '#abcdef')
  assert.equal(json.exportedAt, note.exportedAt)
})

test('xml wraps the text in CDATA and survives a ]]> in the source', () => {
  const text = 'before ]]> after & <tag>'
  const xml = convert({...note, text}, 'xml').text

  // Collect the CDATA sections the way a parser would: each one runs up to the
  // first ]]>. If the escaping works, the pieces concatenate back to the source
  // and no piece itself contains the terminator.
  const sections = [...xml.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((match) => match[1])
  assert.equal(sections.join(''), text)
  for (const section of sections) assert.ok(!section.includes(']]>'), section)
  assert.ok(xml.includes(']]]]><![CDATA[>'))
})

test('xml escapes the title and omits source and style when absent', () => {
  const xml = convert({title: 'a & b <c>', text: 'x', exportedAt: '2026-01-01T00:00:00.000Z'}, 'xml').text
  assert.ok(xml.includes('<title>a &amp; b &lt;c&gt;</title>'))
  assert.ok(!xml.includes('<source>'))
  assert.ok(!xml.includes('<style>'))
})

test('html export inlines the page css and the rendered body', () => {
  const html = convert(note, 'html', {
    html: {bodyHtml: '<article>Hello</article>', css: 'article { color: red }', title: 'Doc'},
  }).text
  assert.ok(html.startsWith('<!DOCTYPE html>'))
  assert.ok(html.includes('<style>article { color: red }</style>'))
  assert.ok(html.includes('<article>Hello</article>'))
  assert.ok(html.includes('<title>Doc</title>'))
  assert.ok(html.includes('content="2026-10-05T12:00:00.000Z"'))
})

test('html export escapes a quote in the source url attribute', () => {
  const html = convert({...note, hash: '#a"b'}, 'html').text
  assert.ok(html.includes('content="#a&quot;b"'))
})

test('txt and md keep the text verbatim, md adds a trailing newline', () => {
  assert.equal(convert(note, 'txt').text, note.text)
  assert.equal(convert(note, 'md').text, note.text + '\n')
  assert.equal(convert({...note, text: 'x\n'}, 'md').text, 'x\n')
})

test('every registered format produces output and reports a mime type', () => {
  for (const format of FORMATS) {
    const result = convert(note, format.id)
    assert.equal(typeof result.text, 'string', format.id)
    assert.ok(result.text.length > 0, format.id)
    assert.ok(result.mime.length > 0, format.id)
    assert.match(format.ext, /^[a-z0-9]+$/, format.id)
  }
})

test('an unknown format id falls back to plain text', () => {
  assert.equal(getFormat('nope').id, 'txt')
  assert.equal(convert(note, 'nope').text, note.text)
})

test('all exporters survive empty and awkward notes', () => {
  const awkward = [
    {title: '', text: '', exportedAt: '2026-01-01T00:00:00.000Z'},
    {title: '</title><script>', text: '</style>]]>', exportedAt: '2026-01-01T00:00:00.000Z'},
    {title: 'x'.repeat(5000), text: 'a\n\n\n\nb', exportedAt: '2026-01-01T00:00:00.000Z'},
  ]
  for (const item of awkward) {
    for (const format of FORMATS) {
      assert.doesNotThrow(() => convert(item, format.id), `${format.id} ${item.title}`)
    }
  }
})
