import type { WaDeliveryStatus, WaMessageType } from '../types'
import { typeFromMime } from './wa.js'

export interface ParsedMessage {
  id: string
  chatId: string
  direction: 'in' | 'out'
  text: string
  timestamp: string
  type: WaMessageType
  fileName?: string
  mimeType?: string
  downloadUrl?: string
  senderName?: string
  hasMedia?: boolean
  lid?: string
  phoneJid?: string
  unresolved?: boolean
  source?: 'waha' | 'greenapi'
}

export type WaInbound =
  | { kind: 'message'; message: ParsedMessage }
  | { kind: 'ack'; chatId: string; id: string; status: WaDeliveryStatus }
  | { kind: 'session'; status: string }
  | { kind: 'ignore'; reason: string }

function asRecord(body: unknown): Record<string, any> {
  if (typeof body === 'string') {
    try { return JSON.parse(body) } catch { return {} }
  }
  if (body && typeof body === 'object') return body as Record<string, any>
  return {}
}

function isoFromUnix(ts: unknown): string {
  const n = typeof ts === 'number' ? ts : Number(ts)
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString()
  const ms = n < 1e12 ? n * 1000 : n
  return new Date(ms).toISOString()
}

export function messageIdOf(id: unknown): string {
  if (typeof id === 'string') return id
  if (!id || typeof id !== 'object') return ''
  const o = id as Record<string, any>
  if (typeof o._serialized === 'string' && o._serialized) return o._serialized
  if (o.key && o.key !== o) {
    const fromKey = messageIdOf(o.key)
    if (fromKey) return fromKey
  }
  const remote = typeof o.remote === 'string' ? o.remote : typeof o.remoteJid === 'string' ? o.remoteJid.replace('@s.whatsapp.net', '@c.us') : ''
  if (typeof o.id === 'string' && o.id && remote) return `${o.fromMe ? 'true' : 'false'}_${remote}_${o.id}`
  if (typeof o.id === 'string' && o.id) return o.id
  if (o.id && typeof o.id === 'object' && o.id !== o) return messageIdOf(o.id)
  if (o._data && o._data !== o) return messageIdOf(o._data)
  return ''
}

function jid(value: unknown): string {
  return String(value ?? '').trim().replace('@s.whatsapp.net', '@c.us')
}

function isSkippableChat(id: string): boolean {
  if (!id) return true
  return id.endsWith('@g.us') || id.endsWith('@newsletter') || id.endsWith('@broadcast') || id === 'status@broadcast'
}

function cleanName(name: unknown, chatId: string): string {
  const n = String(name ?? '').trim()
  if (!n) return ''
  const digits = n.replace(/\D/g, '')
  const chatDigits = chatId.replace(/\D/g, '')
  if (digits && (digits === chatDigits || chatDigits.endsWith(digits) || digits.endsWith(chatDigits))) return ''
  return n
}

function ackToStatus(ackName: unknown, ack: unknown): WaDeliveryStatus | null {
  const name = String(ackName ?? '').toUpperCase()
  if (name === 'ERROR') return 'failed'
  if (name === 'PENDING') return 'pending'
  if (name === 'SERVER') return 'sent'
  if (name === 'DEVICE') return 'delivered'
  if (name === 'READ' || name === 'PLAYED') return 'read'
  const n = typeof ack === 'number' ? ack : Number(ack)
  if (n === -1) return 'failed'
  if (n === 0) return 'pending'
  if (n === 1) return 'sent'
  if (n === 2) return 'delivered'
  if (n === 3 || n === 4) return 'read'
  return null
}

function contactJid(payload: Record<string, any>): string {
  const chat = jid(payload.chatId)
  const from = jid(payload.from)
  const to = jid(payload.to)
  if (chat && !isSkippableChat(chat)) return chat
  if (payload.fromMe) {
    if (to && !isSkippableChat(to)) return to
    if (from && !isSkippableChat(from)) return from
  } else {
    if (from && !isSkippableChat(from)) return from
    if (to && !isSkippableChat(to)) return to
  }
  return ''
}

function readPath(obj: Record<string, any>, path: string[]): unknown {
  let cur: any = obj
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}

const PHONE_JID_PATHS = [
  ['_data', 'key', 'remoteJidAlt'],
  ['_data', 'key', 'participantAlt'],
  ['_data', 'key', 'senderPn'],
  ['_data', 'key', 'participantPn'],
  ['_data', 'senderPn'],
  ['_data', 'participantPn'],
  ['senderPn'],
  ['participantPn'],
]

function phoneJidFromPayload(payload: Record<string, any>): string {
  for (const path of PHONE_JID_PATHS) {
    const id = jid(readPath(payload, path))
    if (id.endsWith('@c.us')) return id
  }
  const info = payload?._data?.Info
  for (const value of [info?.SenderAlt, info?.RecipientAlt, info?.Sender]) {
    const id = jid(value)
    if (id.endsWith('@c.us')) return id
  }
  return ''
}

function lidFromPayload(payload: Record<string, any>, chatId: string): string {
  if (chatId.endsWith('@lid')) return chatId
  for (const value of [payload.from, payload.chatId, payload._data?.key?.remoteJid, payload._data?.key?.participant]) {
    const id = jid(value)
    if (id.endsWith('@lid')) return id
  }
  return ''
}

function parseWahaMessage(payload: Record<string, any>, directionHint?: 'in' | 'out'): ParsedMessage | null {
  const chatId = contactJid(payload)
  if (!chatId) return null
  const id = messageIdOf(payload.id)
  if (!id) return null
  const media = payload.media && typeof payload.media === 'object' ? payload.media : null
  const mime = typeof media?.mimetype === 'string' ? media.mimetype : typeof media?.mimeType === 'string' ? media.mimeType : undefined
  const fileName = typeof media?.filename === 'string' && media.filename ? media.filename : undefined
  const downloadUrl = typeof media?.url === 'string' && media.url ? media.url : undefined
  const caption = typeof media?.caption === 'string' ? media.caption : ''
  const hasMedia = payload.hasMedia === true || !!downloadUrl
  const vcard = Array.isArray(payload.vCards) && payload.vCards.length ? String(payload.vCards[0]) : ''
  let type: WaMessageType = 'text'
  let text = typeof payload.body === 'string' ? payload.body : ''
  if (!text && caption) text = caption
  if (hasMedia) {
    type = typeFromMime(mime, fileName)
    if (type === 'other') type = 'document'
  }
  else if (vcard) { type = 'contact'; text = text || 'איש קשר' }
  else if (payload.location) { type = 'location'; text = text || 'מיקום' }
  const direction: 'in' | 'out' = directionHint ?? (payload.fromMe ? 'out' : 'in')
  const senderName = direction === 'in'
    ? cleanName(
      payload.notifyName || payload.pushName ||
      payload._data?.notifyName || payload._data?.pushName ||
      payload._data?.Info?.PushName || payload._data?.Info?.pushName,
      chatId,
    )
    : ''
  return {
    id,
    chatId,
    direction,
    text: text || '',
    timestamp: isoFromUnix(payload.timestamp),
    type,
    fileName,
    mimeType: mime,
    downloadUrl,
    senderName: senderName || undefined,
    hasMedia,
    lid: lidFromPayload(payload, chatId) || undefined,
    phoneJid: phoneJidFromPayload(payload) || undefined,
    source: 'waha',
  }
}

function parseWaha(body: Record<string, any>): WaInbound {
  const event = String(body.event ?? '')
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}
  if (event === 'session.status') {
    const status = String(payload.status ?? '')
    return status ? { kind: 'session', status } : { kind: 'ignore', reason: 'session-empty' }
  }
  if (event === 'message.ack') {
    const id = messageIdOf(payload.id)
    const status = ackToStatus(payload.ackName, payload.ack)
    if (!id || !status) return { kind: 'ignore', reason: 'ack-empty' }
    return { kind: 'ack', chatId: contactJid(payload), id, status }
  }
  if (event === 'message' || event === 'message.any') {
    const message = parseWahaMessage(payload)
    if (!message) return { kind: 'ignore', reason: 'skipped-chat' }
    return { kind: 'message', message }
  }
  return { kind: 'ignore', reason: event ? `ignored-${event}` : 'unknown-event' }
}

function greenChat(body: Record<string, any>): string {
  const sender = body.senderData && typeof body.senderData === 'object' ? body.senderData : {}
  return jid(body.chatId || sender.chatId || sender.sender)
}

function parseGreenMessage(body: Record<string, any>): ParsedMessage | null {
  const typeWebhook = String(body.typeWebhook ?? '')
  const chatId = greenChat(body)
  if (!chatId || isSkippableChat(chatId)) return null
  const id = String(body.idMessage ?? '')
  if (!id) return null
  const md = body.messageData && typeof body.messageData === 'object' ? body.messageData : {}
  const typeMessage = String(md.typeMessage ?? '')
  const file = md.fileMessageData && typeof md.fileMessageData === 'object' ? md.fileMessageData : null
  let text = ''
  let type: WaMessageType = 'text'
  let fileName: string | undefined
  let mimeType: string | undefined
  let downloadUrl: string | undefined
  if (typeMessage === 'textMessage') text = String(md.textMessageData?.textMessage ?? '')
  else if (typeMessage === 'extendedTextMessage' || typeMessage === 'quotedMessage') text = String(md.extendedTextMessageData?.text ?? '')
  else if (typeMessage === 'buttonsResponseMessage') text = String(md.buttonsResponseMessageData?.selectedButtonText ?? '')
  else if (typeMessage === 'listResponseMessage') text = String(md.listResponseMessageData?.title ?? '')
  else if (typeMessage === 'locationMessage') { type = 'location'; text = 'מיקום' }
  else if (typeMessage === 'contactMessage' || typeMessage === 'contactsArrayMessage') {
    type = 'contact'
    text = String(md.contactMessageData?.displayName ?? 'איש קשר')
  }
  if (file) {
    fileName = typeof file.fileName === 'string' ? file.fileName : undefined
    mimeType = typeof file.mimeType === 'string' ? file.mimeType : undefined
    downloadUrl = typeof file.downloadUrl === 'string' ? file.downloadUrl : undefined
    const caption = typeof file.caption === 'string' ? file.caption : ''
    text = caption || text
    if (typeMessage === 'imageMessage') type = 'image'
    else if (typeMessage === 'videoMessage') type = 'video'
    else if (typeMessage === 'audioMessage') type = 'audio'
    else if (typeMessage === 'documentMessage') type = 'document'
    else if (typeMessage === 'stickerMessage') type = 'sticker'
    else type = typeFromMime(mimeType, fileName)
  }
  if (!text && type === 'text') text = ''
  const direction: 'in' | 'out' = typeWebhook === 'incomingMessageReceived' ? 'in' : 'out'
  const sender = body.senderData || {}
  const senderName = direction === 'in' ? cleanName(sender.senderContactName || sender.senderName || sender.chatName, chatId) : ''
  return {
    id,
    chatId,
    direction,
    text,
    timestamp: isoFromUnix(body.timestamp),
    type,
    fileName,
    mimeType,
    downloadUrl,
    senderName: senderName || undefined,
    hasMedia: !!file,
    source: 'greenapi',
  }
}

function parseGreenStatus(raw: string): WaDeliveryStatus | null {
  const s = raw.toLowerCase()
  if (s === 'sent') return 'sent'
  if (s === 'delivered') return 'delivered'
  if (s === 'read') return 'read'
  if (s === 'failed' || s === 'noaccount' || s === 'notingroup' || s === 'yellowcard') return 'failed'
  return null
}

function parseGreen(body: Record<string, any>): WaInbound {
  const typeWebhook = String(body.typeWebhook ?? '')
  if (typeWebhook === 'outgoingMessageStatus') {
    const id = String(body.idMessage ?? '')
    const status = parseGreenStatus(String(body.status ?? ''))
    if (!id || !status) return { kind: 'ignore', reason: 'ack-empty' }
    return { kind: 'ack', chatId: greenChat(body), id, status }
  }
  if (
    typeWebhook === 'incomingMessageReceived' ||
    typeWebhook === 'outgoingMessageReceived' ||
    typeWebhook === 'outgoingAPIMessageReceived'
  ) {
    const message = parseGreenMessage(body)
    if (!message) return { kind: 'ignore', reason: 'skipped-chat' }
    return { kind: 'message', message }
  }
  return { kind: 'ignore', reason: typeWebhook ? `ignored-${typeWebhook}` : 'unknown-event' }
}

export function parseProviderWebhook(body: unknown): WaInbound {
  const record = asRecord(body)
  if (typeof record.event === 'string') return parseWaha(record)
  if (typeof record.typeWebhook === 'string') return parseGreen(record)
  return { kind: 'ignore', reason: 'unknown-payload' }
}
