import { unzipSync } from 'fflate'
import { inflateRawSync, inflateSync } from 'node:zlib'
import { looksLikeCv } from './wa'

const MAX_TEXT = 20_000

function pushText(parts: string[], value: string) {
  const clean = value.replace(/\u0000/g, '').replace(/[^\S\n]+/g, ' ').trim()
  if (clean.length >= 2 && /[\p{L}\p{N}]/u.test(clean)) parts.push(clean)
}

function decodePdfLiteral(bytes: Uint8Array): string[] {
  const parts: string[] = []
  let i = 0
  while (i < bytes.length) {
    if (bytes[i] !== 0x28) { i++; continue }
    const chars: number[] = []
    let depth = 1
    i++
    while (i < bytes.length && depth > 0) {
      const byte = bytes[i]
      if (byte === 0x5c) {
        const next = bytes[++i]
        if (next === undefined) break
        if (next >= 0x30 && next <= 0x37) {
          let oct = String.fromCharCode(next)
          for (let extra = 0; extra < 2 && bytes[i + 1] >= 0x30 && bytes[i + 1] <= 0x37; extra++) {
            oct += String.fromCharCode(bytes[++i])
          }
          chars.push(parseInt(oct, 8) & 0xff)
        } else if (next === 0x6e) chars.push(10)
        else if (next === 0x72) chars.push(13)
        else if (next === 0x74) chars.push(9)
        else chars.push(next)
      } else if (byte === 0x28) {
        depth++
        chars.push(byte)
      } else if (byte === 0x29) {
        depth--
        if (depth > 0) chars.push(byte)
      } else chars.push(byte)
      i++
    }
    if (chars.length > 0 && chars.length < 800) {
      pushText(parts, new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(chars)))
    }
    i++
  }
  return parts
}

function decodePdfHex(bytes: Uint8Array): string[] {
  const latin = Buffer.from(bytes).toString('latin1')
  const parts: string[] = []
  const pattern = /<([0-9A-Fa-f\s]{8,})>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(latin))) {
    const hex = match[1].replace(/\s/g, '')
    if (hex.length < 8 || hex.length % 2) continue
    const raw = Buffer.from(hex, 'hex')
    if (raw[0] === 0xfe && raw[1] === 0xff && raw.length >= 4) {
      const swapped = Buffer.alloc(raw.length - 2)
      for (let i = 2; i + 1 < raw.length; i += 2) {
        swapped[i - 2] = raw[i + 1]
        swapped[i - 1] = raw[i]
      }
      pushText(parts, swapped.toString('utf16le'))
    }
  }
  return parts
}

function inflatePdfStreams(bytes: Uint8Array): Uint8Array[] {
  const latin = Buffer.from(bytes).toString('latin1')
  const streams: Uint8Array[] = []
  let from = 0
  while (from < latin.length) {
    const marker = latin.indexOf('/FlateDecode', from)
    if (marker < 0) break
    const streamAt = latin.indexOf('stream', marker)
    const endAt = streamAt >= 0 ? latin.indexOf('endstream', streamAt) : -1
    if (streamAt < 0 || endAt < 0) break
    let start = streamAt + 'stream'.length
    if (bytes[start] === 0x0d) start++
    if (bytes[start] === 0x0a) start++
    let stop = endAt
    if (bytes[stop - 1] === 0x0a) stop--
    if (bytes[stop - 1] === 0x0d) stop--
    const slice = bytes.subarray(start, stop)
    try { streams.push(inflateSync(slice)) } catch {
      try { streams.push(inflateRawSync(slice)) } catch { /* not a readable stream */ }
    }
    from = endAt + 'endstream'.length
  }
  return streams
}

export function extractPdfText(bytes: Uint8Array): string {
  const chunks = [bytes, ...inflatePdfStreams(bytes)]
  const parts = chunks.flatMap(chunk => [...decodePdfLiteral(chunk), ...decodePdfHex(chunk)])
  return [...new Set(parts)].join('\n').slice(0, MAX_TEXT)
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

function pdfPayload(bytes: Uint8Array): CvPayload {
  if (!isPdfBytes(bytes)) return { kind: 'unsupported' }
  const text = extractPdfText(bytes).trim()
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

function inspectPages(bytes: Uint8Array): CvPayload {
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
    const text = extractPdfText(files[pdfName]).trim()
    if (text) return { kind: 'text', text }
  }
  const imageName = pickPagesImage(names)
  if (imageName && files[imageName]?.byteLength) {
    return { kind: 'image', bytes: files[imageName], mime: imageMime(imageName) }
  }
  return sawPdf ? { kind: 'empty' } : { kind: 'unsupported' }
}

export function inspectCv(bytes: Uint8Array, mime?: string, fileName?: string): CvPayload {
  if (!bytes?.byteLength) return { kind: 'unsupported' }
  const name = (fileName || '').toLowerCase()
  const type = (mime || '').toLowerCase()
  if (isPagesFile(fileName, mime)) {
    const pages = inspectPages(bytes)
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

export function extractCvText(bytes: Uint8Array, mime?: string, fileName?: string): string {
  const found = inspectCv(bytes, mime, fileName)
  return found.kind === 'text' ? found.text : ''
}

/** Reads a CV for the note draft. `readImage` is the single vision plug-in and may return null. */
export async function readCvForDraft(
  bytes: Uint8Array,
  mime: string | undefined,
  fileName: string | undefined,
  readImage: (bytes: Uint8Array, mime: string) => Promise<string | null>,
): Promise<CvReadResult> {
  const found = inspectCv(bytes, mime, fileName)
  if (found.kind === 'text') return { text: found.text, status: 'text' }
  if (found.kind === 'unsupported') return { text: '', status: 'unsupported' }
  if (found.kind === 'empty') return { text: '', status: 'empty' }
  try {
    const text = (await readImage(found.bytes, found.mime))?.replace(/\u0000/g, '').trim() || ''
    if (text) return { text: text.slice(0, MAX_TEXT), status: 'text' }
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
