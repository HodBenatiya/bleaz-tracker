import type {
  Candidate,
  StatusHistoryEntry,
  WaDeliveryStatus,
  WaInboxLead,
  WaMessage,
  WaMessageType,
} from '../types'

const DELIVERY_RANK: Record<WaDeliveryStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
}

/** National digits. Israeli numbers lose the leading 0 or the 972 prefix. */
export function phoneKey(raw: string | null | undefined): string {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('972')) return d.slice(3)
  if (d.startsWith('0')) return d.slice(1)
  if (d.length === 9 && /^[2-9]/.test(d)) return d
  return d
}

export function isIsraeliNational(key: string): boolean {
  return /^5\d{8}$/.test(key) || /^[23489]\d{7,8}$/.test(key)
}

/** Stored form: 05XXXXXXXX for mobiles, 0 + national digits for other Israeli numbers. */
export function toLocalPhone(raw: string | null | undefined): string {
  const key = phoneKey(raw)
  if (!key) return ''
  if (isIsraeliNational(key)) return '0' + key
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  return d
}

export function isIsraeliMobile(raw: string | null | undefined): boolean {
  return /^05\d{8}$/.test(toLocalPhone(raw))
}

/** Green API and WAHA both use 9725XXXXXXXX@c.us. @lid ids are kept as-is. */
export function toWhatsAppChatId(raw: string | null | undefined): string {
  const trimmed = String(raw ?? '').trim()
  if (/@(lid|c\.us|g\.us)$/.test(trimmed)) return trimmed.replace('@s.whatsapp.net', '@c.us')
  const key = phoneKey(trimmed)
  if (!key) return ''
  if (isIsraeliNational(key)) return `972${key}@c.us`
  let d = trimmed.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (!d) return ''
  return `${d}@c.us`
}

export function formatPhoneDisplay(raw: string | null | undefined): string {
  const local = toLocalPhone(raw)
  if (/^05\d{8}$/.test(local)) return `${local.slice(0, 3)}-${local.slice(3)}`
  if (/^0\d{8,9}$/.test(local)) return local
  return String(raw ?? '').trim()
}

export function threadKeyFromChat(chatId: string | null | undefined): string {
  const id = String(chatId ?? '').trim().replace('@s.whatsapp.net', '@c.us')
  if (!id) return ''
  if (id.endsWith('@lid')) return 'lid' + id.replace('@lid', '').replace(/\D/g, '')
  return phoneKey(id)
}

export function inboxRowId(chatId: string): string {
  return `wa_${threadKeyFromChat(chatId)}`
}

export function candidateThreadKey(c: Candidate): string {
  if (c.waChatId) return threadKeyFromChat(c.waChatId)
  return phoneKey(c.phone)
}

export function preferDeliveryStatus(prev?: WaDeliveryStatus, next?: WaDeliveryStatus): WaDeliveryStatus | undefined {
  if (!next) return prev
  if (!prev) return next
  if (next === 'failed' || prev === 'failed') return next === 'failed' ? next : prev
  return DELIVERY_RANK[next] >= DELIVERY_RANK[prev] ? next : prev
}

export function mergeWaMessages(a: WaMessage[] = [], b: WaMessage[] = []): WaMessage[] {
  const map = new Map<string, WaMessage>()
  const put = (m: WaMessage) => {
    if (!m?.id) return
    const prev = map.get(m.id)
    if (!prev) { map.set(m.id, m); return }
    map.set(m.id, {
      ...prev,
      ...m,
      text: m.text || prev.text,
      fileUrl: m.fileUrl || prev.fileUrl,
      fileName: m.fileName || prev.fileName,
      mimeType: m.mimeType || prev.mimeType,
      senderName: m.senderName || prev.senderName,
      status: preferDeliveryStatus(prev.status, m.status),
    })
  }
  for (const m of a) put(m)
  for (const m of b) put(m)
  return Array.from(map.values()).sort((x, y) => x.timestamp.localeCompare(y.timestamp))
}

export function mergeStatusHistory(a: StatusHistoryEntry[] = [], b: StatusHistoryEntry[] = []): StatusHistoryEntry[] {
  const map = new Map<string, StatusHistoryEntry>()
  for (const e of a) if (e?.id) map.set(e.id, e)
  for (const e of b) if (e?.id) map.set(e.id, e)
  return Array.from(map.values()).sort((x, y) => x.at.localeCompare(y.at))
}

function laterIso(...values: Array<string | undefined>): string | undefined {
  let best = ''
  for (const v of values) if (v && v > best) best = v
  return best || undefined
}

function mergeCv(
  incomingUrl: string | undefined,
  freshUrl: string | undefined,
  incomingName: string | undefined,
  freshName: string | undefined,
  incomingMessages: WaMessage[],
  freshMessages: WaMessage[],
): { cvUrl?: string; cvFileName?: string } {
  if (incomingUrl) return { cvUrl: incomingUrl, cvFileName: incomingName || freshName }
  if (!freshUrl) return {}
  const clientSaw = incomingMessages.some(m => m.fileUrl === freshUrl)
  if (!clientSaw && freshMessages.some(m => m.fileUrl === freshUrl)) {
    return { cvUrl: freshUrl, cvFileName: freshName }
  }
  return {}
}

/**
 * A CRM save must not wipe messages the webhook just stored.
 * Client edits win for ordinary fields. Messages and status history are unioned by id.
 */
export function mergeCandidateSave(fresh: Candidate | null | undefined, incoming: Candidate): Candidate {
  if (!fresh) return incoming
  const serverMsgs = fresh.waMessages ?? []
  const clientMsgs = incoming.waMessages ?? []
  const mergedMsgs = mergeWaMessages(serverMsgs, clientMsgs)
  const clientIds = new Set(clientMsgs.map(m => m.id))
  const unseenIncoming = serverMsgs.some(m => m.direction === 'in' && !clientIds.has(m.id))
  const serverUnread = fresh.waUnread ?? 0
  const clientUnread = incoming.waUnread ?? serverUnread
  const cv = mergeCv(incoming.cvUrl, fresh.cvUrl, incoming.cvFileName, fresh.cvFileName, clientMsgs, serverMsgs)
  const last = mergedMsgs.length ? mergedMsgs[mergedMsgs.length - 1].timestamp : undefined
  return {
    ...incoming,
    waMessages: mergedMsgs,
    waUnread: unseenIncoming ? serverUnread : Math.min(clientUnread, serverUnread),
    waChatId: incoming.waChatId || fresh.waChatId,
    lastWaAt: laterIso(incoming.lastWaAt, fresh.lastWaAt, last),
    statusHistory: mergeStatusHistory(fresh.statusHistory, incoming.statusHistory),
    cvUrl: cv.cvUrl,
    cvFileName: cv.cvFileName,
  }
}

/** Called from App.handleCandidatesChange — the only place status history is written. */
export function stampStatusChange(prev: Candidate | undefined, next: Candidate, now = new Date().toISOString()): Candidate {
  if (prev && prev.status === next.status) return next
  const entry: StatusHistoryEntry = {
    id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    from: prev ? prev.status : null,
    to: next.status,
    at: now,
    source: prev ? 'crm' : 'create',
  }
  const clockUnchanged = !!prev && next.updatedAt === prev.updatedAt
  return {
    ...next,
    updatedAt: clockUnchanged ? now : next.updatedAt,
    statusHistory: [...(next.statusHistory ?? prev?.statusHistory ?? []), entry],
  }
}

export function looksLikeCv(fileName?: string, mime?: string): boolean {
  const n = (fileName ?? '').toLowerCase()
  const m = (mime ?? '').toLowerCase()
  if (/\.(pdf|docx?)$/.test(n)) return true
  if (m.includes('pdf') || m.includes('msword') || m.includes('wordprocessingml')) return true
  if (/cv|resume|קורות/.test(n)) return true
  return false
}

export function latestCv(messages: WaMessage[]): { url: string; name?: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.fileUrl && looksLikeCv(m.fileName, m.mimeType)) return { url: m.fileUrl, name: m.fileName }
  }
  return null
}

export function messagePreview(m: WaMessage | undefined): string {
  if (!m) return ''
  const caption = (m.text || '').trim()
  const label =
    m.type === 'image' ? 'תמונה' :
    m.type === 'video' ? 'סרטון' :
    m.type === 'audio' ? 'הודעה קולית' :
    m.type === 'document' ? (m.fileName || 'קובץ') :
    m.type === 'sticker' ? 'מדבקה' :
    m.type === 'location' ? 'מיקום' :
    m.type === 'contact' ? 'איש קשר' : ''
  if (m.type === 'text' || !label) return caption
  return caption ? `${label} · ${caption}` : label
}

function personName(name: string | undefined, phone: string): string {
  const n = (name || '').trim()
  if (!n) return ''
  if (phoneKey(n) && phoneKey(n) === phoneKey(phone)) return ''
  if (/^\+?\d[\d\s-]+$/.test(n)) return ''
  return n
}

export interface WaThread {
  key: string
  phone: string
  chatId: string
  title: string
  kind: 'lead' | 'candidate'
  unread: number
  lastAt: string
  preview: string
  messages: WaMessage[]
  candidate?: Candidate
  inbox?: WaInboxLead
  lid: boolean
}

export function buildWaThreads(candidates: Candidate[], inbox: WaInboxLead[]): WaThread[] {
  const byKey = new Map<string, { candidate?: Candidate; lead?: WaInboxLead }>()

  const putCandidate = (key: string, c: Candidate) => {
    if (!key) return
    const slot = byKey.get(key) ?? {}
    const prev = slot.candidate
    if (!prev) slot.candidate = c
    else {
      const prevN = prev.waMessages?.length ?? 0
      const nextN = c.waMessages?.length ?? 0
      if (nextN > prevN || (nextN === prevN && (c.updatedAt || '') > (prev.updatedAt || ''))) slot.candidate = c
    }
    byKey.set(key, slot)
  }

  for (const c of candidates) {
    if (!(c.waMessages && c.waMessages.length) && !c.lastWaAt && !c.waChatId) continue
    putCandidate(candidateThreadKey(c), c)
  }

  for (const lead of inbox) {
    if (!lead || lead.id === 'wa_session') continue
    const key = threadKeyFromChat(lead.chatId || lead.phone)
    if (!key) continue
    const slot = byKey.get(key) ?? {}
    if (!slot.candidate) {
      const match = candidates.find(c =>
        (c.waChatId && threadKeyFromChat(c.waChatId) === key) ||
        (phoneKey(c.phone) !== '' && phoneKey(c.phone) === phoneKey(lead.phone))
      )
      if (match) slot.candidate = match
    }
    slot.lead = lead
    byKey.set(key, slot)
  }

  const threads: WaThread[] = []
  byKey.forEach((slot, key) => {
    const { candidate, lead } = slot
    const messages = mergeWaMessages(candidate?.waMessages, lead?.messages)
    if (!messages.length) return
    const phone = toLocalPhone(candidate?.phone || lead?.phone || '') || (lead?.phone || candidate?.phone || '')
    const chatId = candidate?.waChatId || lead?.chatId || toWhatsAppChatId(phone)
    const lastMsg = messages[messages.length - 1]
    const lastAt = laterIso(candidate?.lastWaAt, lead?.lastMessageAt, lastMsg?.timestamp) || ''
    const leadUnread = lead && lead.candidateId ? 0 : (lead?.unread ?? 0)
    const title = personName(candidate?.name, phone) || personName(lead?.name, phone) || formatPhoneDisplay(phone) || 'ללא מספר'
    const outbound = lastMsg?.direction === 'out'
    const body = messagePreview(lastMsg)
    threads.push({
      key,
      phone,
      chatId,
      title,
      kind: candidate ? 'candidate' : 'lead',
      unread: Math.max(candidate?.waUnread ?? 0, leadUnread),
      lastAt,
      preview: outbound && body ? `נשלח: ${body}` : body,
      messages,
      candidate,
      inbox: lead,
      lid: key.indexOf('lid') === 0,
    })
  })

  threads.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''))
  return threads
}

export function typeFromMime(mime?: string, filename?: string): WaMessageType {
  const m = (mime || '').toLowerCase()
  const n = (filename || '').toLowerCase()
  if (m.startsWith('image/')) return n.endsWith('.webp') ? 'sticker' : 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m || n) return 'document'
  return 'other'
}
