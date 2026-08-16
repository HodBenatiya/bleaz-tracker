import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
)

// ── Green API base ───────────────────────────────────────────────────────────
function greenBase() {
  const instanceId = process.env.GREENAPI_ID_INSTANCE!
  const serverNum  = instanceId.slice(0, 4)
  const apiBase    = (process.env.GREENAPI_API_URL ?? `https://${serverNum}.api.greenapi.com`).replace(/\/$/, '')
  return { instanceId, apiBase, token: process.env.GREENAPI_API_TOKEN! }
}

async function sendWhatsAppTo(phone: string, msg: string) {
  const { instanceId, apiBase, token } = greenBase()
  const clean = phone.replace(/\D/g, '')
  if (!clean) return
  await fetch(`${apiBase}/waInstance${instanceId}/sendMessage/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: `${clean}@c.us`, message: msg }),
  })
}

async function sendWhatsApp(msg: string) {
  const phone = process.env.REMINDER_PHONE ?? ''
  await sendWhatsAppTo(phone, msg)
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

// ── Message parsing ──────────────────────────────────────────────────────────
function israelNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
}

function parseDateTime(text: string): { date: string; time: string } | null {
  const timeMatch = text.match(/(\d{1,2})[:.ׂ](\d{2})/)
  if (!timeMatch) return null
  const time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`

  const now = israelNow()
  let target = new Date(now)

  if (/מחרתיים/.test(text))      target.setDate(target.getDate() + 2)
  else if (/מחר/.test(text))     target.setDate(target.getDate() + 1)
  else if (/היום|עכשיו/.test(text)) { /* stay today */ }
  else {
    const hebrewDays = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת']
    const jsDay      = [0,1,2,3,4,5,6]
    let matched = false
    for (let i = 0; i < hebrewDays.length; i++) {
      if (text.includes(hebrewDays[i])) {
        const diff = ((jsDay[i] - now.getDay()) + 7) % 7 || 7
        target.setDate(target.getDate() + diff)
        matched = true; break
      }
    }
    if (!matched) {
      const dm = text.match(/(\d{1,2})\/(\d{1,2})/)
      if (dm) {
        target = new Date(now.getFullYear(), parseInt(dm[2]) - 1, parseInt(dm[1]))
        if (target < now) target.setFullYear(now.getFullYear() + 1)
      }
    }
  }

  const yyyy = target.getFullYear()
  const mm   = String(target.getMonth() + 1).padStart(2, '0')
  const dd   = String(target.getDate()).padStart(2, '0')
  return { date: `${yyyy}-${mm}-${dd}`, time }
}

function extractTitle(raw: string): string {
  return raw
    .replace(/(\d{1,2})[:.ׂ](\d{2})/g, '')
    .replace(/מחרתיים|מחר|היום|עכשיו/g, '')
    .replace(/ביום (ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/g, '')
    .replace(/\d{1,2}\/\d{1,2}/g, '')
    .replace(/\bב-|\bל-|\bבשעה\b|\bבשע'\b/g, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[:\-,\s]+|[:\-,\s]+$/g, '').trim()
}

const TRIGGERS = [
  /להוסיף למערכת[:\s]+(.+)/i,
  /הוסיפי למערכת[:\s]+(.+)/i,
  /הוסף למערכת[:\s]+(.+)/i,
  /^משימה[:\s]+(.+)/i,
  /^פגישה[:\s]+(.+)/i,
  /^תזכורת[:\s]+(.+)/i,
]

function parseMessage(text: string): { title: string; datetime: { date: string; time: string } | null } | null {
  for (const re of TRIGGERS) {
    const m = text.match(re)
    if (m) {
      const content  = m[1].trim()
      const datetime = parseDateTime(content)
      const title    = extractTitle(content)
      return { title: title || content, datetime }
    }
  }
  return null
}

// ── Poll Green API for incoming messages ─────────────────────────────────────
async function pollMessages(): Promise<{ processed: number; skipped: number }> {
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

    // מחק תמיד מהתור (גם אם לא עיבדנו)
    try { await fetch(deleteUrl(receiptId), { method: 'DELETE' }) } catch {}

    if (!text) { skipped++; continue }

    const parsed = parseMessage(text)
    if (!parsed) { skipped++; continue }

    const { title, datetime } = parsed
    const now = new Date().toISOString()
    const task = {
      id:           `task_wa_${Date.now()}_${i}`,
      title,
      assignee:     'hod' as const,
      priority:     'medium' as const,
      dueDate:      datetime?.date ?? israelNow().toISOString().split('T')[0],
      dueTime:      datetime?.time,
      done:         false,
      reminderSent: false,
      source:       'whatsapp' as const,
      createdAt:    now,
      updatedAt:    now,
    }

    const { error } = await supabase.from('tasks').upsert({ id: task.id, data: task })

    if (!error) {
      const timeStr = datetime
        ? `📅 ${datetime.date} ⏰ ${datetime.time}`
        : '📅 ללא תאריך — עדכני במערכת'
      await sendWhatsApp(`✅ נוסף למערכת!\n📌 ${title}\n${timeStr}`)
      processed++
    }
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

      await sendWhatsAppTo(c.phone, candidateMsg)

      // אישור לעצמך
      await sendWhatsApp(`✅ נשלחה תזכורת ראיון\n👤 ${c.name} · ${c.phone}\n🕐 ${c.interviewTime} · ${companyName}`)

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

      await sendWhatsApp(msg)
      await supabase.from('tasks').upsert({ id: t._rowId, data: { ...t, reminderSent: true } })
      results.tasks.push({ title: t.title, status: 'sent' })
    } catch (err) {
      results.tasks.push({ title: t.title, status: 'error', detail: String(err) })
    }
  }

  return res.status(200).json({ time: new Date().toISOString(), ...results })
}
