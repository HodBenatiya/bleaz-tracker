import { isStaffAllowed } from '../src/utils/accessRole.js'
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

/**
 * Logged-in staff only. Viewers are rejected before a service-role handler
 * can read storage or scan every candidate. A missing user_roles table
 * (migration not applied yet) still blocks natalie@nona-jobs.com and leaves
 * every other account on the admin path.
 */
export async function requireStaff(req: { headers?: Record<string, string | string[] | undefined> }, res: { status: (code: number) => { json: (body: unknown) => unknown } }): Promise<boolean> {
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
  const lookup = await db().from('user_roles').select('role').eq('user_id', data.user.id).maybeSingle()
  const role = lookup.error ? undefined : (lookup.data?.role ?? null)
  if (!isStaffAllowed(data.user.email, role)) {
    res.status(403).json({ error: 'צפייה בלבד' })
    return false
  }
  return true
}
