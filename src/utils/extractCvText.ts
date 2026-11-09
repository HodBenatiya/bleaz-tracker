import { inflateRawSync, inflateSync } from 'node:zlib'

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

export function extractCvText(bytes: Uint8Array, mime?: string, fileName?: string): string {
  const name = (fileName || '').toLowerCase()
  const type = (mime || '').toLowerCase()
  if (name.endsWith('.pdf') || type.includes('pdf')) return extractPdfText(bytes)
  if (name.endsWith('.docx') || type.includes('wordprocessingml')) return extractDocxText(bytes)
  return ''
}
