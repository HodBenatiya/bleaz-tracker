import { db } from './_db.js'
import { isBotUserAgent } from '../src/utils/goBot.js'
import { sanitizeVariant } from '../src/utils/organicJobs.js'

/** Public WhatsApp number for /go links. Do not add any other number here. */
export const WA_PHONE = '972559817733'
export const PLAIN_WA_URL = `https://wa.me/${WA_PHONE}`

const INSERT_TIMEOUT_MS = 800

/**
 * Prefill texts for /go/1 .. /go/10. These are the only message bodies.
 * They are not loaded from jobs, candidates, or any other record.
 */
export const GO_JOB_TEXTS: Record<number, string> = {
  1: 'היי, אשמח לקבל פרטים על משרת קשרי לקוחות בבית השקעות',
  2: 'היי, אשמח לקבל פרטים על משרת שירות לקוחות ברמת החייל',
  3: 'היי, אשמח לקבל פרטים על משרת שירות במוקד מעסיקים בפתח תקווה',
  4: 'היי, אשמח לקבל פרטים על משרת מכירות במוקד פיננסי בגבעת שאול',
  5: 'היי, אשמח לקבל פרטים על משרת תומך/ת מסחר בשוק ההון',
  6: 'היי, אשמח לקבל פרטים על משרת הנהלת חשבונות מהבית',
  7: 'היי, אשמח לקבל פרטים על משרת יועץ/ת השקעות ג׳וניור בתל אביב',
  8: 'היי, אשמח לקבל פרטים על משרת מכירות ברמת גן',
  9: 'היי, אשמח לקבל פרטים על משרת שימור לקוחות בפתח תקווה',
  10: 'היי, אשמח לקבל פרטים על משרת שירות לקוחות בבאר שבע',
}

const JOB_KEYS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
const GROUP_ID = /^[A-Za-z0-9_-]{1,64}$/

export type GoRequest = {
  method?: string
  url?: string
  query?: unknown
  headers?: Record<string, string | string[] | undefined>
}

export type GoResponse = {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: () => void
}

/** GET/HEAD with a `go` query param (the /go/:jobId rewrite). Anything else stays on apply. */
export function isGoRedirect(req: GoRequest): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  return queryParam(req, 'go') !== null
}

export function parseJobId(raw: string | null): number | null {
  if (raw == null || !JOB_KEYS.has(raw)) return null
  return Number(raw)
}

/** Keep [A-Za-z0-9_-] up to 64 characters. Anything else is ignored. */
export function sanitizeGroupId(raw: string | null): string | null {
  if (raw == null || !GROUP_ID.test(raw)) return null
  return raw
}

export function whatsappLocation(jobId: number | null): string {
  if (jobId == null) return PLAIN_WA_URL
  const text = GO_JOB_TEXTS[jobId]
  if (!text) return PLAIN_WA_URL
  return `${PLAIN_WA_URL}?text=${encodeURIComponent(text)}`
}

export function shouldRecordGoClick(method: string | undefined, jobId: number | null): boolean {
  return method === 'GET' && jobId != null
}

export function queryParam(req: GoRequest, key: string): string | null {
  const query = req.query
  if (query && typeof query === 'object' && !Array.isArray(query) && Object.prototype.hasOwnProperty.call(query, key)) {
    return coerceQueryValue((query as Record<string, unknown>)[key])
  }
  const params = searchParams(req.url)
  if (!params.has(key)) return null
  return params.get(key) ?? ''
}

/**
 * One row per counted GET. Failures are logged and swallowed.
 * The caller awaits this before the redirect, capped at 800ms, so Vercel
 * does not freeze the isolate before the insert finishes.
 */
export async function recordGoClick(
  jobId: number,
  groupId: string | null,
  variant: string | null,
  isBot: boolean,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const pending = db()
      .from('go_clicks')
      .insert({ job_id: jobId, group_id: groupId, variant, is_bot: isBot })
      .then(({ error }) => {
        if (error) console.error('go click insert failed:', error.message)
      }, (err: unknown) => {
        console.error('go click insert failed:', err instanceof Error ? err.message : String(err))
      })
    await Promise.race([
      pending,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, INSERT_TIMEOUT_MS)
      }),
    ])
  } catch (err) {
    console.error('go click insert failed:', err instanceof Error ? err.message : String(err))
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export default async function handleGoRedirect(
  req: GoRequest,
  res: GoResponse,
  record: (jobId: number, groupId: string | null, variant: string | null, isBot: boolean) => Promise<void> = recordGoClick,
): Promise<void> {
  const jobId = parseJobId(queryParam(req, 'go'))
  const groupId = sanitizeGroupId(queryParam(req, 'g'))
  const variant = sanitizeVariant(queryParam(req, 'v'))
  if (jobId != null && shouldRecordGoClick(req.method, jobId)) {
    await record(jobId, groupId, variant, isBotUserAgent(headerValue(req, 'user-agent'), headerValue(req, 'accept-language')))
  }
  res.statusCode = 302
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Location', whatsappLocation(jobId))
  res.end()
}

function headerValue(req: GoRequest, name: string): string {
  const headers = req.headers
  if (!headers) return ''
  const found = Object.keys(headers).find(key => key.toLowerCase() === name)
  const raw = found ? headers[found] : undefined
  if (Array.isArray(raw)) return String(raw[0] ?? '')
  return typeof raw === 'string' ? raw : ''
}

function coerceQueryValue(raw: unknown): string {
  if (Array.isArray(raw)) return raw.length ? coerceQueryValue(raw[0]) : ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  return ''
}

function searchParams(url: string | undefined): URLSearchParams {
  if (!url) return new URLSearchParams()
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) return new URL(url).searchParams
  } catch {
    // Relative request URLs are parsed below.
  }
  const queryAt = url.indexOf('?')
  if (queryAt === -1) return new URLSearchParams()
  const hashAt = url.indexOf('#', queryAt)
  return new URLSearchParams(url.slice(queryAt + 1, hashAt === -1 ? undefined : hashAt))
}
