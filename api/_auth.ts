import { db } from './_db.js'

export function readBearer(req: { headers?: Record<string, string | string[] | undefined> }): string {
  const raw = req.headers?.authorization ?? req.headers?.Authorization
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return ''
  const match = String(value).match(/^Bearer\s+(\S+)/i)
  return match?.[1]?.trim() || ''
}

/** Browser calls must carry the logged-in user's Supabase access token. */
export async function requireUser(req: { headers?: Record<string, string | string[] | undefined> }, res: { status: (code: number) => { json: (body: unknown) => unknown } }): Promise<boolean> {
  const token = readBearer(req)
  if (!token) {
    res.status(401).json({ error: 'נדרשת התחברות' })
    return false
  }
  const { data, error } = await db().auth.getUser(token)
  if (error || !data.user) {
    res.status(401).json({ error: 'ההתחברות פגה. התחברו שוב.' })
    return false
  }
  return true
}
