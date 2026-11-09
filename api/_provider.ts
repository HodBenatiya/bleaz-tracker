import { toWhatsAppChatId } from '../src/utils/wa.js'
import { messageIdOf, type ParsedMessage } from '../src/utils/waParse.js'

export type ProviderName = 'waha' | 'greenapi'

/** Explicit WA_PROVIDER wins. Otherwise keep Green API when it is already configured. */
export function providerName(): ProviderName {
  const raw = (process.env.WA_PROVIDER || '').trim().toLowerCase()
  if (raw === 'waha') return 'waha'
  if (raw === 'greenapi' || raw === 'green-api' || raw === 'green') return 'greenapi'
  if (process.env.WAHA_URL && !process.env.GREENAPI_ID_INSTANCE) return 'waha'
  return 'greenapi'
}

function trimBase(url: string): string {
  return url.replace(/\/$/, '')
}

export function redactError(err: unknown): string {
  let out = err instanceof Error ? err.message : String(err)
  const secrets = [
    process.env.WAHA_API_KEY,
    process.env.GREENAPI_API_TOKEN,
    process.env.GREENAPI_INBOX_API_TOKEN,
    process.env.WA_WEBHOOK_TOKEN,
  ]
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('***')
  }
  return out.slice(0, 400)
}

interface GreenCreds {
  instanceId: string
  token: string
  apiBase: string
}

function greenCreds(which: 'main' | 'inbox'): GreenCreds {
  const inboxReady = !!(process.env.GREENAPI_INBOX_ID_INSTANCE && process.env.GREENAPI_INBOX_API_TOKEN)
  const useInbox = which === 'inbox' && inboxReady
  const instanceId = (useInbox ? process.env.GREENAPI_INBOX_ID_INSTANCE : process.env.GREENAPI_ID_INSTANCE) || ''
  const token = (useInbox ? process.env.GREENAPI_INBOX_API_TOKEN : process.env.GREENAPI_API_TOKEN) || ''
  if (!instanceId || !token) throw new Error('Green API credentials are not set')
  const explicit = useInbox ? process.env.GREENAPI_INBOX_API_URL : process.env.GREENAPI_API_URL
  const apiBase = trimBase(explicit || `https://${instanceId.slice(0, 4)}.api.greenapi.com`)
  return { instanceId, token, apiBase }
}

function wahaCreds() {
  const base = trimBase(process.env.WAHA_URL || '')
  if (!base) throw new Error('WAHA_URL is not set')
  return {
    base,
    key: process.env.WAHA_API_KEY || '',
    session: process.env.WAHA_SESSION || 'default',
  }
}

function wahaHeaders(key: string): Record<string, string> {
  return { Accept: 'application/json', ...(key ? { 'X-Api-Key': key } : {}) }
}

async function lookupLidOnce(base: string, key: string, session: string, id: string): Promise<string | null> {
  const url = `${base}/api/${encodeURIComponent(session)}/lids/${encodeURIComponent(id)}`
  const resp = await fetch(url, { headers: wahaHeaders(key), signal: AbortSignal.timeout(8000) })
  if (!resp.ok) return null
  const data = await resp.json().catch(() => null) as { pn?: string | null } | null
  return typeof data?.pn === 'string' && data.pn ? data.pn : null
}

function phoneFromContact(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const row = data as Record<string, unknown>
  for (const field of ['pn', 'number', 'phone', 'phoneNumber']) {
    const value = row[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  if (typeof row.id === 'string' && row.id.endsWith('@c.us')) return row.id
  return ''
}

async function lookupContactPhone(base: string, key: string, session: string, id: string): Promise<string | null> {
  const contactId = `${id}@lid`
  const url = `${base}/api/${encodeURIComponent(session)}/contacts?contactId=${encodeURIComponent(contactId)}`
  const resp = await fetch(url, { headers: wahaHeaders(key), signal: AbortSignal.timeout(8000) })
  if (!resp.ok) return null
  const data = await resp.json().catch(() => null)
  const phone = phoneFromContact(data)
  return phone || null
}

/**
 * Resolve a LID to a phone JID.
 * GET /api/{session}/lids/{lid}, retry once after a short delay, then GET /api/{session}/contacts?contactId=.
 */
export async function resolveWahaPhone(lid: string, session?: string): Promise<string | null> {
  let creds: { base: string; key: string; session: string }
  try { creds = wahaCreds() } catch { return null }
  const id = lid.replace(/@lid$/i, '')
  if (!id) return null
  const useSession = session || creds.session
  try {
    const first = await lookupLidOnce(creds.base, creds.key, useSession, id)
    if (first) return first
    await new Promise(resolve => setTimeout(resolve, 600))
    const second = await lookupLidOnce(creds.base, creds.key, useSession, id)
    if (second) return second
    return await lookupContactPhone(creds.base, creds.key, useSession, id)
  } catch (err) {
    console.error('lid lookup', redactError(err))
    return null
  }
}

function nameFromContact(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const row = data as Record<string, unknown>
  for (const field of ['pushname', 'pushName', 'notifyName', 'name', 'shortName', 'verifiedName']) {
    const value = row[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function pictureFromContact(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  for (const field of ['profilePictureURL', 'profilePictureUrl', 'url']) {
    const value = row[field]
    if (typeof value === 'string' && value.startsWith('http')) return value
  }
  return null
}

function safePictureUrl(url: string | null, wahaBase: string): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    const wahaHost = new URL(wahaBase).host
    if (parsed.host === wahaHost) return null
    parsed.searchParams.delete('x-api-key')
    parsed.searchParams.delete('X-Api-Key')
    return parsed.toString()
  } catch {
    return null
  }
}

export interface WahaContactCard {
  name: string
  pictureUrl: string | null
}

/** Contact name and profile photo. Picture URLs from WhatsApp expire; callers refresh them. */
export async function fetchWahaContactCard(contactId: string, session?: string): Promise<WahaContactCard | null> {
  let creds: { base: string; key: string; session: string }
  try { creds = wahaCreds() } catch { return null }
  if (!contactId) return null
  const useSession = session || creds.session
  const query = `contactId=${encodeURIComponent(contactId)}&session=${encodeURIComponent(useSession)}`
  const headers = wahaHeaders(creds.key)
  try {
    const [infoRes, picRes] = await Promise.all([
      fetch(`${creds.base}/api/contacts?${query}`, { headers, signal: AbortSignal.timeout(8000) }).catch(() => null),
      fetch(`${creds.base}/api/contacts/profile-picture?${query}`, { headers, signal: AbortSignal.timeout(8000) }).catch(() => null),
    ])
    let name = ''
    if (infoRes?.ok) name = nameFromContact(await infoRes.json().catch(() => null))
    let pictureUrl: string | null = null
    if (picRes?.ok) pictureUrl = safePictureUrl(pictureFromContact(await picRes.json().catch(() => null)), creds.base)
    if (!name && pictureUrl === null && !infoRes?.ok && !picRes?.ok) return null
    return { name, pictureUrl }
  } catch (err) {
    console.error('contact profile', redactError(err))
    return null
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<{ ok: boolean; status: number; data: any }> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  })
  const data = await resp.json().catch(() => ({}))
  return { ok: resp.ok, status: resp.status, data }
}

/** CRM replies. Green API uses the inbox instance when GREENAPI_INBOX_* is set. */
export async function sendInboxText(chatIdOrPhone: string, text: string): Promise<{ id: string }> {
  const chatId = toWhatsAppChatId(chatIdOrPhone)
  if (!chatId) throw new Error('invalid phone')
  if (providerName() === 'waha') return sendWaha(chatId, text)
  return sendGreen(chatId, text, 'inbox')
}

/** Reminders and task confirmations. Green API stays on the original instance. */
export async function sendNotify(phone: string, text: string): Promise<void> {
  const chatId = toWhatsAppChatId(phone)
  if (!chatId || !text) return
  if (providerName() === 'waha') {
    await sendWaha(chatId, text)
    return
  }
  await sendGreen(chatId, text, 'main')
}

export type WahaMediaKind = 'image' | 'video' | 'file' | 'voice'

/** Send media. Image/video fall back to sendFile if that route is missing on an older Core build. */
export async function sendWahaMedia(input: {
  chatId: string
  kind: WahaMediaKind
  mimetype: string
  filename: string
  dataBase64: string
  caption?: string
}): Promise<{ id: string }> {
  const { base, key, session } = wahaCreds()
  const chatId = toWhatsAppChatId(input.chatId)
  if (!chatId) throw new Error('invalid phone')
  const order: Array<'sendImage' | 'sendVideo' | 'sendFile' | 'sendVoice'> =
    input.kind === 'image' ? ['sendImage', 'sendFile']
    : input.kind === 'video' ? ['sendVideo', 'sendFile']
    :     input.kind === 'voice' ? ['sendVoice', 'sendFile']
    : ['sendFile']
  let last = 'waha media send failed'
  for (const endpoint of order) {
    const body: Record<string, unknown> = {
      session,
      chatId,
      caption: input.caption || undefined,
      file: { mimetype: input.mimetype, filename: input.filename, data: input.dataBase64 },
    }
    if (endpoint === 'sendVoice') body.convert = true
    const { ok, status, data } = await postJson(
      `${base}/api/${endpoint}`,
      body,
      key ? { 'X-Api-Key': key } : {},
    )
    if (status >= 200 && status < 300) {
      return { id: messageIdOf(data) || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }
    }
    last = redactError(new Error(String(data?.message || data?.error || data?.exception || `waha ${endpoint} ${status}`)))
    const missing = status === 404 || status === 405 || status === 501 || /plus|not implemented|cannot post/i.test(last)
    if (!missing || endpoint === order[order.length - 1]) break
  }
  throw new Error(last)
}

async function sendWaha(chatId: string, text: string): Promise<{ id: string }> {
  const { base, key, session } = wahaCreds()
  const { ok, status, data } = await postJson(`${base}/api/sendText`, {
    session,
    chatId,
    text,
    linkPreview: false,
  }, key ? { 'X-Api-Key': key } : {})
  if (status < 200 || status >= 300) {
    const msg = data?.message || data?.error || data?.exception || `waha ${status}`
    throw new Error(redactError(new Error(String(msg))))
  }
  const id = messageIdOf(data) || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return { id }
}

async function sendGreen(chatId: string, text: string, which: 'main' | 'inbox'): Promise<{ id: string }> {
  const { instanceId, token, apiBase } = greenCreds(which)
  const { ok, status, data } = await postJson(
    `${apiBase}/waInstance${instanceId}/sendMessage/${token}`,
    { chatId, message: text },
    {},
  )
  if (!ok || !data?.idMessage) {
    const msg = data?.message || data?.error || `green api ${status}`
    throw new Error(redactError(new Error(String(msg))))
  }
  return { id: String(data.idMessage) }
}

const MAX_DOC = 12 * 1024 * 1024
const MAX_HEAVY = 4 * 1024 * 1024

function reachableMediaUrl(url: string): string {
  const base = trimBase(process.env.WAHA_URL || '')
  if (!url) return ''
  if (url.startsWith('/') && base) return base + url
  try {
    const parsed = new URL(url)
    if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && base) {
      return base + parsed.pathname + parsed.search
    }
  } catch {
    return ''
  }
  return url
}

async function readMediaResponse(resp: Response, msg: ParsedMessage): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!resp.ok) return null
  const mime = (resp.headers.get('content-type') || msg.mimeType || 'application/octet-stream').split(';')[0]
  if (mime.includes('application/json')) return null
  const len = Number(resp.headers.get('content-length') || 0)
  const limit = msg.type === 'video' ? 20 * 1024 * 1024 : msg.type === 'audio' ? 16 * 1024 * 1024 : MAX_DOC
  if (len > limit) return null
  const bytes = new Uint8Array(await resp.arrayBuffer())
  if (!bytes.byteLength || bytes.byteLength > limit) return null
  return { bytes, mime }
}

export async function downloadIncomingMedia(msg: ParsedMessage): Promise<{ bytes: Uint8Array; mime: string } | null> {
  let url = reachableMediaUrl(msg.downloadUrl || '')
  if (!url && msg.hasMedia) {
    url = (providerName() === 'waha' ? await wahaMediaUrl(msg) : await greenMediaUrl(msg)) || ''
    url = reachableMediaUrl(url)
  }
  const wahaBase = trimBase(process.env.WAHA_URL || '')
  const wahaKey = process.env.WAHA_API_KEY || ''
  const headers: Record<string, string> = {}
  if (wahaKey && url && (url.includes('/api/files/') || (wahaBase && url.startsWith(wahaBase)))) {
    headers['X-Api-Key'] = wahaKey
  }
  try {
    if (url) {
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(12000) })
      const file = await readMediaResponse(resp, msg)
      if (file) return file
    }
    if (msg.hasMedia && providerName() === 'waha') {
      const again = reachableMediaUrl((await wahaMediaUrl(msg)) || '')
      if (again && again !== url) {
        const resp = await fetch(again, { headers: { ...headers, ...(wahaKey ? { 'X-Api-Key': wahaKey } : {}) }, signal: AbortSignal.timeout(12000) })
        return await readMediaResponse(resp, msg)
      }
    }
    return null
  } catch (err) {
    console.error('media download failed', redactError(err))
    return null
  }
}

async function wahaMediaUrl(msg: ParsedMessage): Promise<string | undefined> {
  try {
    const { base, key, session } = wahaCreds()
    const url = `${base}/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(msg.chatId)}/messages/${encodeURIComponent(msg.id)}?downloadMedia=true`
    const resp = await fetch(url, {
      headers: { Accept: 'application/json', ...(key ? { 'X-Api-Key': key } : {}) },
      signal: AbortSignal.timeout(8000),
    })
    if (!resp.ok) return undefined
    const data = await resp.json().catch(() => null) as { media?: { url?: string } } | null
    const mediaUrl = data?.media?.url
    return typeof mediaUrl === 'string' ? mediaUrl : undefined
  } catch {
    return undefined
  }
}

async function greenMediaUrl(msg: ParsedMessage): Promise<string | undefined> {
  try {
    const { instanceId, token, apiBase } = greenCreds('inbox')
    const { ok, data } = await postJson(
      `${apiBase}/waInstance${instanceId}/downloadFile/${token}`,
      { chatId: msg.chatId, idMessage: msg.id },
      {},
    )
    if (!ok) return undefined
    return typeof data?.downloadUrl === 'string' ? data.downloadUrl : undefined
  } catch {
    return undefined
  }
}

/** Backup for a second Green API instance. No-op unless that instance is configured and selected. */
export async function drainGreenInbox(onBody: (body: unknown) => Promise<void>, limit = 20): Promise<number> {
  if (providerName() !== 'greenapi') return 0
  const inboxId = process.env.GREENAPI_INBOX_ID_INSTANCE
  if (!inboxId || !process.env.GREENAPI_INBOX_API_TOKEN || inboxId === process.env.GREENAPI_ID_INSTANCE) return 0
  const { instanceId, token, apiBase } = greenCreds('inbox')
  const receiveUrl = `${apiBase}/waInstance${instanceId}/receiveNotification/${token}`
  let n = 0
  for (let i = 0; i < limit; i++) {
    let data: any
    try {
      const resp = await fetch(receiveUrl, { signal: AbortSignal.timeout(8000) })
      if (!resp.ok) break
      data = await resp.json()
    } catch {
      break
    }
    if (!data || data.body == null) break
    try { await onBody(data.body) } catch (err) { console.error('green inbox drain', redactError(err)) }
    try { await fetch(`${apiBase}/waInstance${instanceId}/deleteNotification/${token}/${data.receiptId}`, { method: 'DELETE' }) } catch { /* keep the queue moving */ }
    n++
  }
  return n
}
