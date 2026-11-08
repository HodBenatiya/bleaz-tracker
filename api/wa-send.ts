import type { WaMessage } from '../src/types/index.js'
import { toWhatsAppChatId } from '../src/utils/wa.js'
import { storeOutgoingMessage } from './_ingest.js'
import { redactError, sendInboxText } from './_provider.js'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const text = String(req.body?.text ?? '').trim()
  const phone = String(req.body?.phone ?? '')
  const chatHint = String(req.body?.chatId ?? '')
  if (!text) return res.status(400).json({ ok: false, error: 'חסר טקסט' })
  if (text.length > 4000) return res.status(400).json({ ok: false, error: 'ההודעה ארוכה מדי' })

  const chatId = toWhatsAppChatId(chatHint || phone)
  if (!chatId) return res.status(400).json({ ok: false, error: 'מספר הטלפון לא תקין' })

  let id = ''
  try {
    const sent = await sendInboxText(chatId, text)
    id = sent.id
  } catch (err) {
    console.error('wa-send', redactError(err))
    return res.status(502).json({ ok: false, sent: false, error: 'השליחה נכשלה. בדקו שהסשן מחובר ונסו שוב.' })
  }

  const message: WaMessage = {
    id,
    direction: 'out',
    text,
    timestamp: new Date().toISOString(),
    type: 'text',
    status: 'sent',
  }

  try {
    await storeOutgoingMessage(chatId, message)
    return res.status(200).json({ ok: true, id, message })
  } catch (err) {
    console.error('wa-send store', redactError(err))
    return res.status(200).json({
      ok: false,
      sent: true,
      stored: false,
      id,
      message,
      error: 'ההודעה נשלחה אבל לא נשמרה במערכת. רעננו את השיחה.',
    })
  }
}
