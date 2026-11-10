import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument } from 'pdf-lib'

/**
 * Vercel compiles each API file to ESM and lets Node resolve imports.
 * It does not bundle. A relative import without .js fails at load with
 * ERR_MODULE_NOT_FOUND, which is what took down /api/wa-note-draft.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'wa-note-draft-'))
const outDir = join(dir, 'dist')
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
const pdfPath = join(dir, 'cv.pdf')

function walkTs(folder: string, acc: string[] = []): string[] {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) walkTs(path, acc)
    else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) acc.push(path)
  }
  return acc
}

function walkJs(folder: string, acc: string[] = []): string[] {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) walkJs(path, acc)
    else if (path.endsWith('.js')) acc.push(path)
  }
  return acc
}

function relativeSpecifiers(source: string): string[] {
  const specs: string[] = []
  const re = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.[^'"]+)['"]/g
  for (const match of source.matchAll(re)) specs.push(match[1])
  return specs
}

function hasJsExtension(spec: string): boolean {
  return /\.(?:js|mjs|cjs|json|node|wasm)$/.test(spec)
}

const apiFiles = [...walkTs(join(root, 'api')), join(root, 'src', 'pdf-worker.d.ts')]
assert.ok(apiFiles.some(file => file.endsWith(join('api', 'wa-note-draft.ts'))))

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  outDir,
  rootDir: root,
  strict: false,
  skipLibCheck: true,
  esModuleInterop: true,
  isolatedModules: true,
  declaration: false,
  sourceMap: false,
  types: ['node'],
}
const program = ts.createProgram(apiFiles, options)
const diagnostics = ts.getPreEmitDiagnostics(program).filter(item => item.category === ts.DiagnosticCategory.Error)
if (diagnostics.length) {
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: file => file,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host))
  throw new Error('tsc failed')
}
const emitted = program.emit()
assert.equal(emitted.emitSkipped, false)

const jsFiles = walkJs(outDir)
const bare: string[] = []
for (const file of jsFiles) {
  for (const spec of relativeSpecifiers(readFileSync(file, 'utf8'))) {
    if (!hasJsExtension(spec)) bare.push(`${relative(outDir, file)} -> ${spec}`)
  }
}
if (bare.length) {
  console.error('extensionless relative imports (Node ESM on Vercel cannot resolve these):')
  for (const line of bare) console.error(`  ${line}`)
  throw new Error('extensionless relative imports')
}

writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'))

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

const handlerJs = join(outDir, 'api', 'wa-note-draft.js')
const extractJs = join(outDir, 'src', 'utils', 'extractCvText.js')
const apiJs = jsFiles.filter(file => relative(outDir, file).startsWith('api' + '/'))
const probe = join(dir, 'probe.mjs')
writeFileSync(probe, `
import { readFileSync } from 'node:fs'
delete globalThis.DOMMatrix
delete globalThis.ImageData
delete globalThis.Path2D
const handlerUrl = ${JSON.stringify(pathToFileURL(handlerJs).href)}
const mod = await import(handlerUrl)
if (typeof mod.default !== 'function') {
  console.error('handler export missing', typeof mod.default)
  process.exit(1)
}
if (typeof globalThis.DOMMatrix !== 'undefined' || typeof globalThis.ImageData !== 'undefined' || typeof globalThis.Path2D !== 'undefined') {
  console.error('pdfjs ran at import')
  process.exit(1)
}
const apiFiles = ${JSON.stringify(apiJs.map(file => pathToFileURL(file).href))}
for (const href of apiFiles) {
  if (href === handlerUrl) continue
  await import(href)
}
const cv = await import(${JSON.stringify(pathToFileURL(extractJs).href)})
const text = await cv.extractPdfText(new Uint8Array(readFileSync(${JSON.stringify(pdfPath)})))
if (!String(text).includes('ניסיון במכירות בתל אביב') || !String(text).includes('שירות לקוחות')) {
  console.error('compiled hebrew extract failed', JSON.stringify(text))
  process.exit(1)
}
console.log('wa-note-draft esm load ok')
`)

const result = spawnSync(process.execPath, [probe], { encoding: 'utf8' })
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
assert.equal(result.status, 0)
