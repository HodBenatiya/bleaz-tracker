import type { Candidate, WaDeliveryStatus, WaInboxLead, WaMessage, WaSessionState } from '../src/types/index.js'
import {
  inboxRowId,
  looksLikeCv,
  mergeWaMessages,
  phoneKey,
  preferDeliveryStatus,
  threadKeyFromChat,
  toLocalPhone,
  toWhatsAppChatId,
} from '../src/utils/wa.js'
import { parseProviderWebhook, type ParsedMessage } from '../src/utils/waParse.js'
import { db } from './_db.js'
import { downloadIncomingMedia, providerName, redactError } from './_provider.js'
import { captureTaskCommand } from './_tasks.js'

interface CandidateRow { id: string; data: Candidate }

async function loadCandidateRows(): Promise<CandidateRow[]> {
  const { data, error } = await db().from('candidates').select('id, data')
  if (error) throw new Error(error.message)
  return (data ?? []) as CandidateRow[]
}

function sameThread(candidate: Candidate, chatId: string): boolean {
  const key = threadKeyFromChat(chatId)
  if (!key) return false
  if (candidate.waChatId && threadKeyFromChat(candidate.waChatId) === key) return true
  if (!chatId.endsWith('@lid') && phoneKey(candidate.phone) && phoneKey(candidate.phone) === phoneKey(chatId)) return true
  return false
}

function toWaMessage(parsed: ParsedMessage, fileUrl?: string): WaMessage {
  return {
    id: parsed.id,
    direction: parsed.direction,
    text: parsed.text || '',
    timestamp: parsed.timestamp,
    type: parsed.type,
    fileName: parsed.fileName,
    mimeType: parsed.mimeType,
    fileUrl,
    senderName: parsed.senderName,
    status: parsed.direction === 'out' ? 'sent' : undefined,
  }
}

async function writeCandidate(id: string, data: Candidate): Promise<void> {
  const { error } = await db().from('candidates').upsert({
    id,
    data,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

async function appendToCandidate(id: string, fallback: Candidate, message: WaMessage, chatId: string): Promise<void> {
  const { data: freshRow, error } = await db().from('candidates').select('data').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  const fresh = (freshRow?.data as Candidate) || fallback
  const existed = (fresh.waMessages ?? []).some(m => m.id === message.id)
  const messages = mergeWaMessages(fresh.waMessages, [message])
  const last = messages.length ? messages[messages.length - 1].timestamp : fresh.lastWaAt
  const attachCv = !fresh.cvUrl && !!message.fileUrl && looksLikeCv(message.fileName, message.mimeType)
  const phone = toLocalPhone(fresh.phone) || toLocalPhone(chatId) || fresh.phone
  const next: Candidate = {
    ...fresh,
    phone: phone || fresh.phone,
    waMessages: messages,
    waUnread: existed || message.direction !== 'in' ? (fresh.waUnread ?? 0) : (fresh.waUnread ?? 0) + 1,
    waChatId: fresh.waChatId || chatId,
    lastWaAt: last,
    cvUrl: attachCv ? message.fileUrl : fresh.cvUrl,
    cvFileName: attachCv ? (message.fileName || fresh.cvFileName) : fresh.cvFileName,
  }
  await writeCandidate(id, next)
}

async function linkInbox(chatId: string, candidateId: string): Promise<void> {
  const id = inboxRowId(chatId)
  const { data, error } = await db().from('wa_inbox').select('data').eq('id', id).maybeSingle()
  if (error || !data?.data) return
  const lead = data.data as WaInboxLead
  if (lead.candidateId === candidateId) return
  const next: WaInboxLead = { ...lead, candidateId, updatedAt: new Date().toISOString() }
  await db().from('wa_inbox').upsert({ id, data: next, updated_at: next.updatedAt })
}

async function appendToInbox(parsed: ParsedMessage, message: WaMessage): Promise<void> {
  const id = inboxRowId(parsed.chatId)
  const { data: existing, error } = await db().from('wa_inbox').select('data').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  const prev = existing?.data as WaInboxLead | undefined
  if (prev?.candidateId) {
    const { data: cand, error: candErr } = await db().from('candidates').select('id, data').eq('id', prev.candidateId).maybeSingle()
    if (candErr) throw new Error(candErr.message)
    if (cand?.data) {
      await appendToCandidate(String(cand.id), cand.data as Candidate, message, parsed.chatId)
      return
    }
  }
  const now = new Date().toISOString()
  const phone = toLocalPhone(parsed.chatId) || parsed.chatId
  const base: WaInboxLead = prev?.messages ? prev : {
    id,
    phone,
    chatId: parsed.chatId,
    name: parsed.senderName || phone,
    messages: [],
    unread: 0,
    lastMessageAt: message.timestamp,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  }
  const existed = (base.messages ?? []).some(m => m.id === message.id)
  const messages = mergeWaMessages(base.messages, [message])
  const keepName = base.name && base.name !== base.phone && base.name !== phone
  const next: WaInboxLead = {
    ...base,
    id,
    phone,
    chatId: parsed.chatId.endsWith('@lid') ? parsed.chatId : (toWhatsAppChatId(parsed.chatId) || parsed.chatId),
    name: keepName ? base.name : (parsed.senderName || base.name || phone),
    messages,
    unread: existed || message.direction !== 'in' ? (base.unread ?? 0) : (base.unread ?? 0) + 1,
    lastMessageAt: messages.length ? messages[messages.length - 1].timestamp : message.timestamp,
    updatedAt: now,
  }
  const { error: writeErr } = await db().from('wa_inbox').upsert({ id, data: next, updated_at: now })
  if (writeErr) throw new Error(writeErr.message)
}

async function alreadyStored(id: string, chatId: string): Promise<boolean> {
  const rows = await loadCandidateRows()
  if (rows.some(r => (r.data?.waMessages ?? []).some(m => m.id === id))) return true
  const { data, error } = await db().from('wa_inbox').select('data').eq('id', inboxRowId(chatId)).maybeSingle()
  if (error || !data?.data) return false
  const lead = data.data as WaInboxLead
  return (lead.messages ?? []).some(m => m.id === id)
}

function safeStorageName(name: string): string {
  const cleaned = name.replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  return (cleaned || 'file').slice(-80)
}

async function uploadToCvs(chatId: string, fileName: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  const key = threadKeyFromChat(chatId) || 'file'
  const path = `whatsapp/${key}/${Date.now()}-${safeStorageName(fileName)}`
  const { error } = await db().storage.from('cvs').upload(path, bytes, {
    contentType: mime || 'application/octet-stream',
    upsert: true,
  })
  if (error) {
    console.error('cvs upload', error.message)
    return null
  }
  const { data } = db().storage.from('cvs').getPublicUrl(path)
  return data.publicUrl || null
}

async function storeSession(status: string): Promise<void> {
  const row: WaSessionState = {
    id: 'wa_session',
    kind: 'session',
    status,
    updatedAt: new Date().toISOString(),
    provider: providerName(),
  }
  const { error } = await db().from('wa_inbox').upsert({ id: row.id, data: row, updated_at: row.updatedAt })
  if (error) throw new Error(error.message)
}

async function applyAck(chatId: string, id: string, status: WaDeliveryStatus): Promise<void> {
  const rows = await loadCandidateRows()
  const preferred = chatId ? rows.filter(r => sameThread(r.data, chatId)) : rows
  const search = preferred.length ? preferred : rows
  for (const row of search) {
    const msgs = row.data?.waMessages ?? []
    if (!msgs.some(m => m.id === id)) continue
    const nextMsgs = msgs.map(m => m.id === id ? { ...m, status: preferDeliveryStatus(m.status, status) } : m)
    await writeCandidate(row.id, { ...row.data, waMessages: nextMsgs })
    return
  }

  const ids = chatId ? [inboxRowId(chatId)] : []
  if (!ids.length) {
    const { data, error } = await db().from('wa_inbox').select('id, data')
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      if (row.id === 'wa_session') continue
      const lead = row.data as WaInboxLead
      if (!(lead.messages ?? []).some(m => m.id === id)) continue
      ids.push(String(row.id))
      break
    }
  }
  for (const rowId of ids) {
    const { data, error } = await db().from('wa_inbox').select('data').eq('id', rowId).maybeSingle()
    if (error) throw new Error(error.message)
    const lead = data?.data as WaInboxLead | undefined
    if (!lead?.messages?.some(m => m.id === id)) continue
    const next: WaInboxLead = {
      ...lead,
      messages: lead.messages.map(m => m.id === id ? { ...m, status: preferDeliveryStatus(m.status, status) } : m),
      updatedAt: new Date().toISOString(),
    }
    const { error: writeErr } = await db().from('wa_inbox').upsert({ id: rowId, data: next, updated_at: next.updatedAt })
    if (writeErr) throw new Error(writeErr.message)
    return
  }
}

async function attachMediaIfMissing(incoming: ParsedMessage): Promise<void> {
  const file = await downloadIncomingMedia(incoming)
  if (!file) return
  const fileUrl = await uploadToCvs(incoming.chatId, incoming.fileName || incoming.type, file.bytes, file.mime)
  if (!fileUrl) return
  const rows = await loadCandidateRows()
  const found = rows.find(r => (r.data?.waMessages ?? []).some(m => m.id === incoming.id))
  if (found) {
    const messages = (found.data.waMessages ?? []).map(m => m.id === incoming.id && !m.fileUrl
      ? { ...m, fileUrl, fileName: m.fileName || incoming.fileName, mimeType: m.mimeType || incoming.mimeType }
      : m)
    const attachCv = !found.data.cvUrl && looksLikeCv(incoming.fileName, incoming.mimeType)
    await writeCandidate(found.id, {
      ...found.data,
      waMessages: messages,
      cvUrl: attachCv ? fileUrl : found.data.cvUrl,
      cvFileName: attachCv ? (incoming.fileName || found.data.cvFileName) : found.data.cvFileName,
    })
    return
  }
  const rowId = inboxRowId(incoming.chatId)
  const { data, error } = await db().from('wa_inbox').select('data').eq('id', rowId).maybeSingle()
  if (error || !data?.data) return
  const lead = data.data as WaInboxLead
  const next: WaInboxLead = {
    ...lead,
    messages: (lead.messages ?? []).map(m => m.id === incoming.id && !m.fileUrl
      ? { ...m, fileUrl, fileName: m.fileName || incoming.fileName, mimeType: m.mimeType || incoming.mimeType }
      : m),
    updatedAt: new Date().toISOString(),
  }
  await db().from('wa_inbox').upsert({ id: rowId, data: next, updated_at: next.updatedAt })
}

export async function storeOutgoingMessage(chatId: string, message: WaMessage): Promise<void> {
  const parsed: ParsedMessage = {
    id: message.id,
    chatId,
    direction: 'out',
    text: message.text,
    timestamp: message.timestamp,
    type: 'text',
  }
  const rows = await loadCandidateRows()
  const found = rows.find(r => sameThread(r.data, chatId))
  if (found) {
    await appendToCandidate(found.id, found.data, message, chatId)
    await linkInbox(chatId, found.id)
    return
  }
  await appendToInbox(parsed, message)
}

export async function ingestWebhookBody(
  body: unknown,
  opts?: { downloadFiles?: boolean; captureTasks?: boolean },
): Promise<{ action: string }> {
  const parsed = parseProviderWebhook(body)
  if (parsed.kind === 'ignore') return { action: parsed.reason }
  if (parsed.kind === 'session') {
    await storeSession(parsed.status)
    return { action: 'session' }
  }
  if (parsed.kind === 'ack') {
    await applyAck(parsed.chatId, parsed.id, parsed.status)
    return { action: 'ack' }
  }

  const incoming = parsed.message
  if (await alreadyStored(incoming.id, incoming.chatId)) {
    if (opts?.downloadFiles !== false && (incoming.downloadUrl || incoming.hasMedia)) {
      await attachMediaIfMissing(incoming)
    }
    return { action: 'duplicate' }
  }

  let fileUrl: string | undefined
  if (opts?.downloadFiles !== false && (incoming.downloadUrl || incoming.hasMedia)) {
    const file = await downloadIncomingMedia(incoming)
    if (file) {
      fileUrl = await uploadToCvs(incoming.chatId, incoming.fileName || incoming.type, file.bytes, file.mime) || undefined
    }
  }

  const message = toWaMessage(incoming, fileUrl)
  const rows = await loadCandidateRows()
  const found = rows.find(r => sameThread(r.data, incoming.chatId))
  if (found) {
    await appendToCandidate(found.id, found.data, message, incoming.chatId)
    await linkInbox(incoming.chatId, found.id)
  } else {
    await appendToInbox(incoming, message)
  }

  if (opts?.captureTasks && incoming.direction === 'in' && incoming.text) {
    try { await captureTaskCommand(incoming.text) }
    catch (err) { console.error('task capture', redactError(err)) }
  }
  return { action: found ? 'candidate' : 'inbox' }
}
