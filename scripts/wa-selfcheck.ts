import assert from 'node:assert/strict'
import { applyKnownLid, buildWaThreads, isOwnWaIdentity, mergeWaMessages, mergeCandidateSave, messageKey, phoneKey, stampStatusChange, toLocalPhone, toWhatsAppChatId } from '../src/utils/wa'
import { messageIdOf, parseProviderWebhook } from '../src/utils/waParse'
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

const image = parseProviderWebhook({
  event: 'message',
  payload: {
    id: 'false_972521111111@c.us_IMG',
    timestamp: 1667561485,
    from: '972521111111@c.us',
    fromMe: false,
    body: '',
    hasMedia: true,
    media: { mimetype: 'image/jpeg', caption: 'הנה תמונה', url: 'http://localhost:3000/api/files/a.jpg' },
  },
})
assert.equal(image.kind, 'message')
if (image.kind === 'message') {
  assert.equal(image.message.type, 'image')
  assert.equal(image.message.text, 'הנה תמונה')
  assert.equal(image.message.hasMedia, true)
  assert.equal(image.message.downloadUrl, 'http://localhost:3000/api/files/a.jpg')
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
  waMessages: [{ id: 'm1', direction: 'in', text: 'א', timestamp: '2026-01-01T00:00:00.000Z', type: 'text', source: 'waha' }],
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
    messages: [{ id: 'l1', direction: 'in', text: 'עבודה?', timestamp: '2026-02-01T00:00:00.000Z', type: 'text', source: 'waha' }],
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
    waMessages: [{ id: 'x', source: 'waha' }, { id: 'y', text: 12, timestamp: undefined, source: 'waha' }],
  }] as Candidate[],
  null as unknown as [],
)
assert.equal(broken.length, 1)
assert.equal(broken[0].messages.length, 2)

const legacy = buildWaThreads([{
  ...base,
  id: 'legacy',
  name: 'דניאלה',
  phone: '0544444444',
  waMessages: [{ id: 'old1', text: 'היי', dir: 'out', at: '2026-03-01T00:00:00.000Z' }],
}] as Candidate[], [])
assert.equal(legacy.length, 0)
assert.equal(mergeCandidateSave(oldCandidate, { ...oldCandidate, city: 'עכו' }).city, 'עכו')

assert.equal(isOwnWaIdentity('82077663920366@lid'), true)
assert.equal(isOwnWaIdentity('0559817733'), true)
assert.equal(isOwnWaIdentity('972559817733'), true)
assert.equal(isOwnWaIdentity('268371165761674@lid'), false)

const resolved = applyKnownLid({
  chatId: '268371165761674@lid',
  phoneJid: '972521112233@c.us',
})
assert.equal(resolved.self, false)
assert.equal(resolved.phone, '0521112233')
assert.equal(resolved.chatId, '972521112233@c.us')
assert.equal(applyKnownLid({ chatId: '82077663920366@lid' }).self, true)

const lidThreads = buildWaThreads([], [{
  id: 'wa_lid268371165761674',
  phone: '268371165761674',
  chatId: '268371165761674@lid',
  name: 'יוסי',
  messages: [{ id: 'm', direction: 'in', text: 'שלום', timestamp: '2026-04-01T00:00:00.000Z', type: 'text', source: 'waha' }],
  unread: 1,
  lastMessageAt: '2026-04-01T00:00:00.000Z',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  phoneUnresolved: true,
}])
assert.equal(lidThreads.length, 1)
assert.equal(lidThreads[0].title, 'יוסי')
assert.equal(lidThreads[0].phoneLabel, 'מאתר מספר…')

const named = buildWaThreads([], [{
  id: 'wa_521112233',
  phone: '0521112233',
  chatId: '972521112233@c.us',
  name: '0521112233',
  pushName: 'מאיה',
  pictureUrl: 'https://pps.whatsapp.net/v/t61/photo.jpg',
  provider: 'waha',
  messages: [{ id: 'n1', direction: 'in', text: 'היי', timestamp: '2026-05-01T00:00:00.000Z', type: 'text', source: 'waha' }],
  unread: 0,
  lastMessageAt: '2026-05-01T00:00:00.000Z',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
}])
assert.equal(named[0].title, 'מאיה')
assert.equal(named[0].phoneLabel, '052-1112233')
assert.equal(named[0].avatarUrl, 'https://pps.whatsapp.net/v/t61/photo.jpg')

const pushed = parseProviderWebhook({
  event: 'message',
  payload: {
    id: 'false_972521112233@c.us_P',
    timestamp: 1700000000,
    from: '972521112233@c.us',
    fromMe: false,
    body: 'שלום',
    _data: { Info: { PushName: 'מאיה כהן' } },
  },
})
assert.equal(pushed.kind, 'message')
if (pushed.kind === 'message') assert.equal(pushed.message.senderName, 'מאיה כהן')

assert.equal(messageIdOf({ key: { id: '3EB0AAA', remoteJid: '972521111111@c.us', fromMe: true } }), 'true_972521111111@c.us_3EB0AAA')
assert.equal(messageKey('true_972521111111@c.us_3EB0AAA'), '3EB0AAA')
const once = mergeWaMessages(
  [{ id: 'local_1', direction: 'out', text: 'היי', timestamp: '2026-06-01T00:00:00.000Z', type: 'text', source: 'waha' }],
  [{ id: 'true_972521111111@c.us_3EB0AAA', direction: 'out', text: 'היי', timestamp: '2026-06-01T00:00:20.000Z', type: 'text', source: 'waha' }],
)
assert.equal(once.length, 1)
assert.equal(once[0].id, 'true_972521111111@c.us_3EB0AAA')

const own = buildWaThreads([], [{
  id: 'wa_lid82077663920366',
  phone: '82077663920366',
  chatId: '82077663920366@lid',
  name: 'BLEAZ',
  messages: [{ id: 'self', direction: 'in', text: 'בדיקה', timestamp: '2026-04-01T00:00:00.000Z', type: 'text', source: 'waha' }],
  unread: 0,
  lastMessageAt: '2026-04-01T00:00:00.000Z',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
}])
assert.equal(own.length, 0)

const greenPayload = parseProviderWebhook({
  typeWebhook: 'incomingMessageReceived',
  timestamp: 1667561485,
  idMessage: 'G1',
  senderData: { chatId: '972521111111@c.us', senderName: 'HOSHEN' },
  messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'היי' } },
})
assert.equal(greenPayload.kind, 'message')
if (greenPayload.kind === 'message') assert.equal(greenPayload.message.source, 'greenapi')

const lidPayload = parseProviderWebhook({
  event: 'message',
  session: 'default',
  payload: {
    id: 'false_268371165761674@lid_AAA',
    timestamp: 1667561485,
    from: '268371165761674@lid',
    fromMe: false,
    body: 'אפשר פרטים?',
    _data: { key: { remoteJid: '268371165761674@lid', remoteJidAlt: '972521112233@s.whatsapp.net' } },
  },
})
assert.equal(lidPayload.kind, 'message')
if (lidPayload.kind === 'message') {
  assert.equal(lidPayload.message.source, 'waha')
  assert.equal(lidPayload.message.phoneJid, '972521112233@c.us')
  assert.equal(lidPayload.message.lid, '268371165761674@lid')
}

console.log('wa selfcheck ok')
