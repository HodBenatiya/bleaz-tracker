import type { WaMessage, WaMessageType } from '../src/types/index.js'
import { toWhatsAppChatId } from '../src/utils/wa.js'
import { storeOutgoingMessage, uploadWaFile } from './_ingest.js'
import { providerName, redactError, sendInboxText, sendWahaMedia, type WahaMediaKind } from './_provider.js'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const text = String(req.body?.text ?? '').trim()
  const phone = String(req.body?.phone ?? '')
  const chatHint = String(req.body?.chatId ?? '')
  const media = req.body?.media as { kind?: string; filename?: string; mimetype?: string; data?: string } | undefined
  const hasMedia = !!media?.data && !!media?.mimetype
  if (!text && !hasMedia) return res.status(400).json({ ok: false, error: 'חסר טקסט' })
  if (text.length > 4000) return res.status(400).json({ ok: false, error: 'ההודעה ארוכה מדי' })

  const chatId = toWhatsAppChatId(chatHint || phone)
  if (!chatId) return res.status(400).json({ ok: false, error: 'מספר הטלפון לא תקין' })

  let id = ''
  let filePath: string | undefined
  let mediaType: WaMessageType = 'text'
  let fileName: string | undefined
  let mimeType: string | undefined
  try {
    if (hasMedia && providerName() === 'waha') {
      const bytes = Buffer.from(String(media!.data), 'base64')
      if (!bytes.length || bytes.length > 3 * 1024 * 1024) {
        return res.status(400).json({ ok: false, error: 'הקובץ גדול מדי או ריק. עד 3MB.' })
      }
      const kind = (['image', 'video', 'voice', 'file'].includes(String(media!.kind)) ? media!.kind : 'file') as WahaMediaKind
      fileName = String(media!.filename || 'file')
      mimeType = String(media!.mimetype)
      mediaType = kind === 'voice' ? 'audio' : kind === 'file' ? 'document' : kind
      const sent = await sendWahaMedia({
        chatId,
        kind,
        mimetype: mimeType,
        filename: fileName,
        dataBase64: String(media!.data),
        caption: text,
      })
      id = sent.id
      filePath = await uploadWaFile(chatId, fileName, new Uint8Array(bytes), mimeType) || undefined
    } else if (hasMedia) {
      return res.status(400).json({ ok: false, error: 'שליחת קבצים זמינה כשהספק הוא WAHA.' })
    } else {
      const sent = await sendInboxText(chatId, text)
      id = sent.id
    }
  } catch (err) {
    const detail = redactError(err)
    console.error('wa-send', detail)
    return res.status(502).json({
      ok: false,
      sent: false,
      error: 'השליחה נכשלה. בדקו שהסשן מחובר ונסו שוב.',
      detail,
    })
  }

  const message: WaMessage = {
    id,
    direction: 'out',
    text,
    timestamp: new Date().toISOString(),
    type: mediaType,
    fileName,
    mimeType,
    filePath,
    fileUrl: filePath || hasMedia ? `/api/wa-media?id=${encodeURIComponent(id)}` : undefined,
    status: 'sent',
    source: providerName() === 'waha' ? 'waha' : 'greenapi',
  }

  try {
    await storeOutgoingMessage(chatId, message)
    return res.status(200).json({ ok: true, stored: true, id, message })
  } catch (err) {
    console.error('wa-send store', redactError(err))
    return res.status(200).json({ ok: true, stored: false, id, message })
  }
}
