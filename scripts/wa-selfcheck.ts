import assert from 'node:assert/strict'
import { buildWaThreads, mergeCandidateSave, phoneKey, stampStatusChange, toLocalPhone, toWhatsAppChatId } from '../src/utils/wa'
import { parseProviderWebhook } from '../src/utils/waParse'
import type { Candidate } from '../src/types'

assert.equal(toLocalPhone('972521234567'), '0521234567')
assert.equal(toLocalPhone('052-123-4567'), '0521234567')
assert.equal(toWhatsAppChatId('0521234567'), '972521234567@c.us')
assert.equal(toWhatsAppChatId('+972 52-123-4567'), '972521234567@c.us')
assert.equal(toWhatsAppChatId('972521234567@c.us'), '972521234567@c.us')
assert.equal(phoneKey('972521234567@c.us'), '521234567')

const waha = parseProviderWebhook({
  event: 'message',
  session: 'default',
  payload: {
    id: 'false_972521234567@c.us_AAA',
    timestamp: 1667561485,
    from: '972521234567@c.us',
    fromMe: false,
    to: '972509999999@c.us',
    body: 'שלום',
    hasMedia: true,
    media: { url: 'https://waha.example/api/files/cv.pdf', mimetype: 'application/pdf', filename: 'cv.pdf' },
  },
})
assert.equal(waha.kind, 'message')
if (waha.kind === 'message') {
  assert.equal(waha.message.direction, 'in')
  assert.equal(waha.message.chatId, '972521234567@c.us')
  assert.equal(waha.message.type, 'document')
  assert.equal(waha.message.fileName, 'cv.pdf')
}

const mine = parseProviderWebhook({
  event: 'message.any',
  payload: {
    id: { _serialized: 'true_972521234567@c.us_BBB' },
    timestamp: 1667561500,
    from: '972509999999@c.us',
    fromMe: true,
    to: '972521234567@s.whatsapp.net',
    body: 'תודה',
  },
})
assert.equal(mine.kind, 'message')
if (mine.kind === 'message') {
  assert.equal(mine.message.direction, 'out')
  assert.equal(mine.message.chatId, '972521234567@c.us')
  assert.equal(mine.message.id, 'true_972521234567@c.us_BBB')
}

assert.equal(parseProviderWebhook({ event: 'session.status', payload: { status: 'SCAN_QR_CODE' } }).kind, 'session')
assert.equal(parseProviderWebhook({
  event: 'message',
  payload: { id: 'x', from: '123@g.us', body: 'group', timestamp: 10 },
}).kind, 'ignore')

const green = parseProviderWebhook({
  typeWebhook: 'incomingMessageReceived',
  timestamp: 1667561485,
  idMessage: 'GREEN1',
  senderData: { chatId: '972521234567@c.us', senderName: 'דנה' },
  messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'היי' } },
})
assert.equal(green.kind, 'message')
if (green.kind === 'message') {
  assert.equal(green.message.text, 'היי')
  assert.equal(green.message.senderName, 'דנה')
}

const base: Candidate = {
  id: 'c1', name: 'דנה', phone: '0521234567', status: 'new', positionType: '', source: 'WhatsApp',
  nonaStatus: '', notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  waMessages: [{ id: 'm1', direction: 'in', text: 'א', timestamp: '2026-01-01T00:00:00.000Z', type: 'text' }],
  waUnread: 1,
}
const edited: Candidate = { ...base, city: 'חיפה', waMessages: [], waUnread: 0, updatedAt: '2026-01-02T00:00:00.000Z' }
const merged = mergeCandidateSave(base, edited)
assert.equal(merged.city, 'חיפה')
assert.equal(merged.waMessages?.length, 1)
assert.equal(merged.waUnread, 1)
const read = mergeCandidateSave(base, { ...base, city: 'חיפה', waUnread: 0 })
assert.equal(read.waUnread, 0)
assert.equal(read.waMessages?.length, 1)

const stamped = stampStatusChange(base, { ...base, status: 'screening', updatedAt: base.updatedAt })
assert.equal(stamped.statusHistory?.length, 1)
assert.equal(stamped.statusHistory?.[0].from, 'new')
assert.equal(stamped.statusHistory?.[0].to, 'screening')
assert.notEqual(stamped.updatedAt, base.updatedAt)

const threads = buildWaThreads(
  [{ ...base, waUnread: 0 }],
  [{
    id: 'wa_509998887', phone: '0509998887', chatId: '972509998887@c.us', name: 'יוסי',
    messages: [{ id: 'l1', direction: 'in', text: 'עבודה?', timestamp: '2026-02-01T00:00:00.000Z', type: 'text' }],
    unread: 1, lastMessageAt: '2026-02-01T00:00:00.000Z', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
  }],
)
assert.equal(threads.length, 2)
assert.equal(threads[0].kind, 'lead')
assert.equal(threads[1].kind, 'candidate')

const oldCandidate = {
  ...base, id: 'old', name: 'ישן', phone: '0520000000', waMessages: undefined, waChatId: undefined, lastWaAt: undefined,
}
const broken = buildWaThreads(
  [oldCandidate, {
    ...base,
    id: 'broken',
    phone: '0533333333',
    waMessages: [{ id: 'x' }, { id: 'y', text: 12, timestamp: undefined }],
  }] as Candidate[],
  null as unknown as [],
)
assert.equal(broken.length, 1)
assert.equal(broken[0].messages.length, 2)
assert.equal(mergeCandidateSave(oldCandidate, { ...oldCandidate, city: 'עכו' }).city, 'עכו')

console.log('wa selfcheck ok')
