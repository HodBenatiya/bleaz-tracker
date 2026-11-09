import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { extractCvText, extractDocxText, extractPdfText } from '../src/utils/extractCvText'
import { draftFromText, extractNoteFacts } from '../src/utils/noteDraft'

const chat = 'שלום, אני גר בתל אביב ומחפש משרה מלאה במוקד שירות. זמין מיידית. גיל 29. פונה לגבי נציג מכירות.'
const cv = 'ניסיון של שנתיים במכירות. תואר ראשון. שפות: עברית ואנגלית. יליד 1996.'
const draft = draftFromText(chat, cv, ['צורף צילום (cv.jpg) — לא חולץ טקסט מתמונה'])
assert.ok(draft.startsWith('טיוטה אוטומטית – לבדוק'))
assert.match(draft, /אזור: .*תל אביב/)
assert.match(draft, /היקף: .*משרה מלאה/)
assert.match(draft, /ניסיון: .*מוקד/)
assert.match(draft, /השכלה: .*תואר/)
assert.match(draft, /זמינות:/)
assert.match(draft, /משרה שפנה אליה: .*נציג מכירות/)
assert.match(draft, /גיל 29/)
assert.match(draft, /לא חולץ טקסט מתמונה/)
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

console.log('note draft selfcheck ok')
