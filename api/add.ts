import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
)

function israelNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
}

function todayStr() {
  const d = israelNow()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
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
  // ── POST: שמירת משימה ──────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { title, dueDate, dueTime } = req.body ?? {}
    if (!title?.trim()) {
      return res.status(400).json({ error: 'missing title' })
    }

    const now  = new Date().toISOString()
    const task = {
      id:           `task_wa_${Date.now()}`,
      title:        title.trim(),
      assignee:     'hod' as const,
      priority:     'medium' as const,
      dueDate:      dueDate || todayStr(),
      dueTime:      dueTime || undefined,
      done:         false,
      reminderSent: false,
      source:       'whatsapp' as const,
      createdAt:    now,
      updatedAt:    now,
    }

    const { error } = await supabase.from('tasks').upsert({ id: task.id, data: task })
    if (error) return res.status(500).json({ error: error.message })

    // אישור בוואטסאפ
    const timeStr = dueTime ? `📅 ${dueDate || todayStr()} ⏰ ${dueTime}` : `📅 ${dueDate || todayStr()}`
    await sendWhatsApp(`✅ נוסף למערכת!\n📌 ${task.title}\n${timeStr}`)

    return res.status(200).json({ ok: true })
  }

  // ── GET: הצג טופס ─────────────────────────────────────────────────────────
  const today = todayStr()
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
  <meta name="apple-mobile-web-app-capable" content="yes"/>
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
  <meta name="theme-color" content="#0f172a"/>
  <title>+ משימה חדשה</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
    html,body{height:100%;background:#0f172a;color:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 20px;min-height:100dvh}

    .card{background:#1e293b;border-radius:24px;padding:28px 24px;width:100%;max-width:380px;
      box-shadow:0 20px 60px rgba(0,0,0,.5)}

    .logo{display:flex;align-items:center;gap:10px;margin-bottom:24px}
    .logo-icon{width:44px;height:44px;background:linear-gradient(135deg,#6366f1,#818cf8);
      border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px}
    .logo-text{font-size:1.1rem;font-weight:700;color:#f1f5f9}
    .logo-sub{font-size:.75rem;color:#64748b;margin-top:1px}

    label{display:block;font-size:.8rem;font-weight:600;color:#94a3b8;margin-bottom:6px;margin-top:16px}
    label:first-of-type{margin-top:0}

    input,textarea{width:100%;background:#0f172a;border:1.5px solid #334155;border-radius:14px;
      color:#f1f5f9;font-size:1rem;padding:14px 16px;outline:none;font-family:inherit;
      transition:border-color .2s;direction:rtl}
    input:focus,textarea:focus{border-color:#6366f1}
    textarea{resize:none;height:80px}
    input[type="date"],input[type="time"]{direction:ltr;text-align:left}

    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}

    .btn{width:100%;background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;
      border:none;border-radius:14px;padding:16px;font-size:1.05rem;font-weight:700;
      cursor:pointer;margin-top:20px;transition:opacity .15s;letter-spacing:.02em}
    .btn:active{opacity:.8}
    .btn:disabled{opacity:.5;cursor:default}

    .success{display:none;flex-direction:column;align-items:center;text-align:center;gap:12px}
    .success-icon{width:72px;height:72px;background:#22c55e22;border-radius:50%;
      display:flex;align-items:center;justify-content:center;font-size:36px}
    .success h2{color:#22c55e;font-size:1.2rem}
    .success p{color:#94a3b8;font-size:.9rem}
    .again{background:none;border:1.5px solid #334155;color:#94a3b8;border-radius:12px;
      padding:10px 20px;font-size:.9rem;cursor:pointer;margin-top:4px}
    .again:active{border-color:#6366f1;color:#f1f5f9}
  </style>
</head>
<body>
<div class="card">
  <!-- Form -->
  <div id="form-view">
    <div class="logo">
      <div class="logo-icon">⚡</div>
      <div>
        <div class="logo-text">Bleaz</div>
        <div class="logo-sub">הוספת משימה מהירה</div>
      </div>
    </div>

    <label>שם המשימה *</label>
    <input id="title" type="text" placeholder="לדוגמה: שיחה עם ירון" autofocus/>

    <div class="row">
      <div>
        <label>תאריך</label>
        <input id="date" type="date" value="${today}"/>
      </div>
      <div>
        <label>שעה</label>
        <input id="time" type="time"/>
      </div>
    </div>

    <button class="btn" id="save-btn" onclick="save()">+ הוסף למשימות</button>
  </div>

  <!-- Success -->
  <div class="success" id="success-view">
    <div class="success-icon">✅</div>
    <h2>נוסף למשימות!</h2>
    <p id="success-text"></p>
    <button class="again" onclick="reset()">+ הוסף עוד משימה</button>
  </div>
</div>

<script>
async function save() {
  const title = document.getElementById('title').value.trim()
  const date  = document.getElementById('date').value
  const time  = document.getElementById('time').value
  if (!title) { document.getElementById('title').focus(); return }

  const btn = document.getElementById('save-btn')
  btn.disabled = true
  btn.textContent = 'שומר...'

  try {
    const r = await fetch('/api/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, dueDate: date, dueTime: time || undefined })
    })
    if (!r.ok) throw new Error()
    document.getElementById('success-text').textContent =
      title + (date ? '  ·  ' + date.split('-').reverse().join('/') : '') + (time ? '  ·  ' + time : '')
    document.getElementById('form-view').style.display = 'none'
    document.getElementById('success-view').style.display = 'flex'
  } catch {
    btn.disabled = false
    btn.textContent = '+ הוסף למשימות'
    alert('שגיאה — נסי שוב')
  }
}

function reset() {
  document.getElementById('title').value = ''
  document.getElementById('time').value  = ''
  document.getElementById('form-view').style.display = 'block'
  document.getElementById('success-view').style.display = 'none'
  const btn = document.getElementById('save-btn')
  btn.disabled = false
  btn.textContent = '+ הוסף למשימות'
  document.getElementById('title').focus()
}

document.getElementById('title').addEventListener('keydown', e => {
  if (e.key === 'Enter') save()
})
</script>
</body>
</html>`)
}
