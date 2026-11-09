import { repairLidInbox } from './_ingest.js'
import { redactError } from './_provider.js'
import { requireUser } from './_auth.js'

// The inbox calls this when the screen opens. Rows that still have only a LID
// are looked up again (lids map, one retry, then the contacts endpoint).
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!(await requireUser(req, res))) return
  const session = typeof req.body?.session === 'string' ? req.body.session : undefined
  try {
    const repaired = await repairLidInbox(session)
    return res.status(200).json({ ok: true, repaired })
  } catch (err) {
    const detail = redactError(err)
    console.error('wa-resolve', detail)
    return res.status(500).json({ error: 'resolve failed', detail })
  }
}
