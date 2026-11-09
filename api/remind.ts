import { db } from './_db.js'
import { ingestWebhookBody } from './_ingest.js'
import { drainGreenInbox, sendNotify } from './_provider.js'
import { captureTaskCommand } from './_tasks.js'

const supabase = { from: (...args: Parameters<ReturnType<typeof db>['from']>) => db().from(...args) }

// ── Green API base ───────────────────────────────────────────────────────────
function greenBase() {
  const instanceId = process.env.GREENAPI_ID_INSTANCE!
  const serverNum  = instanceId.slice(0, 4)
  const apiBase    = (process.env.GREENAPI_API_URL ?? `https://${serverNum}.api.greenapi.com`).replace(/\/$/, '')
  return { instanceId, apiBase, token: process.env.GREENAPI_API_TOKEN! }
}

// ── Timing ───────────────────────────────────────────────────────────────────
const INTERVIEW_BEFORE_MS = 3 * 60 * 60 * 1000
const TASK_BEFORE_MS      = 15 * 60 * 1000
const MARGIN_MS           = 8 * 60 * 1000

function inWindow(eventMs: number, beforeMs: number) {
  const diff = eventMs - Date.now()
  return diff >= beforeMs - MARGIN_MS && diff <= beforeMs + MARGIN_MS
}
function toMs(date: string, time: string) {
  return new Date(`${date}T${time}:00+03:00`).getTime()
}

// ── Poll Green API for incoming messages ─────────────────────────────────────
async function pollMessages(): Promise<{ processed: number; skipped: number }> {
  if (!process.env.GREENAPI_ID_INSTANCE || !process.env.GREENAPI_API_TOKEN) {
    return { processed: 0, skipped: 0 }
  }
  const { instanceId, apiBase, token } = greenBase()
  const receiveUrl = `${apiBase}/waInstance${instanceId}/receiveNotification/${token}`
  const deleteUrl  = (id: number) => `${apiBase}/waInstance${instanceId}/deleteNotification/${token}/${id}`

  let processed = 0, skipped = 0

  // עיבוד עד 20 הודעות בהרצה אחת
  for (let i = 0; i < 20; i++) {
    let data: any
    try {
      const resp = await fetch(receiveUrl)
      if (!resp.ok) break
      data = await resp.json()
    } catch { break }

    // אין יותר הודעות בתור
    if (!data || data.body === null || data.body === undefined) break

    const receiptId: number = data.receiptId
    const body = data.body ?? {}
    const text: string =
      body?.messageData?.textMessageData?.textMessage ??
      body?.messageData?.extendedTextMessageData?.text ?? ''

    // שומרים כל שיחה לפני המחיקה מהתור, כדי שפקודת משימה לא תמחק ליד.
    try { await ingestWebhookBody(body, { downloadFiles: false, captureTasks: false }) }
    catch (err) { console.error('ingestWaEvent', err) }

    try { await fetch(deleteUrl(receiptId), { method: 'DELETE' }) } catch {}

    if (!text) { skipped++; continue }
    try {
      const created = await captureTaskCommand(text)
      if (created) processed++
      else skipped++
    } catch (err) {
      console.error('captureTaskCommand', err)
      skipped++
    }
  }

  try {
    await drainGreenInbox(async body => {
      await ingestWebhookBody(body, { downloadFiles: false, captureTasks: false })
    })
  } catch (err) {
    console.error('drainGreenInbox', err)
  }

  return { processed, skipped }
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  const authHeader = (req.headers['authorization'] ?? '') as string
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const secret = bearerSecret ?? req.headers['x-cron-secret'] ?? req.query?.secret
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET)
    return res.status(401).json({ error: 'unauthorized' })

  const results: Record<string, any> = { interviews: [], tasks: [], messages: {} }

  // ── 1. שאב הודעות נכנסות מוואטסאפ ────────────────────────────────────────
  try {
    results.messages = await pollMessages()
  } catch (err) {
    console.error('pollMessages error:', err)
    results.messages = { error: String(err) }
  }

  // ── 2. תזכורות ראיונות (2 שעות לפני) ────────────────────────────────────
  const [{ data: candidateRows, error: cErr }, { data: posRows }] = await Promise.all([
    supabase.from('candidates').select('id, data'),
    supabase.from('positions').select('id, data'),
  ])
  if (cErr) return res.status(500).json({ error: cErr.message })

  const posMap: Record<string, any> = {}
  for (const p of posRows ?? []) posMap[p.id] = p.data

  const interviewsToNotify = (candidateRows ?? [])
    .map((r: any) => ({ ...r.data, _rowId: r.id }))
    .filter((c: any) =>
      c.status === 'interview_scheduled' &&
      c.interviewDate && c.interviewTime &&
      !c.interviewReminderSent &&
      inWindow(toMs(c.interviewDate, c.interviewTime), INTERVIEW_BEFORE_MS)
    )

  for (const c of interviewsToNotify) {
    try {
      const posIds: string[] = c.savedPositionIds?.length
        ? c.savedPositionIds
        : c.savedPositionId ? [c.savedPositionId] : []
      const positions = posIds.map((id: string) => posMap[id]).filter(Boolean)
      const companyName = positions.length
        ? positions[0].companyName
        : c.positionType || 'החברה'
      const positionTitle = positions.length && positions[0].positionTitle
        ? ` — ${positions[0].positionTitle}`
        : ''

      // הודעה למועמד
      const candidateMsg = [
        `שלום ${c.name}! 👋`,
        ``,
        `מזכירים לך שיש לך ראיון עבודה היום בשעה ${c.interviewTime} 🕐`,
        `💼 ${companyName}${positionTitle}`,
        ``,
        `בהצלחה! 🍀`,
      ].join('\n')

      await sendNotify(c.phone, candidateMsg)

      // אישור לעצמך
      await sendNotify(process.env.REMINDER_PHONE ?? '', `✅ נשלחה תזכורת ראיון\n👤 ${c.name} · ${c.phone}\n🕐 ${c.interviewTime} · ${companyName}`)

      // שולף גרסה עדכנית לפני הכתיבה — מונע דריסת שינויים שנעשו בינתיים
      const { data: freshRow } = await supabase
        .from('candidates').select('data').eq('id', c._rowId).single()
      const freshData = freshRow?.data ?? c
      await supabase.from('candidates').upsert({
        id:         c._rowId,
        data:       { ...freshData, interviewReminderSent: true },
        updated_at: new Date().toISOString(),
      })
      results.interviews.push({ name: c.name, phone: c.phone, status: 'sent' })
    } catch (err) {
      results.interviews.push({ name: c.name, status: 'error', detail: String(err) })
    }
  }

  // ── 3. תזכורות משימות (15 דקות לפני) ────────────────────────────────────
  const { data: taskRows } = await supabase.from('tasks').select('id, data')
  const tasksToNotify = (taskRows ?? [])
    .map((r: any) => ({ ...r.data, _rowId: r.id }))
    .filter((t: any) =>
      !t.done && !t.reminderSent && !t._debug &&
      t.dueDate && t.dueTime &&
      inWindow(toMs(t.dueDate, t.dueTime), TASK_BEFORE_MS)
    )

  for (const t of tasksToNotify) {
    try {
      const msg = [
        `⏰ תזכורת — עוד 15 דקות`,
        `📌 ${t.title}`,
        `🕐 ${t.dueTime}`,
      ].filter(Boolean).join('\n')

      await sendNotify(process.env.REMINDER_PHONE ?? '', msg)
      await supabase.from('tasks').upsert({ id: t._rowId, data: { ...t, reminderSent: true } })
      results.tasks.push({ title: t.title, status: 'sent' })
    } catch (err) {
      results.tasks.push({ title: t.title, status: 'error', detail: String(err) })
    }
  }

  return res.status(200).json({ time: new Date().toISOString(), ...results })
}
