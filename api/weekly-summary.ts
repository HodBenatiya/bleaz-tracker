import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
)

function israelNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
}

function startOfWeek() {
  const now = israelNow()
  const day = now.getDay() // 0=Sun
  const mon = new Date(now)
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  mon.setHours(0, 0, 0, 0)
  return mon
}

function endOfWeek() {
  const start = startOfWeek()
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return end
}

function fmtShortDate(d: Date) {
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' })
}

async function sendWhatsApp(msg: string) {
  const instanceId = process.env.GREENAPI_ID_INSTANCE!
  const serverNum  = instanceId.slice(0, 4)
  const apiBase    = (process.env.GREENAPI_API_URL ?? `https://${serverNum}.api.greenapi.com`).replace(/\/$/, '')
  const phone      = (process.env.REMINDER_PHONE ?? '').replace(/\D/g, '')
  await fetch(`${apiBase}/waInstance${instanceId}/sendMessage/${process.env.GREENAPI_API_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: `${phone}@c.us`, message: msg }),
  })
}

export default async function handler(req: any, res: any) {
  const authHeader = (req.headers['authorization'] ?? '') as string
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const secret = bearerSecret ?? req.headers['x-cron-secret'] ?? req.query?.secret
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET)
    return res.status(401).json({ error: 'unauthorized' })

  const weekStart = startOfWeek()
  const weekEnd   = endOfWeek()

  const [{ data: candidateRows }, { data: posRows }, { data: taskRows }] = await Promise.all([
    supabase.from('candidates').select('id, data'),
    supabase.from('positions').select('id, data'),
    supabase.from('tasks').select('id, data'),
  ])

  const candidates = (candidateRows ?? []).map((r: any) => r.data)
  const positions  = (posRows ?? []).map((r: any) => r.data)
  const tasks      = (taskRows ?? []).map((r: any) => r.data)

  // ── סטטיסטיקות שבועיות ──
  const newThisWeek = candidates.filter(c => {
    const d = new Date(c.createdAt)
    return d >= weekStart && d <= weekEnd
  })

  const sentThisWeek = candidates.filter(c => {
    const d = new Date(c.updatedAt ?? c.createdAt)
    return c.status === 'sent_to_client' && d >= weekStart && d <= weekEnd
  })

  // ראיונות השבוע הקרוב (לפי interviewDate)
  const interviewsThisWeek = candidates.filter(c => {
    if (!c.interviewDate) return false
    const d = new Date(c.interviewDate + 'T12:00:00')
    return d >= weekStart && d <= weekEnd
  })

  const placedThisWeek = candidates.filter(c => {
    const d = new Date(c.updatedAt ?? c.createdAt)
    return c.status === 'placement_complete' && d >= weekStart && d <= weekEnd
  })

  const openPositions = positions.filter((p: any) => p.isActive)

  // משימות פתוחות (לא בוצעו)
  const openTasks = tasks.filter((t: any) => !t.done)
  const overdueTasks = openTasks.filter((t: any) => t.dueDate && t.dueDate < israelNow().toISOString().split('T')[0])

  // ── בניית הודעה ──
  const dateRange = `${fmtShortDate(weekStart)}–${fmtShortDate(weekEnd)}`

  const lines = [
    `📊 *סיכום שבועי — BLEAZ*`,
    `🗓️ ${dateRange}`,
    ``,
    `👥 מועמדים חדשים: *${newThisWeek.length}*`,
    `📤 נשלחו ללקוח: *${sentThisWeek.length}*`,
    `🗓️ ראיונות השבוע: *${interviewsThisWeek.length}*`,
    `🏆 הושמו: *${placedThisWeek.length}*`,
    ``,
    `📋 משרות פתוחות: *${openPositions.length}*`,
  ]

  if (openTasks.length > 0) {
    lines.push(``)
    lines.push(`✅ משימות פתוחות: *${openTasks.length}*${overdueTasks.length > 0 ? ` (${overdueTasks.length} באיחור ⚠️)` : ''}`)
  }

  // ראיונות קרובים — פירוט
  if (interviewsThisWeek.length > 0) {
    lines.push(``)
    lines.push(`📅 *ראיונות השבוע:*`)
    interviewsThisWeek
      .sort((a, b) => (a.interviewDate ?? '').localeCompare(b.interviewDate ?? ''))
      .slice(0, 5)
      .forEach(c => {
        const day = new Date(c.interviewDate + 'T12:00:00').toLocaleDateString('he-IL', {
          weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem',
        })
        lines.push(`  · ${c.name} — ${day}${c.interviewTime ? ` ${c.interviewTime}` : ''}`)
      })
    if (interviewsThisWeek.length > 5) {
      lines.push(`  ועוד ${interviewsThisWeek.length - 5}...`)
    }
  }

  const msg = lines.join('\n')

  try {
    await sendWhatsApp(msg)
    return res.status(200).json({ ok: true, stats: { newThisWeek: newThisWeek.length, sentThisWeek: sentThisWeek.length, interviewsThisWeek: interviewsThisWeek.length, placedThisWeek: placedThisWeek.length } })
  } catch (err) {
    return res.status(500).json({ error: String(err) })
  }
}
