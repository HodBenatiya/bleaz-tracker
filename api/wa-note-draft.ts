import { findStoredMedia, readStoredFile } from './_ingest.js'
import { downloadIncomingMedia, redactError } from './_provider.js'
import { extractCvText } from '../src/utils/extractCvText.js'
import { draftFromText } from '../src/utils/noteDraft.js'
import { looksLikeCv } from '../src/utils/wa.js'
import { requireUser } from './_auth.js'

interface IncomingMessage {
  id?: string
  direction?: string
  text?: string
  type?: string
  fileName?: string
  mimeType?: string
  chatId?: string
}

function clip(value: string, max = 8000): string {
  return value.replace(/(?:\+?972|0)5\d{8}/g, '').slice(0, max)
}

function isImage(message: IncomingMessage): boolean {
  const mime = (message.mimeType || '').toLowerCase()
  const name = (message.fileName || '').toLowerCase()
  return mime.startsWith('image/') || message.type === 'image' || message.type === 'sticker' || /\.(png|jpe?g|webp|gif)$/.test(name)
}

function isReadableCv(message: IncomingMessage): boolean {
  const mime = (message.mimeType || '').toLowerCase()
  const name = (message.fileName || '').toLowerCase()
  return name.endsWith('.pdf') || name.endsWith('.docx') || mime.includes('pdf') || mime.includes('wordprocessingml')
    || looksLikeCv(message.fileName, message.mimeType)
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

async function polishWithLlm(chat: string, cv: string, fallback: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
  if (!key) return null
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const source = clip(`שיחה:\n${chat}\n\nקורות חיים:\n${cv}`, 6000)
  if (!source.trim()) return null
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'Write a concise Hebrew screening note for a recruiter. Start with the exact line "טיוטה אוטומטית – לבדוק". Then only these labels when the source supports them: אזור, היקף, ניסיון, השכלה, זמינות, משרה שפנה אליה, הערות. No scores, no invented facts, no phone numbers.',
        },
        { role: 'user', content: source },
      ],
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
  const incoming = messages.filter(message => message?.direction !== 'out').slice(-40)
  const chat = clip(incoming.map(message => String(message.text || '').trim()).filter(Boolean).join('\n'))
  const extra: string[] = []
  const cvParts: string[] = []
  const files = incoming.filter(message => isReadableCv(message) || (isImage(message) && looksLikeCv(message.fileName, message.mimeType))).slice(-2)

  for (const message of files) {
    const name = message.fileName || 'קובץ'
    if (isImage(message) && !String(message.fileName || '').toLowerCase().match(/\.docx$|\.pdf$/)) {
      extra.push(`צורף צילום (${name}) — לא חולץ טקסט מתמונה`)
      continue
    }
    const bytes = await fileBytes({ ...message, chatId: message.chatId || chatId })
    if (!bytes) {
      extra.push(`לא ניתן לקרוא את ${name}`)
      continue
    }
    try {
      const text = extractCvText(bytes, message.mimeType, message.fileName)
      if (text.trim()) cvParts.push(text)
      else extra.push(`לא נמצא טקסט בקובץ ${name}`)
    } catch (err) {
      console.error('note draft extract', redactError(err))
      extra.push(`לא ניתן לקרוא את ${name}`)
    }
  }

  const rules = draftFromText(chat, cvParts.join('\n'), extra)
  let draft = rules
  let source: 'rules' | 'llm' = 'rules'
  if (process.env.OPENAI_API_KEY || process.env.LLM_API_KEY) {
    try {
      const polished = await polishWithLlm(chat, cvParts.join('\n'), rules)
      if (polished) {
        draft = polished
        source = 'llm'
      }
    } catch (err) {
      console.error('note draft llm', redactError(err))
    }
  }
  return res.status(200).json({ ok: true, draft, source })
}
