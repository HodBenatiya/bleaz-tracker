import { db } from './_db.js'
import { sendNotify } from './_provider.js'

function israelNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
}

function parseDateTime(text: string): { date: string; time: string } | null {
  const timeMatch = text.match(/(\d{1,2})[:.ׂ](\d{2})/)
  if (!timeMatch) return null
  const time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
  const now = israelNow()
  let target = new Date(now)

  if (/מחרתיים/.test(text)) target.setDate(target.getDate() + 2)
  else if (/מחר/.test(text)) target.setDate(target.getDate() + 1)
  else if (/היום|עכשיו/.test(text)) { /* stay today */ }
  else {
    const hebrewDays = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
    let matched = false
    for (let i = 0; i < hebrewDays.length; i++) {
      if (text.includes(hebrewDays[i])) {
        const diff = ((i - now.getDay()) + 7) % 7 || 7
        target.setDate(target.getDate() + diff)
        matched = true
        break
      }
    }
    if (!matched) {
      const dm = text.match(/(\d{1,2})\/(\d{1,2})/)
      if (dm) {
        target = new Date(now.getFullYear(), parseInt(dm[2], 10) - 1, parseInt(dm[1], 10))
        if (target < now) target.setFullYear(now.getFullYear() + 1)
      }
    }
  }

  const yyyy = target.getFullYear()
  const mm = String(target.getMonth() + 1).padStart(2, '0')
  const dd = String(target.getDate()).padStart(2, '0')
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

export function parseTaskMessage(text: string): { title: string; datetime: { date: string; time: string } | null } | null {
  for (const re of TRIGGERS) {
    const m = text.match(re)
    if (m) {
      const content = m[1].trim()
      return { title: extractTitle(content) || content, datetime: parseDateTime(content) }
    }
  }
  return null
}

/** Creates a task from a WhatsApp command. Returns false when the text is not a command. */
export async function captureTaskCommand(text: string): Promise<boolean> {
  const parsed = parseTaskMessage(text)
  if (!parsed) return false
  const now = new Date().toISOString()
  const today = israelNow()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const task = {
    id: `task_wa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: parsed.title,
    assignee: 'hod' as const,
    priority: 'medium' as const,
    dueDate: parsed.datetime?.date ?? todayStr,
    dueTime: parsed.datetime?.time,
    done: false,
    reminderSent: false,
    source: 'whatsapp' as const,
    createdAt: now,
    updatedAt: now,
  }
  const { error } = await db().from('tasks').upsert({ id: task.id, data: task })
  if (error) throw new Error(error.message)
  const timeStr = parsed.datetime
    ? `📅 ${parsed.datetime.date} ⏰ ${parsed.datetime.time}`
    : '📅 ללא תאריך — עדכנו במערכת'
  try {
    await sendNotify(process.env.REMINDER_PHONE || '', `✅ נוסף למערכת!\n📌 ${parsed.title}\n${timeStr}`)
  } catch (err) {
    console.error('task confirmation failed', err)
  }
  return true
}
