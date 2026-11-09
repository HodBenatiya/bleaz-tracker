import assert from 'node:assert/strict'
import { zipSync } from 'fflate'
import { deflateRawSync } from 'node:zlib'
import { readImageCv } from '../api/cvVision'
import { extractCvText, extractDocxText, extractPdfText, inspectCv, readCvForDraft, selectCvMessages } from '../src/utils/extractCvText'
import { draftFromText, extractNoteFacts, IMAGE_CV_STATUS, UNSUPPORTED_CV_STATUS } from '../src/utils/noteDraft'
import { looksLikeCv } from '../src/utils/wa'

const chat = 'שלום, אני גר בתל אביב ומחפש משרה מלאה במוקד שירות. זמין מיידית. גיל 29. פונה לגבי נציג מכירות.'
const cv = 'ניסיון של שנתיים במכירות. תואר ראשון. שפות: עברית ואנגלית. יליד 1996.'
const draft = draftFromText(chat, cv, [IMAGE_CV_STATUS])
assert.ok(draft.startsWith('טיוטה אוטומטית – לבדוק'))
assert.match(draft, /אזור: .*תל אביב/)
assert.match(draft, /היקף: .*משרה מלאה/)
assert.match(draft, /ניסיון: .*מוקד/)
assert.match(draft, /השכלה: .*תואר/)
assert.match(draft, /זמינות:/)
assert.match(draft, /משרה שפנה אליה: .*נציג מכירות/)
assert.match(draft, /גיל 29/)
assert.ok(draft.includes(IMAGE_CV_STATUS))
assert.doesNotMatch(draft, /ציון|ניקוד|\d+\s*%/)

const empty = draftFromText('', '')
assert.ok(empty.includes('לא נמצאו פרטים'))

const facts = extractNoteFacts('אין רישיון נהיגה, משרה חלקית בחיפה')
assert.ok(facts.area.includes('חיפה'))
assert.ok(facts.scope.includes('משרה חלקית'))
assert.ok(facts.notes.some(note => note.includes('אין רישיון')))

const pdf = Buffer.from('%PDF-1.1\n1 0 obj << /Length 5 >> stream\nBT (מכירות בתל אביב) Tj ET\nendstream\nendobj\n%%EOF')
assert.match(extractPdfText(pdf), /מכירות בתל אביב/)

const xml = Buffer.from('<?xml version="1.0"?><w:document><w:p><w:t>ניסיון בביטוח</w:t></w:p><w:p><w:t>תואר</w:t></w:p></w:document>')
const name = Buffer.from('word/document.xml')
const local = Buffer.alloc(30)
local.writeUInt32LE(0x04034b50, 0)
local.writeUInt32LE(xml.length, 18)
local.writeUInt32LE(xml.length, 22)
local.writeUInt16LE(name.length, 26)
const zip = Buffer.concat([local, name, xml])
assert.match(extractDocxText(zip), /ניסיון בביטוח/)
assert.match(extractCvText(zip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'cv.docx'), /תואר/)

const compressed = deflateRawSync(Buffer.from('(שירות לקוחות)'))
assert.match(extractPdfText(Buffer.concat([
  Buffer.from('%PDF-1.4\n/FlateDecode /Length ' + compressed.length + ' >> stream\n'),
  compressed,
  Buffer.from('\nendstream\n'),
])), /שירות לקוחות/)

function pdfWith(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(`%PDF-1.4\n(${text}) Tj\n%%EOF`))
}

const pagesPdf = zipSync({
  'Index/Document.iwa': new Uint8Array([1, 2, 3, 4]),
  'other/notes.pdf': pdfWith('לא זה'),
  'QuickLook/Preview.pdf': pdfWith('מכירות בתל אביב'),
  'preview.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
})
assert.match(extractCvText(pagesPdf, 'application/x-iwork-pages-sffpages', 'קורות.pages'), /מכירות בתל אביב/)
assert.doesNotMatch(extractCvText(pagesPdf, 'application/vnd.apple.pages', 'קורות.pages'), /לא זה/)
assert.equal(inspectCv(pagesPdf, '', 'a.pages').kind, 'text')
assert.equal(looksLikeCv('a.pages', ''), true)
assert.equal(looksLikeCv('scan.bin', 'application/x-iwork-pages-sffpages'), true)

let imageReads = 0
const pagesRead = await readCvForDraft(pagesPdf, 'application/x-iwork-pages-sffpages', 'a.pages', async () => {
  imageReads++
  return 'לא לקרוא'
})
assert.equal(imageReads, 0)
assert.equal(pagesRead.status, 'text')

const previewOnly = zipSync({
  'QuickLook/Thumbnail.jpg': new Uint8Array([1, 2, 3]),
  'preview.jpg': new Uint8Array([9, 9, 9]),
  'Index/Document.iwa': new Uint8Array([4]),
})
const preview = inspectCv(previewOnly, 'application/x-iwork-pages-sffpages', 'cv.pages')
assert.equal(preview.kind, 'image')
if (preview.kind === 'image') {
  assert.equal(preview.mime, 'image/jpeg')
  assert.deepEqual([...preview.bytes], [9, 9, 9])
}
const previewRead = await readCvForDraft(previewOnly, '', 'cv.pages', async () => null)
assert.equal(previewRead.status, 'image')
const previewText = await readCvForDraft(previewOnly, '', 'cv.pages', async () => 'ניסיון במוקד')
assert.equal(previewText.status, 'text')
assert.match(previewText.text, /מוקד/)

const thumbnailOnly = zipSync({ 'QuickLook/Thumbnail.jpg': new Uint8Array([4, 5, 6]) })
const thumbnail = inspectCv(thumbnailOnly, '', 'job.pages')
assert.equal(thumbnail.kind, 'image')
if (thumbnail.kind === 'image') assert.deepEqual([...thumbnail.bytes], [4, 5, 6])

const imagePdf = zipSync({
  'QuickLook/Preview.pdf': new Uint8Array(Buffer.from('%PDF-1.4\n%%EOF')),
  'preview.jpg': new Uint8Array([7, 7]),
})
assert.equal(inspectCv(imagePdf, '', 'scan.pages').kind, 'image')

const iwaOnly = zipSync({ 'Index/Document.iwa': new Uint8Array([1, 2, 3]) })
assert.equal(inspectCv(iwaOnly, '', 'broken.pages').kind, 'unsupported')
assert.equal(inspectCv(new Uint8Array([1, 2, 3, 4]), 'application/x-iwork-pages-sffpages', 'bad.pages').kind, 'unsupported')
assert.equal(inspectCv(new Uint8Array([1, 2, 3]), 'application/pdf', 'cv.pdf').kind, 'unsupported')
assert.equal(inspectCv(new Uint8Array([1, 2, 3]), 'application/rtf', 'קורות.rtf').kind, 'unsupported')
assert.equal(inspectCv(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg', 'cv.jpg').kind, 'image')
assert.equal(inspectCv(new Uint8Array([1]), 'image/heic', 'photo.heic').kind, 'image')
if (inspectCv(new Uint8Array([1]), '', 'photo.heic').kind === 'image') {
  assert.equal(inspectCv(new Uint8Array([1]), '', 'photo.heic').mime, 'image/heic')
}

const imageDraft = draftFromText(chat, '', [IMAGE_CV_STATUS])
assert.ok(imageDraft.startsWith('טיוטה אוטומטית – לבדוק'))
assert.match(imageDraft, /תל אביב/)
assert.ok(imageDraft.includes(IMAGE_CV_STATUS))
const unsupportedDraft = draftFromText(chat, '', [UNSUPPORTED_CV_STATUS])
assert.match(unsupportedDraft, /משרה מלאה/)
assert.ok(unsupportedDraft.includes(UNSUPPORTED_CV_STATUS))
assert.equal(UNSUPPORTED_CV_STATUS, 'פורמט קובץ לא נתמך – בקשו מהמועמד PDF או Word')

const withPdf = selectCvMessages([
  { type: 'image', mimeType: 'image/jpeg', fileName: 'IMG.jpg' },
  { type: 'document', mimeType: 'application/pdf', fileName: 'cv.pdf' },
])
assert.deepEqual(withPdf.map(file => file.fileName), ['cv.pdf'])

const photos = selectCvMessages([
  { type: 'image', mimeType: 'image/jpeg', fileName: 'IMG1.jpg' },
  { type: 'image', mimeType: 'image/heic', fileName: 'IMG2.heic' },
  { type: 'image', mimeType: 'image/png', fileName: 'IMG3.png' },
])
assert.deepEqual(photos.map(file => file.fileName), ['IMG2.heic', 'IMG3.png'])

const namedWebp = selectCvMessages([{ type: 'sticker', mimeType: 'image/webp', fileName: 'scan.webp' }])
assert.equal(namedWebp.length, 1)
const anonSticker = selectCvMessages([{ type: 'sticker', mimeType: 'image/webp' }])
assert.equal(anonSticker.length, 0)
assert.equal(selectCvMessages([{ type: 'audio', fileName: 'cv.pdf', mimeType: 'application/pdf' }]).length, 0)
assert.equal(selectCvMessages([{ type: 'document', fileName: 'קורות.rtf', mimeType: 'application/rtf' }]).length, 1)
assert.equal(selectCvMessages([{ type: 'document', mimeType: 'application/x-iwork-pages-sffpages' }]).length, 1)

const prevKey = process.env.OPENAI_API_KEY
const prevBase = process.env.OPENAI_BASE_URL
const prevModel = process.env.OPENAI_MODEL
const prevFetch = globalThis.fetch
let fetches = 0
try {
  delete process.env.OPENAI_API_KEY
  globalThis.fetch = (async () => {
    fetches++
    return new Response('{}', { status: 500 })
  }) as typeof fetch
  assert.equal(await readImageCv(new Uint8Array(64), 'image/jpeg'), null)
  assert.equal(fetches, 0)

  process.env.OPENAI_API_KEY = 'test-key'
  process.env.OPENAI_BASE_URL = 'https://vision.example/v1'
  process.env.OPENAI_MODEL = 'gpt-4o-mini'
  assert.equal(await readImageCv(new Uint8Array(64), 'image/heic'), null)
  assert.equal(await readImageCv(new Uint8Array(8), 'image/jpeg'), null)
  assert.equal(fetches, 0)

  let seen: { url: string; body: { model?: string; messages?: { content?: { image_url?: { detail?: string; url?: string } }[] }[] } } | null = null
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    fetches++
    seen = { url: String(url), body: JSON.parse(String(init?.body || '{}')) }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ניסיון במכירות' } }] }), { status: 200 })
  }) as typeof fetch
  assert.equal(await readImageCv(new Uint8Array(64).fill(7), 'image/jpeg'), 'ניסיון במכירות')
  assert.equal(fetches, 1)
  assert.equal(seen?.url, 'https://vision.example/v1/chat/completions')
  assert.equal(seen?.body.model, 'gpt-4o-mini')
  assert.equal(seen?.body.messages?.[1]?.content?.[1]?.image_url?.detail, 'low')
  assert.match(seen?.body.messages?.[1]?.content?.[1]?.image_url?.url || '', /^data:image\/jpeg;base64,/)

  globalThis.fetch = (async () => new Response('no', { status: 401 })) as typeof fetch
  assert.equal(await readImageCv(new Uint8Array(64), 'image/png'), null)
} finally {
  globalThis.fetch = prevFetch
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = prevKey
  if (prevBase === undefined) delete process.env.OPENAI_BASE_URL
  else process.env.OPENAI_BASE_URL = prevBase
  if (prevModel === undefined) delete process.env.OPENAI_MODEL
  else process.env.OPENAI_MODEL = prevModel
}

console.log('note draft selfcheck ok')
