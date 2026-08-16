import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
)

// endpoint פשוט שMake.com / Zapier שולח אליו כשנכנס ליד חדש מפייסבוק
export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    return res.status(200).send(`
      <html dir="rtl"><head><meta charset="utf-8"><title>BLEAZ — ממשק לידים</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}
      .box{background:white;border-radius:16px;padding:40px;max-width:420px;text-align:center;box-shadow:0 4px 24px #0001;border:1px solid #e2e8f0}
      h2{color:#1e293b;margin:0 0 8px}p{color:#64748b;font-size:14px;margin:0 0 16px}
      .badge{display:inline-block;background:#d1fae5;color:#065f46;border-radius:999px;padding:4px 14px;font-size:13px;font-weight:600}</style>
      </head><body><div class="box">
      <div style="font-size:40px;margin-bottom:16px">✅</div>
      <h2>ממשק לידים פעיל</h2>
      <p>נקודת הקצה הזו מקבלת לידים אוטומטית מ-Zapier / Make.com<br>ומוסיפה אותם ישירות למערכת BLEAZ.</p>
      <span class="badge">POST /api/apply</span>
      <p style="margin-top:16px;font-size:12px;color:#94a3b8">לא ניתן לפתוח בדפדפן — רק Zapier שולח לכאן</p>
      </div></body></html>
    `)
  }

  if (req.method !== 'POST') return res.status(405).end()

  const { name, phone, city, position_type, source, campaign } = req.body ?? {}

  const cleanPhone = (phone ?? '').replace(/\D/g, '')
  if (!cleanPhone || !name) {
    return res.status(400).json({ error: 'name and phone are required' })
  }

  const now = new Date().toISOString()
  const id  = `lead_fb_${Date.now()}`

  const candidate = {
    id,
    name:         String(name).trim(),
    phone:        cleanPhone,
    city:         String(city ?? '').trim(),
    status:       'new' as const,
    positionType: String(position_type ?? '').trim(),
    source:       String(source ?? campaign ?? 'Facebook Lead Ads').trim(),
    nonaStatus:   '' as const,
    notes:        '',
    createdAt:    now,
    updatedAt:    now,
  }

  const { error } = await supabase.from('candidates').upsert({ id, data: candidate })
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true, id })
}
