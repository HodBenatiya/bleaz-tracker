import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
)

const CLIENT_STATUSES = ['sent_to_client', 'interview_scheduled', 'started_working', 'placement_complete']

const STATUS_LABEL: Record<string, string> = {
  sent_to_client:      'נשלח לבחינה',
  interview_scheduled: 'ראיון נקבע',
  started_working:     'התחיל לעבוד',
  placement_complete:  'הושמה הושלמה ✓',
}

const STATUS_STYLE: Record<string, string> = {
  sent_to_client:      'background:#dbeafe;color:#1d4ed8',
  interview_scheduled: 'background:#fef9c3;color:#854d0e',
  started_working:     'background:#d1fae5;color:#065f46',
  placement_complete:  'background:#059669;color:#fff',
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })
}

function fmtUpdated() {
  return new Date().toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
  })
}

export default async function handler(req: any, res: any) {
  const token = req.query.token as string

  if (!token) return res.status(400).send(errorPage('לינק לא תקין'))

  // ── מצא את המשרה לפי הטוקן ──
  const { data: posRows, error: posErr } = await supabase.from('positions').select('id, data')
  if (posErr) return res.status(500).send(errorPage('שגיאת שרת'))

  const posRow = (posRows ?? []).find((r: any) => r.data?.clientToken === token)
  if (!posRow) return res.status(404).send(errorPage('הדף לא נמצא'))

  const pos = posRow.data as any

  // ── מצא מועמדים רלוונטיים ──
  const { data: candidateRows } = await supabase.from('candidates').select('id, data')

  const candidates = (candidateRows ?? [])
    .map((r: any) => r.data)
    .filter((c: any) =>
      CLIENT_STATUSES.includes(c.status) &&
      (c.savedPositionIds?.includes(posRow.id) || c.savedPositionId === posRow.id)
    )
    .sort((a: any, b: any) => CLIENT_STATUSES.indexOf(a.status) - CLIENT_STATUSES.indexOf(b.status))

  // ── ספירות ──
  const counts = {
    sent:      candidates.filter(c => c.status === 'sent_to_client').length,
    interview: candidates.filter(c => c.status === 'interview_scheduled').length,
    working:   candidates.filter(c => c.status === 'started_working').length,
    placed:    candidates.filter(c => c.status === 'placement_complete').length,
  }

  // ── בנה את הדף ──
  const candidateRows2 = candidates.length === 0
    ? `<div class="empty">אין מועמדים בשלב זה</div>`
    : candidates.map((c: any) => `
      <div class="cand">
        <div class="avatar">${c.name.charAt(0)}</div>
        <div class="cand-info">
          <div class="cand-name">${c.name}</div>
          ${c.interviewDate ? `<div class="cand-sub">📅 ראיון: ${fmtDate(c.interviewDate)}${c.interviewTime ? ` · ${c.interviewTime}` : ''}</div>` : ''}
          ${c.startDate ? `<div class="cand-sub">✅ התחלה: ${fmtDate(c.startDate)}</div>` : ''}
        </div>
        <span class="badge" style="${STATUS_STYLE[c.status] ?? ''}">${STATUS_LABEL[c.status] ?? c.status}</span>
      </div>
    `).join('')

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>BLEAZ · ${pos.companyName}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;color:#1e293b;min-height:100vh}

    /* ── Header ── */
    .header{background:#1e293b;padding:28px 32px 24px}
    .brand{font-size:11px;color:#64748b;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px}
    .brand b{color:#94a3b8}
    .company{font-size:26px;font-weight:800;color:#f1f5f9}
    .position{font-size:14px;color:#64748b;margin-top:4px}

    /* ── Content ── */
    .content{max-width:680px;margin:32px auto;padding:0 24px 48px}

    /* ── Stats ── */
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px}
    .stat{background:#fff;border-radius:14px;padding:16px;border:1px solid #e2e8f0;text-align:center}
    .stat-num{font-size:26px;font-weight:800;line-height:1}
    .stat-label{font-size:11px;color:#94a3b8;margin-top:4px}
    .stat.blue   .stat-num{color:#1d4ed8}
    .stat.amber  .stat-num{color:#b45309}
    .stat.emerald.stat-num{color:#065f46}
    .stat.green  .stat-num{color:#059669}

    /* ── Section title ── */
    .section-title{font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;
      letter-spacing:1px;margin-bottom:12px}

    /* ── Candidate card ── */
    .cand{background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:14px 18px;
      display:flex;align-items:center;gap:14px;margin-bottom:8px}
    .avatar{width:42px;height:42px;border-radius:50%;background:#eef2ff;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;color:#4f46e5;font-size:17px;flex-shrink:0}
    .cand-info{flex:1;min-width:0}
    .cand-name{font-weight:600;font-size:15px;color:#1e293b}
    .cand-sub{font-size:12px;color:#94a3b8;margin-top:2px}
    .badge{font-size:11px;font-weight:700;padding:5px 12px;border-radius:20px;
      white-space:nowrap;flex-shrink:0}

    /* ── Empty ── */
    .empty{text-align:center;padding:40px;color:#94a3b8;font-size:14px;
      background:#fff;border-radius:14px;border:1px dashed #e2e8f0}

    /* ── Footer ── */
    .footer{text-align:center;padding:24px;color:#94a3b8;font-size:11px}

    @media(max-width:520px){
      .header{padding:20px 16px}
      .content{padding:0 12px 32px}
      .stats{grid-template-columns:repeat(2,1fr)}
      .cand-name{font-size:14px}
    }
  </style>
</head>
<body>

<div class="header">
  <div class="brand"><b>BLEAZ</b> · סטטוס מועמדים</div>
  <div class="company">${pos.companyName}</div>
  ${pos.positionTitle ? `<div class="position">${pos.positionTitle}${pos.city ? ` · ${pos.city}` : ''}</div>` : ''}
</div>

<div class="content">

  <div class="stats">
    <div class="stat blue">
      <div class="stat-num">${counts.sent}</div>
      <div class="stat-label">נשלחו לבחינה</div>
    </div>
    <div class="stat amber">
      <div class="stat-num">${counts.interview}</div>
      <div class="stat-label">ראיונות</div>
    </div>
    <div class="stat emerald">
      <div class="stat-num">${counts.working}</div>
      <div class="stat-label">התחילו לעבוד</div>
    </div>
    <div class="stat green">
      <div class="stat-num">${counts.placed}</div>
      <div class="stat-label">הושמו ✓</div>
    </div>
  </div>

  <div class="section-title">מועמדים פעילים — ${candidates.length} סה"כ</div>

  ${candidateRows2}

</div>

<div class="footer">עודכן: ${fmtUpdated()} · מופעל על ידי BLEAZ</div>

</body>
</html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.send(html)
}

function errorPage(msg: string) {
  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>BLEAZ</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;display:flex;align-items:center;
justify-content:center;min-height:100vh;background:#f8fafc;color:#64748b;text-align:center}
.box{padding:40px}.icon{font-size:48px;margin-bottom:16px}.msg{font-size:16px}</style>
</head><body><div class="box"><div class="icon">🔒</div><div class="msg">${msg}</div></div></body></html>`
}
