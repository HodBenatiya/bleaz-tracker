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

/** GET /api/{session}/lids/{lid} → { pn }. pn may be null when WAHA has no mapping. */
export async function resolveWahaLid(lid: string, session?: string): Promise<string | null> {
  let creds: { base: string; key: string; session: string }
  try { creds = wahaCreds() } catch { return null }
  const id = lid.replace(/@lid$/i, '')
  if (!id) return null
  const useSession = session || creds.session
  const url = `${creds.base}/api/${encodeURIComponent(useSession)}/lids/${encodeURIComponent(id)}`
  try {
    const resp = await fetch(url, {
      headers: { Accept: 'application/json', ...(creds.key ? { 'X-Api-Key': creds.key } : {}) },
      signal: AbortSignal.timeout(8000),
    })
    if (!resp.ok) return null
    const data = await resp.json().catch(() => null) as { pn?: string | null } | null
    return typeof data?.pn === 'string' && data.pn ? data.pn : null
  } catch (err) {
    console.error('lid lookup', redactError(err))
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

async function sendWaha(chatId: string, text: string): Promise<{ id: string }> {
  const { base, key, session } = wahaCreds()
  const { ok, status, data } = await postJson(`${base}/api/sendText`, {
    session,
    chatId,
    text,
    linkPreview: false,
  }, key ? { 'X-Api-Key': key } : {})
  if (!ok) {
    const msg = data?.message || data?.error || data?.exception || `waha ${status}`
    throw new Error(redactError(new Error(String(msg))))
  }
  const id = messageIdOf(data?.id) || messageIdOf(data)
  if (!id) throw new Error('waha send returned no message id')
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

export async function downloadIncomingMedia(msg: ParsedMessage): Promise<{ bytes: Uint8Array; mime: string } | null> {
  let url = msg.downloadUrl || ''
  if (!url && msg.hasMedia) {
    url = (providerName() === 'waha' ? await wahaMediaUrl(msg) : await greenMediaUrl(msg)) || ''
  }
  if (!url) return null
  if (url.startsWith('/')) {
    const base = trimBase(process.env.WAHA_URL || '')
    if (!base) return null
    url = base + url
  }
  const headers: Record<string, string> = {}
  const wahaBase = trimBase(process.env.WAHA_URL || '')
  const wahaKey = process.env.WAHA_API_KEY || ''
  if (wahaKey && (url.includes('/api/files/') || (wahaBase && url.startsWith(wahaBase)))) {
    headers['X-Api-Key'] = wahaKey
  }
  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    if (!resp.ok) return null
    const mime = (resp.headers.get('content-type') || msg.mimeType || 'application/octet-stream').split(';')[0]
    const len = Number(resp.headers.get('content-length') || 0)
    const heavy = msg.type === 'audio' || msg.type === 'video'
    const limit = heavy ? MAX_HEAVY : MAX_DOC
    if (len > limit) return null
    const bytes = new Uint8Array(await resp.arrayBuffer())
    if (bytes.byteLength > limit) return null
    return { bytes, mime }
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
