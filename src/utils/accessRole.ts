/** Viewer vs admin. Pure helpers — the database is the enforcement. */

export type AppRole = 'admin' | 'viewer'

/** The one restricted account. Compared case-insensitively. */
export const VIEWER_EMAIL = 'natalie@nona-jobs.com'

/** Hard cap for one viewer_read_page call. Matches the SQL function. */
export const VIEWER_PAGE_SIZE = 50

/** Screens that write, export, or read tables the viewer must not query. */
export const VIEWER_HIDDEN_VIEWS = ['form', 'whatsapp', 'meta'] as const

export type ViewerHiddenView = (typeof VIEWER_HIDDEN_VIEWS)[number]

const STORAGE_KEYS = new Set([
  'clientToken',
  'cvUrl',
  'fileUrl',
  'filePath',
  'downloadUrl',
  'token_env',
  'accessToken',
  'access_token',
  'signedUrl',
])

const STORAGE_VALUE = /^(cvs:|wa-media:)|\/storage\/v1\/object\/|\/api\/wa-media\?/i

export function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase()
}

/**
 * Resolve the role shown in the UI.
 * A stored row wins, so Natalie can be promoted later by changing user_roles.
 * With no row (migration not applied yet, or a brand-new login), her email is
 * a viewer and everyone else stays an admin — the same access they have today.
 */
export function resolveAppRole(input: {
  email?: string | null
  role?: string | null
}): AppRole {
  if (input.role === 'viewer' || input.role === 'admin') return input.role
  if (normalizeEmail(input.email) === VIEWER_EMAIL) return 'viewer'
  return 'admin'
}

export function isStaffAllowed(email: string | null | undefined, role: string | null | undefined): boolean {
  return resolveAppRole({ email, role }) === 'admin'
}

export function viewAllowed(role: AppRole, view: string): boolean {
  if (role === 'admin') return true
  return !(VIEWER_HIDDEN_VIEWS as readonly string[]).includes(view)
}

export function clampViewerLimit(limit: number | null | undefined): number {
  const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.trunc(limit) : VIEWER_PAGE_SIZE
  if (n < 1) return 1
  if (n > VIEWER_PAGE_SIZE) return VIEWER_PAGE_SIZE
  return n
}

/** Drop file pointers and client-portal tokens. Names, phones, and notes stay. */
export function redactJson<T>(value: T): T {
  return redactValue(value) as T
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && STORAGE_VALUE.test(value)) return null
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (STORAGE_KEYS.has(key)) continue
    const next = redactValue(inner)
    if (typeof next === 'string' && STORAGE_VALUE.test(next)) continue
    out[key] = next
  }
  return out
}

export type ExtractEvent = 'copy' | 'cut' | 'print' | 'contextmenu' | 'drag' | 'selectall'

/** True when the viewer UI should cancel the browser event. */
export function blockViewerExtract(role: AppRole, event: ExtractEvent): boolean {
  return role === 'viewer'
}
