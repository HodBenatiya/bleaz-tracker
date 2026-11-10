import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument } from 'pdf-lib'

const root = new URL('..', import.meta.url)
const dir = mkdtempSync(join(tmpdir(), 'wa-note-draft-'))
const outfile = join(dir, 'wa-note-draft.mjs')
const pdfPath = join(dir, 'cv.pdf')

await esbuild.build({
  stdin: {
    contents: [
      "import handler from './api/wa-note-draft.ts'",
      "import { extractPdfText } from './src/utils/extractCvText.ts'",
      'export { handler, extractPdfText }',
      '',
    ].join('\n'),
    resolveDir: new URL('.', root).pathname,
    sourcefile: 'wa-note-draft-bundle-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile,
  logLevel: 'warning',
})

const fontBytes = readFileSync(new URL('./fixtures/Alef-Regular.ttf', import.meta.url))
const pdf = await PDFDocument.create()
pdf.registerFontkit(fontkit)
const font = await pdf.embedFont(fontBytes, { subset: true })
const page = pdf.addPage([420, 640])
const lines = ['ניסיון במכירות בתל אביב', 'תואר ראשון ושירות לקוחות']
lines.forEach((line, index) => {
  page.drawText(line, { font, size: 16, x: 36, y: 580 - index * 32 })
})
writeFileSync(pdfPath, await pdf.save())

const probe = join(dir, 'probe.mjs')
writeFileSync(probe, `
import { readFileSync } from 'node:fs'
delete globalThis.DOMMatrix
delete globalThis.ImageData
delete globalThis.Path2D
const mod = await import(${JSON.stringify(pathToFileURL(outfile).href)})
if (typeof mod.handler !== 'function') {
  console.error('handler export missing', typeof mod.handler)
  process.exit(1)
}
if (typeof globalThis.DOMMatrix !== 'undefined' || typeof globalThis.ImageData !== 'undefined' || typeof globalThis.Path2D !== 'undefined') {
  console.error('pdfjs ran at import')
  process.exit(1)
}
const text = await mod.extractPdfText(new Uint8Array(readFileSync(${JSON.stringify(pdfPath)})))
if (!String(text).includes('ניסיון במכירות בתל אביב') || !String(text).includes('שירות לקוחות')) {
  console.error('bundled hebrew extract failed', JSON.stringify(text))
  process.exit(1)
}
console.log('wa-note-draft bundle load ok')
`)

const result = spawnSync(process.execPath, [probe], { encoding: 'utf8' })
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
assert.equal(result.status, 0)
