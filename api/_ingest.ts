import { createClient } from '@supabase/supabase-js'
import type { Candidate, WaDeliveryStatus, WaInboxLead, WaMessage, WaSessionState } from '../src/types/index.js'
import {
  applyKnownLid,
  personName,
  inboxRowId,
  isOwnWaIdentity,
  looksLikeCv,
  looksLikeWaLid,
  mergeWaMessages,
  messageKey,
  phoneKey,
  preferDeliveryStatus,
  threadKeyFromChat,
  toLocalPhone,
  toWhatsAppChatId,
} from '../src/utils/wa.js'
import { waMediaObjectPath } from '../src/utils/storageKey.js'
import { parseProviderWebhook, type ParsedMessage } from '../src/utils/waParse.js'
import { db } from './_db.js'
import { downloadIncomingMedia, fetchWahaContactCard, providerName, redactError, resolveWahaPhone } from './_provider.js'
import { captureTaskCommand } from './_tasks.js'

interface CandidateRow { id: string; data: Candidate }

async function loadCandidateRows(): Promise<CandidateRow[]> {
  const { data, error } = await db().from('candidates').select('id, data')
  if (error) throw new Error(error.message)
  return (data ?? []) as CandidateRow[]
}

function sameThread(candidate: Candidate, chatId: string, lid?: string): boolean {
  const key = threadKeyFromChat(chatId)
  if (lid && candidate.waLid && threadKeyFromChat(candidate.waLid) === threadKeyFromChat(lid)) return true
  if (key && candidate.waChatId && threadKeyFromChat(candidate.waChatId) === key) return true
  if (!chatId.endsWith('@lid') && phoneKey(candidate.phone) && phoneKey(candidate.phone) === phoneKey(chatId)) return true
  return false
}

function toWaMessage(parsed: ParsedMessage, file?: { fileUrl?: string; filePath?: string }): WaMessage {
  const hasFile = !!(parsed.hasMedia || file?.fileUrl || file?.filePath)
  return {
    id: parsed.id,
    direction: parsed.direction,
    text: parsed.text || '',
    timestamp: parsed.timestamp,
    type: parsed.type,
    fileName: parsed.fileName,
    mimeType: parsed.mimeType,
    fileUrl: hasFile ? (file?.fileUrl || `/api/wa-media?id=${encodeURIComponent(parsed.id)}`) : undefined,
    filePath: file?.filePath,
    senderName: parsed.senderName,
    status: parsed.direction === 'out' ? 'sent' : undefined,
    source: parsed.source || (providerName() === 'waha' ? 'waha' : 'greenapi'),
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

async function appendToCandidate(id: string, fallback: Candidate, message: WaMessage, chatId: string, lid?: string): Promise<void> {
  const { data: freshRow, error } = await db().from('candidates').select('data').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  const fresh = (freshRow?.data as Candidate) || fallback
  const existed = (fresh.waMessages ?? []).some(m => m.id === message.id)
  const messages = mergeWaMessages(fresh.waMessages, [message])
  const last = messages.length ? messages[messages.length - 1].timestamp : fresh.lastWaAt
  const attachCv = !fresh.cvUrl && !!message.fileUrl && looksLikeCv(message.fileName, message.mimeType)
  const phone = looksLikeWaLid(chatId) ? fresh.phone : (toLocalPhone(fresh.phone) || toLocalPhone(chatId) || fresh.phone)
  const next: Candidate = {
    ...fresh,
    phone: phone || fresh.phone,
    waMessages: messages,
    waUnread: existed || message.direction !== 'in' ? (fresh.waUnread ?? 0) : (fresh.waUnread ?? 0) + 1,
    waChatId: looksLikeWaLid(chatId) ? fresh.waChatId : (fresh.waChatId || chatId),
    waLid: fresh.waLid || lid || (chatId.endsWith('@lid') ? chatId : undefined),
    lastWaAt: last,
    cvUrl: attachCv ? message.fileUrl : fresh.cvUrl,
    cvFileName: attachCv ? (message.fileName || fresh.cvFileName) : fresh.cvFileName,
  }
  await writeCandidate(id, next)
}

function inboxWriteError(error: { message?: string; code?: string }): Error {
  const message = error.message || 'wa_inbox write failed'
  if (/row-level security/i.test(message)) {
    return new Error(`${message}. RLS is still enabled on wa_inbox — run schema_wa.sql again.`)
  }
  return new Error(error.code ? `${error.code}: ${message}` : message)
}

async function writeInbox(id: string, data: unknown, updatedAt: string): Promise<void> {
  const { error } = await db().from('wa_inbox').upsert(
    { id, data, updated_at: updatedAt },
    { onConflict: 'id' },
  )
  if (error) throw inboxWriteError(error)
}

async function linkInbox(chatId: string, candidateId: string): Promise<void> {
  const id = inboxRowId(chatId)
  const { data, error } = await db().from('wa_inbox').select('data').eq('id', id).maybeSingle()
  if (error || !data?.data) return
  const lead = data.data as WaInboxLead
  if (lead.candidateId === candidateId) return
  const next: WaInboxLead = { ...lead, candidateId, updatedAt: new Date().toISOString() }
  await writeInbox(id, next, next.updatedAt)
}

async function appendToInbox(parsed: ParsedMessage, message: WaMessage): Promise<void> {
  const id = inboxRowId(parsed.chatId)
  const { data: existing, error } = await db().from('wa_inbox').select('data').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  const prev = existing?.data as WaInboxLead | undefined
  if (prev?.mergedInto) {
    const { data: target, error: targetErr } = await db().from('wa_inbox').select('data').eq('id', prev.mergedInto).maybeSingle()
    if (targetErr) throw new Error(targetErr.message)
    if (target?.data) {
      await appendToInbox({ ...parsed, chatId: (target.data as WaInboxLead).chatId || parsed.chatId }, message)
      return
    }
  }
  if (prev?.candidateId) {
    const { data: cand, error: candErr } = await db().from('candidates').select('id, data').eq('id', prev.candidateId).maybeSingle()
    if (candErr) throw new Error(candErr.message)
    if (cand?.data) {
      await appendToCandidate(String(cand.id), cand.data as Candidate, message, parsed.chatId)
      return
    }
  }
  const now = new Date().toISOString()
  const unresolved = !!parsed.unresolved || parsed.chatId.endsWith('@lid')
  const phone = unresolved ? '' : (toLocalPhone(parsed.chatId) || '')
  const base: WaInboxLead = prev?.messages ? prev : {
    id,
    phone,
    chatId: parsed.chatId,
    name: parsed.senderName || (unresolved ? '' : phone),
    messages: [],
    unread: 0,
    lastMessageAt: message.timestamp,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  }
  const existed = (base.messages ?? []).some(m => m.id === message.id)
  const messages = mergeWaMessages(base.messages, [message])
  const incomingName = personName(parsed.senderName, phone)
  const keptName = personName(base.name, phone)
  const next: WaInboxLead = {
    ...base,
    id,
    phone: unresolved ? '' : phone,
    chatId: unresolved ? (parsed.lid || parsed.chatId) : (toWhatsAppChatId(parsed.chatId) || parsed.chatId),
    lid: parsed.lid || prev?.lid,
    provider: parsed.source || prev?.provider || 'waha',
    phoneUnresolved: unresolved,
    pushName: incomingName || prev?.pushName,
    name: incomingName || keptName || (unresolved ? '' : phone),
    messages,
    unread: existed || message.direction !== 'in' ? (base.unread ?? 0) : (base.unread ?? 0) + 1,
    lastMessageAt: messages.length ? messages[messages.length - 1].timestamp : message.timestamp,
    updatedAt: now,
  }
  await writeInbox(id, next, now)
}

function sameStoredMessage(existing: WaMessage | undefined, incoming: { id: string; text?: string; timestamp?: string; direction?: string }): boolean {
  if (!existing?.id) return false
  if (existing.id === incoming.id || messageKey(existing.id) === messageKey(incoming.id)) return true
  if (incoming.direction !== 'out' || existing.direction !== 'out') return false
  if ((existing.text || '') !== (incoming.text || '')) return false
  const local = existing.id.startsWith('local_') || incoming.id.startsWith('local_')
  if (!local) return false
  const left = Date.parse(existing.timestamp)
  const right = Date.parse(incoming.timestamp || '')
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 2 * 60 * 1000
}

async function alreadyStored(id: string, chatId: string, twin?: { text?: string; timestamp?: string; direction?: string }): Promise<boolean> {
  const needle = { id, text: twin?.text, timestamp: twin?.timestamp, direction: twin?.direction }
  const rows = await loadCandidateRows()
  if (rows.some(r => (r.data?.waMessages ?? []).some(m => sameStoredMessage(m, needle)))) return true
  const { data, error } = await db().from('wa_inbox').select('id, data').limit(500)
  if (error || !data) {
    const one = await db().from('wa_inbox').select('data').eq('id', inboxRowId(chatId)).maybeSingle()
    const lead = one.data?.data as WaInboxLead | undefined
    return (lead?.messages ?? []).some(m => sameStoredMessage(m, needle))
  }
  return data.some(row => ((row.data as WaInboxLead | undefined)?.messages ?? []).some(m => sameStoredMessage(m, needle)))
}


function storageClient() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('missing supabase service role')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function uploadWaFile(chatId: string, fileName: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  const path = waMediaObjectPath(threadKeyFromChat(chatId) || 'file', fileName)
  const client = storageClient()
  const body = bytes
  const options = { contentType: mime || 'application/octet-stream', upsert: true }
  const preferred = await client.storage.from('wa-media').upload(path, body, options)
  if (!preferred.error) return `wa-media:${path}`
  console.error('wa-media upload', preferred.error.message)
  const fallback = await client.storage.from('cvs').upload(path, body, options)
  if (fallback.error) {
    console.error('cvs upload', fallback.error.message)
    return null
  }
  return `cvs:${path}`
}

export async function readStoredFile(filePath: string): Promise<Uint8Array | null> {
  const splitAt = filePath.indexOf(':')
  if (splitAt <= 0) return null
  try {
    const client = storageClient()
    const { data, error } = await client.storage.from(filePath.slice(0, splitAt)).download(filePath.slice(splitAt + 1))
    if (error || !data) return null
    return new Uint8Array(await data.arrayBuffer())
  } catch {
    return null
  }
}

export async function openStoredMedia(filePath: string): Promise<string | null> {
  const splitAt = filePath.indexOf(':')
  if (splitAt <= 0) return null
  const bucket = filePath.slice(0, splitAt)
  const path = filePath.slice(splitAt + 1)
  const client = storageClient()
  if (bucket === 'cvs') {
    const { data } = client.storage.from('cvs').getPublicUrl(path)
    return data.publicUrl || null
  }
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 60 * 60)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export async function findStoredMedia(id: string): Promise<{ filePath?: string; fileUrl?: string; fileName?: string; mimeType?: string; chatId?: string; type?: string } | null> {
  const { data, error } = await db().from('wa_inbox').select('data').limit(500)
  if (!error) {
    for (const row of data ?? []) {
      const lead = row.data as WaInboxLead | undefined
      const message = (lead?.messages ?? []).find(m => m?.id === id || messageKey(m?.id) === messageKey(id))
      if (message) return { ...message, chatId: lead?.chatId }
    }
  }
  const rows = await loadCandidateRows()
  for (const row of rows) {
    const message = (row.data?.waMessages ?? []).find(m => m?.id === id || messageKey(m?.id) === messageKey(id))
    if (message) return { ...message, chatId: row.data.waChatId || row.data.waLid }
  }
  return null
}

async function storeSession(status: string): Promise<void> {
  const row: WaSessionState = {
    id: 'wa_session',
    kind: 'session',
    status,
    updatedAt: new Date().toISOString(),
    provider: providerName(),
  }
  await writeInbox(row.id, row, row.updatedAt)
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
    await writeInbox(rowId, next, next.updatedAt)
    return
  }
}

async function attachMediaIfMissing(incoming: ParsedMessage): Promise<void> {
  const file = await downloadIncomingMedia(incoming)
  if (!file) return
  const filePath = await uploadWaFile(incoming.chatId, incoming.fileName || incoming.type, file.bytes, file.mime)
  const fileUrl = `/api/wa-media?id=${encodeURIComponent(incoming.id)}`
  const rows = await loadCandidateRows()
  const found = rows.find(r => (r.data?.waMessages ?? []).some(m => m.id === incoming.id))
  if (found) {
    const messages = (found.data.waMessages ?? []).map(m => m.id === incoming.id && !m.fileUrl
      ? { ...m, fileUrl, filePath: filePath || m.filePath, fileName: m.fileName || incoming.fileName, mimeType: m.mimeType || incoming.mimeType }
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
      ? { ...m, fileUrl, filePath: filePath || m.filePath, fileName: m.fileName || incoming.fileName, mimeType: m.mimeType || incoming.mimeType }
      : m),
    updatedAt: new Date().toISOString(),
  }
  await writeInbox(rowId, next, next.updatedAt)
}

export async function storeOutgoingMessage(chatId: string, message: WaMessage): Promise<void> {
  if (await alreadyStored(message.id, chatId, message)) return
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

async function resolveIncoming(message: ParsedMessage, session?: string): Promise<ParsedMessage | 'self'> {
  let phoneJid = message.phoneJid
  const lid = message.lid || (message.chatId.endsWith('@lid') ? message.chatId : undefined)
  if (!phoneJid && lid && message.source !== 'greenapi') {
    const pn = await resolveWahaPhone(lid, session)
    if (pn) phoneJid = pn.includes('@') ? pn.replace('@s.whatsapp.net', '@c.us') : toWhatsAppChatId(pn)
  }
  const resolved = applyKnownLid({ chatId: message.chatId, lid, phoneJid })
  if (resolved.self) return 'self'
  return { ...message, chatId: resolved.chatId, lid: resolved.lid, phoneJid, unresolved: resolved.unresolved }
}

function tagWaha(messages: WaMessage[] | undefined): WaMessage[] {
  return (messages ?? []).map(m => (m?.source ? m : { ...m, source: 'waha' as const }))
}

/** Move LID-keyed inbox rows onto the real 05X phone once WAHA can resolve them. The LID row is kept and marked mergedInto. */
export async function repairLidInbox(session?: string): Promise<number> {
  const { data, error } = await db().from('wa_inbox').select('id, data').limit(500)
  if (error) throw new Error(error.message)
  let fixed = 0
  let lookups = 0
  for (const row of data ?? []) {
    if (row.id === 'wa_session') continue
    const lead = row.data as WaInboxLead
    if (!lead || lead.mergedInto || lead.provider === 'greenapi') continue
    const lid = lead.lid
      || (String(lead.chatId || '').endsWith('@lid') ? lead.chatId : '')
      || (looksLikeWaLid(lead.phone) ? `${String(lead.phone).replace(/\D/g, '')}@lid` : '')
    if (!lid || !looksLikeWaLid(lid) || isOwnWaIdentity(lid)) continue
    const hasPhone = !!lead.phone && !looksLikeWaLid(lead.phone)
    if (hasPhone && lead.phoneUnresolved === false && lead.provider === 'waha' && !String(row.id).includes('lid') && !String(lead.chatId || '').endsWith('@lid')) continue
    if (!hasPhone && lookups >= 8) continue
    let phoneJid = hasPhone ? toWhatsAppChatId(lead.phone) : ''
    if (!phoneJid) {
      lookups++
      const pn = await resolveWahaPhone(lid, session)
      if (pn) phoneJid = pn.includes('@') ? pn.replace('@s.whatsapp.net', '@c.us') : toWhatsAppChatId(pn)
    }
    const now = new Date().toISOString()
    const tagged = tagWaha(lead.messages)
    if (!phoneJid || isOwnWaIdentity(phoneJid)) {
      const alreadyWaiting = lead.phoneUnresolved && !lead.phone && lead.provider === 'waha' && lead.lid === lid
      if (!alreadyWaiting) {
        await writeInbox(String(row.id), {
          ...lead, phone: '', phoneUnresolved: true, lid, provider: 'waha', messages: tagged, updatedAt: now,
        }, now)
        fixed++
      }
      continue
    }
    const phone = toLocalPhone(phoneJid)
    const targetId = inboxRowId(phoneJid)
    if (targetId === row.id) {
      await writeInbox(String(row.id), {
        ...lead, phone, chatId: phoneJid, lid, phoneUnresolved: false, provider: 'waha', messages: tagged, updatedAt: now,
      }, now)
      fixed++
      continue
    }
    const { data: existing, error: readErr } = await db().from('wa_inbox').select('data').eq('id', targetId).maybeSingle()
    if (readErr) throw new Error(readErr.message)
    const prev = existing?.data as WaInboxLead | undefined
    const name = [prev?.name, lead.name].find(value => value && !looksLikeWaLid(value)) || phone
    const merged: WaInboxLead = {
      id: targetId,
      phone,
      chatId: phoneJid,
      lid,
      provider: 'waha',
      phoneUnresolved: false,
      name,
      messages: mergeWaMessages(prev?.messages, tagged),
      unread: Math.max(prev?.unread ?? 0, lead.unread ?? 0),
      lastMessageAt: lead.lastMessageAt || prev?.lastMessageAt || now,
      candidateId: prev?.candidateId || lead.candidateId,
      createdAt: prev?.createdAt || lead.createdAt || now,
      updatedAt: now,
    }
    await writeInbox(targetId, merged, now)
    await writeInbox(String(row.id), { ...lead, mergedInto: targetId, provider: 'waha', lid, messages: tagged, updatedAt: now }, now)
    fixed++
  }
  fixed += await refreshContactCards(session)
  return fixed
}

const PICTURE_MAX_AGE_MS = 24 * 60 * 60 * 1000

function contactIdFor(lead: WaInboxLead): string {
  if (lead.chatId?.endsWith('@c.us')) return lead.chatId
  if (lead.phone && !looksLikeWaLid(lead.phone)) return toWhatsAppChatId(lead.phone)
  if (lead.lid) return lead.lid.endsWith('@lid') ? lead.lid : `${lead.lid.replace(/\D/g, '')}@lid`
  return lead.chatId || ''
}

function pictureStale(lead: WaInboxLead): boolean {
  if (!lead.pictureAt) return true
  const at = new Date(lead.pictureAt).getTime()
  return !Number.isFinite(at) || Date.now() - at > PICTURE_MAX_AGE_MS
}

async function refreshContactCards(session?: string): Promise<number> {
  const { data, error } = await db().from('wa_inbox').select('id, data').limit(500)
  if (error) throw new Error(error.message)
  let updated = 0
  let fetched = 0
  for (const row of data ?? []) {
    if (fetched >= 8) break
    if (row.id === 'wa_session') continue
    const lead = row.data as WaInboxLead
    if (!lead || lead.mergedInto || lead.provider === 'greenapi') continue
    if (!pictureStale(lead) && personName(lead.pushName || lead.name, lead.phone)) continue
    const contactId = contactIdFor(lead)
    if (!contactId) continue
    fetched++
    const card = await fetchWahaContactCard(contactId, session)
    const now = new Date().toISOString()
    const pushName = personName(card?.name, lead.phone) || lead.pushName
    const pictureUrl = card ? (card.pictureUrl || '') : lead.pictureUrl
    await writeInbox(String(row.id), {
      ...lead,
      pushName,
      name: pushName || lead.name,
      pictureUrl,
      pictureAt: now,
      updatedAt: now,
    }, now)
    updated++
  }
  return updated
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

  const session = body && typeof body === 'object' && typeof (body as { session?: unknown }).session === 'string'
    ? (body as { session: string }).session
    : undefined
  const resolved = await resolveIncoming(parsed.message, session)
  if (resolved === 'self') return { action: 'ignored-self' }
  const incoming = resolved
  if (
    await alreadyStored(incoming.id, incoming.chatId, incoming) ||
    (incoming.lid ? await alreadyStored(incoming.id, incoming.lid, incoming) : false)
  ) {
    if (opts?.downloadFiles !== false && (incoming.downloadUrl || incoming.hasMedia)) {
      await attachMediaIfMissing(incoming)
    }
    return { action: 'duplicate' }
  }

  let stored: { fileUrl?: string; filePath?: string } | undefined
  if (opts?.downloadFiles !== false && (incoming.downloadUrl || incoming.hasMedia)) {
    const file = await downloadIncomingMedia(incoming)
    const filePath = file ? await uploadWaFile(incoming.chatId, incoming.fileName || `${incoming.type}.bin`, file.bytes, file.mime) : null
    stored = { fileUrl: `/api/wa-media?id=${encodeURIComponent(incoming.id)}`, filePath: filePath || undefined }
  }

  const message = toWaMessage(incoming, stored)
  const rows = await loadCandidateRows()
  const found = rows.find(r => sameThread(r.data, incoming.chatId, incoming.lid))
  if (found) {
    await appendToCandidate(found.id, found.data, message, incoming.chatId, incoming.lid)
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
