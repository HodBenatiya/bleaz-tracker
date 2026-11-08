import { ingestWebhookBody } from './_ingest.js'
import { providerName, redactError } from './_provider.js'

function authorized(req: { headers?: Record<string, string | string[] | undefined>; query?: Record<string, unknown> }): boolean {
  const expected = process.env.WA_WEBHOOK_TOKEN || ''
  if (!expected) return true
  const headerRaw = req.headers?.authorization ?? req.headers?.Authorization
  const header = Array.isArray(headerRaw) ? headerRaw[0] : String(headerRaw ?? '')
  const token = header.startsWith('Bearer ') ? header.slice(7) : header
  const queryToken = req.query?.token
  return token === expected || queryToken === expected
}

// WAHA posts { event, session, payload }. Green API posts { typeWebhook, ... }.
// Both are accepted so the number can move without dropping a lead mid-switch.
export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, provider: providerName() })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const body = req.body ?? {}
  const session = typeof body.session === 'string' ? body.session : ''
  const expectedSession = process.env.WAHA_SESSION
  if (session && expectedSession && session !== expectedSession) {
    return res.status(200).json({ ok: true, action: 'ignored-session' })
  }

  try {
    const result = await ingestWebhookBody(body, { downloadFiles: true, captureTasks: true })
    return res.status(200).json({ ok: true, ...result })
  } catch (err) {
    console.error('wa-webhook', redactError(err))
    return res.status(500).json({ error: 'ingest failed' })
  }
}
