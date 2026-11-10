import { findStoredMedia, readStoredFile } from './_ingest.js'
import { downloadIncomingMedia, redactError } from './_provider.js'
import { imageVisionAvailable, readImageCv, visionAcceptsMime } from './_cvVision.js'
import { imageMime, isRasterCv, readCvForDraft, selectCvMessages } from '../src/utils/extractCvText.js'
import { buildNoteDraftPrompt, draftFromText, IMAGE_CV_STATUS, noteDraftLlmMessages, UNSUPPORTED_CV_STATUS, type NoteDraftImage } from '../src/utils/noteDraft.js'
import { requireUser } from './_auth.js'

interface IncomingMessage {
  id?: string
  direction?: string
  text?: string
  caption?: string
  type?: string
  fileName?: string
  mimeType?: string
  chatId?: string
}

function tail(value: string, max = 8000): string {
  const clean = value.replace(/(?:\+?972|0)5\d{8}/g, '')
  return clean.length <= max ? clean : clean.slice(clean.length - max)
}

function messageText(message: IncomingMessage): string {
  return String(message.text || '').trim() || String(message.caption || '').trim()
}

function remember(extra: string[], pinned: string[], note: string) {
  extra.push(note)
  if (!pinned.includes(note)) pinned.push(note)
}

function keepPinned(draft: string, pinned: string[]): string {
  let next = draft
  for (const note of pinned) {
    if (!next.includes(note)) next = `${next}\n${note}`
  }
  return next
}

async function fileBytes(message: IncomingMessage): Promise<Uint8Array | null> {
  if (!message.id) return null
  try {
    const stored = await findStoredMedia(message.id)
    if (stored?.filePath) {
      const bytes = await readStoredFile(stored.filePath)
      if (bytes?.byteLength) return bytes
    }
  } catch (err) {
    console.error('note draft storage', redactError(err))
  }
  try {
    const file = await downloadIncomingMedia({
      id: message.id,
      chatId: message.chatId || '',
      direction: 'in',
      text: '',
      timestamp: new Date().toISOString(),
      type: message.type === 'image' ? 'image' : 'document',
      mimeType: message.mimeType,
      fileName: message.fileName,
      hasMedia: true,
      source: 'waha',
    })
    return file?.bytes ?? null
  } catch (err) {
    console.error('note draft download', redactError(err))
    return null
  }
}

async function polishWithLlm(prompt: ReturnType<typeof buildNoteDraftPrompt>, fallback: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
  if (!key || !prompt.hasSource) return null
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: noteDraftLlmMessages(prompt),
    }),
  })
  if (!res.ok) throw new Error(`llm ${res.status}`)
  const body = await res.json() as { choices?: { message?: { content?: string } }[] }
  const text = body.choices?.[0]?.message?.content?.trim() || ''
  if (!text.startsWith('טיוטה אוטומטית')) return `${fallback}\n${text}`.trim()
  return text
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!(await requireUser(req, res))) return
  const messages = Array.isArray(req.body?.messages) ? req.body.messages as IncomingMessage[] : []
  const chatId = String(req.body?.chatId || '')
  const incoming = messages.filter(message => message?.direction !== 'out')
  const extra: string[] = []
  const pinned: string[] = []
  const cvParts: string[] = []
  let cvImage: NoteDraftImage | null = null
  const files = selectCvMessages(incoming)

  for (const message of files) {
    const name = message.fileName || 'קובץ'
    const raster = isRasterCv(message.fileName, message.mimeType)
    const mime = imageMime(message.fileName, message.mimeType)
    if (raster && (!imageVisionAvailable() || !visionAcceptsMime(mime))) {
      remember(extra, pinned, IMAGE_CV_STATUS)
      continue
    }
    const bytes = await fileBytes({ ...message, chatId: message.chatId || chatId })
    if (!bytes) {
      extra.push(`לא ניתן לקרוא את ${name}`)
      continue
    }
    if (raster && bytes.byteLength >= 32 && bytes.byteLength <= 4_000_000) {
      cvImage = { mime, base64: Buffer.from(bytes).toString('base64') }
    }
    try {
      const result = await readCvForDraft(bytes, message.mimeType, message.fileName, readImageCv)
      if (result.status === 'text' && result.text.trim()) cvParts.push(result.text)
      else if (result.status === 'image') {
        if (cvImage) extra.push(IMAGE_CV_STATUS)
        else remember(extra, pinned, IMAGE_CV_STATUS)
      }
      else if (result.status === 'unsupported') remember(extra, pinned, UNSUPPORTED_CV_STATUS)
      else extra.push(`לא נמצא טקסט בקובץ ${name}`)
    } catch (err) {
      console.error('note draft extract', redactError(err))
      extra.push(`לא ניתן לקרוא את ${name}`)
    }
  }

  const candidateChat = tail(incoming.map(messageText).filter(Boolean).join('\n'))
  const prompt = buildNoteDraftPrompt({ messages, cvText: cvParts.join('\n'), image: cvImage })
  const rules = draftFromText(candidateChat, cvParts.join('\n'), extra)
  let draft = rules
  let source: 'rules' | 'llm' = 'rules'
  if (process.env.OPENAI_API_KEY || process.env.LLM_API_KEY) {
    try {
      const polished = await polishWithLlm(prompt, rules)
      if (polished) {
        draft = keepPinned(polished, pinned)
        source = 'llm'
      }
    } catch (err) {
      console.error('note draft llm', redactError(err))
    }
  }
  return res.status(200).json({ ok: true, draft, source })
}
