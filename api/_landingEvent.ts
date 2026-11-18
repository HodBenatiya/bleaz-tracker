import { db } from './_db.js'

const UTM_KEY = /^utm_[a-z0-9_]{1,40}$/
const FB_INAPP = /FBAN|FBAV|Instagram/i
const MAX_BODY = 2048
const MAX_UA_INPUT = 500
const MAX_UA = 160
const MAX_UTM_KEYS = 12
const MAX_UTM_VALUE = 200

export type LandingEventRow = {
  event_type: 'view' | 'click'
  utm: Record<string, string>
  has_fbclid: boolean
  user_agent: string
  is_fb_inapp: boolean
}

/** Lead posts always include a name or phone. Those stay on the apply handler. */
export function isLandingBeacon(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const body = input as Record<string, unknown>
  if (body.event_type !== 'view' && body.event_type !== 'click') return false
  if (typeof body.has_fbclid !== 'boolean') return false
  if ('name' in body || 'phone' in body) return false
  return true
}

/** Allowlisted fields only. Lengths are capped. fbclid's value is never accepted. */
export function sanitizeLandingEvent(input: unknown): LandingEventRow | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const body = input as Record<string, unknown>
  if (body.event_type !== 'view' && body.event_type !== 'click') return null
  if (typeof body.has_fbclid !== 'boolean') return null
  if (typeof body.user_agent !== 'string' || body.user_agent.length > MAX_UA_INPUT) return null
  if (body.utm == null || typeof body.utm !== 'object' || Array.isArray(body.utm)) return null

  const utm: Record<string, string> = {}
  for (const [key, value] of Object.entries(body.utm as Record<string, unknown>)) {
    const normalized = key.toLowerCase()
    if (!UTM_KEY.test(normalized)) continue
    if (typeof value !== 'string') return null
    if (Object.keys(utm).length >= MAX_UTM_KEYS) break
    utm[normalized] = value.slice(0, MAX_UTM_VALUE)
  }

  const user_agent = body.user_agent.slice(0, MAX_UA)
  return {
    event_type: body.event_type,
    utm,
    has_fbclid: body.has_fbclid,
    user_agent,
    is_fb_inapp: FB_INAPP.test(body.user_agent),
  }
}

export default async function handler(req: { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown }, res: { status: (code: number) => { end: () => void } }) {
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }

  try {
    const lengthHeader = req.headers?.['content-length']
    const declared = Number(Array.isArray(lengthHeader) ? lengthHeader[0] : lengthHeader || 0)
    if (Number.isFinite(declared) && declared > MAX_BODY) {
      res.status(413).end()
      return
    }

    let payload = req.body
    if (typeof payload === 'string') {
      if (payload.length > MAX_BODY) {
        res.status(413).end()
        return
      }
      payload = JSON.parse(payload)
    } else if (payload && typeof payload === 'object' && JSON.stringify(payload).length > MAX_BODY) {
      res.status(413).end()
      return
    }

    const row = sanitizeLandingEvent(payload)
    if (!row) {
      res.status(400).end()
      return
    }

    const { error } = await db().from('landing_events').insert(row)
    res.status(error ? 500 : 204).end()
  } catch {
    res.status(400).end()
  }
}
