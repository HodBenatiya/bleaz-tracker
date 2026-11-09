import { unzipSync } from 'fflate'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { inflateRawSync } from 'node:zlib'
import { looksLikeCv } from './wa'

const MAX_TEXT = 20_000
const MAX_PDF_PAGES = 12

type PdfTextItem = { str?: string; dir?: string; transform?: number[] }

let workerReady: Promise<void> | null = null

function ensurePdfWorker(): Promise<void> {
  if (!workerReady) {
    workerReady = import('pdfjs-dist/legacy/build/pdf.worker.mjs').then(mod => {
      const target = globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler: unknown } }
      target.pdfjsWorker = { WorkerMessageHandler: mod.WorkerMessageHandler }
    })
  }
  return workerReady
}

function isCvPrintable(ch: string): boolean {
  const code = ch.codePointAt(0) || 0
  if (ch === '\n' || ch === '\r' || ch === '\t') return true
  if (code >= 0x20 && code <= 0x7e) return true
  return code >= 0x0590 && code <= 0x05ff
}

/** Reject binary noise. A real CV is mostly letters; the old extractor scored ~0.34 printable. */
export function isUsableCvText(text: string): boolean {
  const raw = text.replace(/\u0000/g, '')
  if (raw.trim().length < 8) return false
  let printable = 0
  let letters = 0
  for (const ch of raw) {
    if (isCvPrintable(ch)) printable++
    if (/[\p{Script=Hebrew}A-Za-z]/u.test(ch)) letters++
  }
  if (printable / raw.length < 0.6) return false
  if (letters < 8) return false
  if (letters / raw.length < 0.25) return false
  return true
}

function linesFromPdfItems(items: PdfTextItem[]): string {
  const rows: { y: number; cells: { x: number; str: string; dir: string }[] }[] = []
  for (const item of items) {
    const str = (item.str || '').replace(/\u0000/g, '')
    if (!str.trim() || !item.transform) continue
    const x = item.transform[4] || 0
    const y = Math.round(item.transform[5] || 0)
    let row = rows.find(entry => Math.abs(entry.y - y) <= 2)
    if (!row) {
      row = { y, cells: [] }
      rows.push(row)
    }
    row.cells.push({ x, str, dir: item.dir || 'ltr' })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows.map(row => {
    const rtl = row.cells.filter(cell => cell.dir === 'rtl').length >= row.cells.filter(cell => cell.dir !== 'rtl').length
    row.cells.sort((a, b) => rtl ? b.x - a.x : a.x - b.x)
    return row.cells.map(cell => cell.str).join(' ').replace(/[^\S\n]+/g, ' ').trim()
  }).filter(Boolean).join('\n')
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  if (!bytes?.byteLength) return ''
  await ensurePdfWorker()
  const task = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    verbosity: 0,
  })
  try {
    const doc = await task.promise
    const parts: string[] = []
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES)
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const line = linesFromPdfItems(content.items as PdfTextItem[])
      if (line) parts.push(line)
    }
    const text = parts.join('\n').trim()
    return isUsableCvText(text) ? text.slice(0, MAX_TEXT) : ''
  } catch {
    return ''
  } finally {
    await task.destroy().catch(() => undefined)
  }
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function readZipEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  const view = Buffer.from(bytes)
  let offset = 0
  while (offset + 30 < view.length) {
    if (view.readUInt32LE(offset) !== 0x04034b50) {
      offset++
      continue
    }
    const method = view.readUInt16LE(offset + 8)
    const compressed = view.readUInt32LE(offset + 18)
    const nameLen = view.readUInt16LE(offset + 26)
    const extraLen = view.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const fileName = view.subarray(nameStart, nameStart + nameLen).toString('utf8')
    const dataStart = nameStart + nameLen + extraLen
    const dataEnd = dataStart + compressed
    if (dataEnd > view.length) return null
    if (fileName === name) {
      const data = view.subarray(dataStart, dataEnd)
      if (method === 0) return new Uint8Array(data)
      if (method === 8) {
        try { return new Uint8Array(inflateRawSync(data)) } catch { return null }
      }
      return null
    }
    offset = dataEnd
  }
  return null
}

export function extractDocxText(bytes: Uint8Array): string {
  const xml = readZipEntry(bytes, 'word/document.xml')
  if (!xml) return ''
  return xmlToText(Buffer.from(xml).toString('utf8')).slice(0, MAX_TEXT)
}

const MAX_ZIP_ENTRY = 15_000_000

export interface CvMessageRef {
  fileName?: string
  mimeType?: string
  type?: string
}

export type CvPayload =
  | { kind: 'text'; text: string }
  | { kind: 'image'; bytes: Uint8Array; mime: string }
  | { kind: 'unsupported' }
  | { kind: 'empty' }

export interface CvReadResult {
  text: string
  status: 'text' | 'image' | 'unsupported' | 'empty'
}

function normZipName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
}

export function isPagesFile(fileName?: string, mime?: string): boolean {
  const name = (fileName || '').toLowerCase()
  const type = (mime || '').toLowerCase()
  return name.endsWith('.pages') || type.includes('iwork-pages') || type.includes('sffpages') || type.includes('vnd.apple.pages')
}

export function isRasterCv(fileName?: string, mime?: string): boolean {
  const name = (fileName || '').toLowerCase()
  const type = (mime || '').toLowerCase().split(';')[0].trim()
  if (/\.(jpe?g|png|webp|heic|heif)$/.test(name)) return true
  return type === 'image/jpeg' || type === 'image/jpg' || type === 'image/pjpeg'
    || type === 'image/png' || type === 'image/webp'
    || type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence'
}

export function imageMime(fileName?: string, mime?: string): string {
  const type = (mime || '').toLowerCase().split(';')[0].trim()
  if (type === 'image/jpg' || type === 'image/pjpeg') return 'image/jpeg'
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' || type === 'image/gif') return type
  if (type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence') return 'image/heic'
  const name = (fileName || '').toLowerCase()
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.gif')) return 'image/gif'
  if (name.endsWith('.heic') || name.endsWith('.heif')) return 'image/heic'
  return 'image/jpeg'
}

function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

function isPdfBytes(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 5))).toString('latin1')
  return head === '%PDF-'
}

function declaredPdf(fileName: string, mime: string): boolean {
  return fileName.endsWith('.pdf') || (mime.includes('pdf') && !mime.includes('pages'))
}

function declaredDocx(fileName: string, mime: string): boolean {
  return fileName.endsWith('.docx') || mime.includes('wordprocessingml')
}

async function pdfPayload(bytes: Uint8Array): Promise<CvPayload> {
  if (!isPdfBytes(bytes)) return { kind: 'unsupported' }
  const text = (await extractPdfText(bytes)).trim()
  return text ? { kind: 'text', text } : { kind: 'empty' }
}

function pickPagesPdf(names: string[]): string | null {
  const pdfs = names.filter(name => normZipName(name).endsWith('.pdf'))
  const score = (name: string) => {
    const n = normZipName(name)
    if (n === 'quicklook/preview.pdf') return 0
    if (n === 'preview.pdf' || n.endsWith('/preview.pdf')) return 1
    return 2
  }
  pdfs.sort((a, b) => score(a) - score(b) || a.length - b.length)
  return pdfs[0] || null
}

function pickPagesImage(names: string[]): string | null {
  const images = names.filter(name => /\.(jpe?g|png|webp)$/.test(normZipName(name)))
  const score = (name: string) => {
    const n = normZipName(name)
    if (n === 'preview.jpg' || n === 'preview.jpeg') return 0
    if (n === 'quicklook/thumbnail.jpg' || n === 'quicklook/thumbnail.jpeg') return 1
    if (n.endsWith('/preview.jpg') || n.endsWith('/preview.jpeg')) return 2
    if (n.endsWith('/thumbnail.jpg') || n.endsWith('/thumbnail.jpeg')) return 3
    if (n.includes('preview')) return 4
    if (n.includes('thumbnail')) return 5
    return 6
  }
  images.sort((a, b) => score(a) - score(b) || a.length - b.length)
  return images[0] || null
}

async function inspectPages(bytes: Uint8Array): Promise<CvPayload> {
  if (!isZipBytes(bytes)) return { kind: 'unsupported' }
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter(file) {
        if (file.compression !== 0 && file.compression !== 8) return false
        if (file.originalSize > MAX_ZIP_ENTRY) return false
        const name = normZipName(file.name)
        return name.endsWith('.pdf') || /\.(jpe?g|png|webp)$/.test(name)
      },
    })
  } catch {
    return { kind: 'unsupported' }
  }
  const names = Object.keys(files)
  const pdfName = pickPagesPdf(names)
  let sawPdf = false
  if (pdfName && files[pdfName]?.byteLength) {
    sawPdf = true
    const text = (await extractPdfText(files[pdfName])).trim()
    if (text) return { kind: 'text', text }
  }
  const imageName = pickPagesImage(names)
  if (imageName && files[imageName]?.byteLength) {
    return { kind: 'image', bytes: files[imageName], mime: imageMime(imageName) }
  }
  return sawPdf ? { kind: 'empty' } : { kind: 'unsupported' }
}

export async function inspectCv(bytes: Uint8Array, mime?: string, fileName?: string): Promise<CvPayload> {
  if (!bytes?.byteLength) return { kind: 'unsupported' }
  const name = (fileName || '').toLowerCase()
  const type = (mime || '').toLowerCase()
  if (isPagesFile(fileName, mime)) {
    const pages = await inspectPages(bytes)
    if (pages.kind !== 'unsupported') return pages
    if (isPdfBytes(bytes)) return pdfPayload(bytes)
    return { kind: 'unsupported' }
  }
  if (declaredPdf(name, type)) return pdfPayload(bytes)
  if (declaredDocx(name, type)) {
    if (!isZipBytes(bytes)) return { kind: 'unsupported' }
    const xml = readZipEntry(bytes, 'word/document.xml')
    if (!xml) return { kind: 'unsupported' }
    const text = xmlToText(Buffer.from(xml).toString('utf8')).trim().slice(0, MAX_TEXT)
    return text ? { kind: 'text', text } : { kind: 'empty' }
  }
  if (isPdfBytes(bytes)) return pdfPayload(bytes)
  if (isRasterCv(fileName, mime) || type.startsWith('image/')) {
    return { kind: 'image', bytes, mime: imageMime(fileName, mime) }
  }
  return { kind: 'unsupported' }
}

export async function extractCvText(bytes: Uint8Array, mime?: string, fileName?: string): Promise<string> {
  const found = await inspectCv(bytes, mime, fileName)
  return found.kind === 'text' ? found.text : ''
}

/** Reads a CV for the note draft. `readImage` is the single vision plug-in and may return null. */
export async function readCvForDraft(
  bytes: Uint8Array,
  mime: string | undefined,
  fileName: string | undefined,
  readImage: (bytes: Uint8Array, mime: string) => Promise<string | null>,
): Promise<CvReadResult> {
  const found = await inspectCv(bytes, mime, fileName)
  if (found.kind === 'text') {
    if (!isUsableCvText(found.text)) return { text: '', status: 'empty' }
    return { text: found.text, status: 'text' }
  }
  if (found.kind === 'unsupported') return { text: '', status: 'unsupported' }
  if (found.kind === 'empty') return { text: '', status: 'empty' }
  try {
    const text = (await readImage(found.bytes, found.mime))?.replace(/\u0000/g, '').trim() || ''
    if (text && isUsableCvText(text)) return { text: text.slice(0, MAX_TEXT), status: 'text' }
  } catch {
    /* keep the stored image and the Hebrew status in the draft */
  }
  return { text: '', status: 'image' }
}

/** Latest files worth a CV note. Photos are skipped when a PDF, Word, or Pages file is already attached, unless the photo itself looks like a CV. */
export function selectCvMessages<T extends CvMessageRef>(messages: T[]): T[] {
  const considered = messages.filter(message => {
    const type = message.type || ''
    if (type === 'audio' || type === 'video' || type === 'location' || type === 'contact') return false
    if (isPagesFile(message.fileName, message.mimeType) || declaredPdf((message.fileName || '').toLowerCase(), (message.mimeType || '').toLowerCase())) return true
    if (declaredDocx((message.fileName || '').toLowerCase(), (message.mimeType || '').toLowerCase())) return true
    if (isRasterCv(message.fileName, message.mimeType)) {
      if (type === 'sticker' && !looksLikeCv(message.fileName, message.mimeType) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(message.fileName || '')) return false
      return true
    }
    if (type === 'sticker') return false
    return looksLikeCv(message.fileName, message.mimeType)
  })
  const hasDocument = considered.some(message => {
    const name = (message.fileName || '').toLowerCase()
    const mime = (message.mimeType || '').toLowerCase()
    return isPagesFile(message.fileName, message.mimeType) || declaredPdf(name, mime) || declaredDocx(name, mime)
  })
  const chosen = considered.filter(message => {
    if (!isRasterCv(message.fileName, message.mimeType)) return true
    if (!hasDocument) return true
    return looksLikeCv(message.fileName, message.mimeType) || message.type === 'document'
  })
  return chosen.slice(-2)
}
