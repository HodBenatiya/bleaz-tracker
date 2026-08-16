import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
)

// ── GET: אימות webhook מול Meta ──────────────────────────────────────────────
// Meta שולחת GET עם hub.mode, hub.challenge, hub.verify_token
// חייבים להחזיר את hub.challenge כ-plain text
export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode']
    const challenge = req.query['hub.challenge']
    const token     = req.query['hub.verify_token']

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      console.log('Meta webhook verified')
      return res.status(200).send(challenge)
    }
    return res.status(403).send('Forbidden')
  }

  // ── POST: ליד חדש מ-Meta Lead Ads ────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body ?? {}

    // Meta שולחת מערך של entries עם changes
    const entries = body.entry ?? []

    for (const entry of entries) {
      for (const change of (entry.changes ?? [])) {
        if (change.field !== 'leadgen') continue

        const { leadgen_id, ad_id, form_id, page_id } = change.value ?? {}
        if (!leadgen_id) continue

        try {
          // ── שלוף את פרטי הליד מ-Graph API ──
          const leadUrl = `https://graph.facebook.com/v19.0/${leadgen_id}?access_token=${process.env.FACEBOOK_PAGE_TOKEN}`
          const leadResp = await fetch(leadUrl)
          const lead     = await leadResp.json()

          if (lead.error) {
            console.error('Meta Graph error:', lead.error)
            continue
          }

          // ── פרסר את השדות ──
          const fields: Record<string, string> = {}
          for (const f of (lead.field_data ?? [])) {
            fields[f.name?.toLowerCase().replace(/\s+/g, '_')] = f.values?.[0] ?? ''
          }

          const name  = fields['full_name'] || fields['first_name']
            ? `${fields['first_name'] ?? ''} ${fields['last_name'] ?? ''}`.trim()
            : fields['name'] ?? 'ליד ממטא'

          const phone = (fields['phone_number'] || fields['phone'] || '').replace(/\D/g, '')
          if (!phone) continue   // בלי טלפון אי אפשר לעבוד

          const now = new Date().toISOString()

          const candidate = {
            id:           `lead_meta_${leadgen_id}`,
            name,
            phone,
            age:          fields['age'] ? Number(fields['age']) : undefined,
            city:         fields['city'] || fields['עיר'] || '',
            status:       'new' as const,
            positionType: fields['position'] || fields['תפקיד'] || '',
            source:       `Meta Ads${ad_id ? ` · ${ad_id}` : ''}`,
            nonaStatus:   '' as const,
            notes:        '',
            createdAt:    now,
            updatedAt:    now,
          }

          await supabase.from('candidates').upsert({ id: candidate.id, data: candidate })
          console.log('Saved lead:', name, phone)

        } catch (err) {
          console.error('Lead processing error:', err)
        }
      }
    }

    // Meta מצפה ל-200 תמיד, אחרת היא שולחת שוב
    return res.status(200).json({ ok: true })
  }

  return res.status(405).end()
}
