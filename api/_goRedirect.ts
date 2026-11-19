import { db } from './_db.js'
import { sanitizeVariant, withJobNameLine } from '../src/utils/organicJobs.js'

/** Public WhatsApp number for /go links. Do not add any other number here. */
export const WA_PHONE = '972559817733'
export const PLAIN_WA_URL = `https://wa.me/${WA_PHONE}`

const INSERT_TIMEOUT_MS = 800

/**
 * Prefill texts for /go/1 .. /go/10. These are the only message bodies.
 * They are not loaded from jobs, candidates, or any other record.
 */
export const GO_JOB_TEXTS: Record<number, string> = {
  1: 'היי, ראיתי בפייסבוק את משרת קשרי הלקוחות בבית ההשקעות ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nידע/ניסיון בשוק ההון:',
  2: 'היי, ראיתי בפייסבוק את משרת שירות הלקוחות בחברת הביטוח ברמת החייל ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון בשירות לקוחות:',
  3: 'היי, ראיתי בפייסבוק את משרת השירות במוקד המעסיקים בפתח תקווה ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון בשירות לקוחות:',
  4: 'היי, ראיתי בפייסבוק את משרת המכירות במוקד הפיננסי בגבעת שאול ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון במכירות טלפוניות (כמה זמן ואיפה):',
  5: 'היי, ראיתי בפייסבוק את משרת תומך/ת המסחר בשוק ההון ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון בשירות לקוחות / ידע בשוק ההון:',
  6: 'היי, ראיתי בפייסבוק את משרת מנהל/ת החשבונות מהבית ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nשנות ניסיון במשרד רו״ח (עד מאזן?):',
  7: 'היי, ראיתי בפייסבוק את משרת יועץ/ת ההשקעות ג׳וניור בבנק בתל אביב ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nרישיון ייעוץ השקעות + התמחות (מתי הושלמה):',
  8: 'היי, ראיתי בפייסבוק את משרת המכירות במכללה ברמת גן ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון במכירות (אם יש):',
  9: 'היי, ראיתי בפייסבוק את משרת שימור הלקוחות בפתח תקווה ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון במכירות או שירות (אם יש):',
  10: 'היי, ראיתי בפייסבוק את משרת השירות במוקד המעסיקים בבאר שבע ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון בשירות לקוחות:',
}

const JOB_KEYS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
const GROUP_ID = /^[A-Za-z0-9_-]{1,64}$/

export type GoRequest = {
  method?: string
  url?: string
  query?: unknown
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
  return `${PLAIN_WA_URL}?text=${encodeURIComponent(withJobNameLine(jobId, text))}`
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
 * One row per counted GET. Failures (missing table, network, bad env) are logged
 * and swallowed so the redirect already sent still stands.
 */
export async function recordGoClick(jobId: number, groupId: string | null, variant: string | null): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const pending = db()
      .from('go_clicks')
      .insert({ job_id: jobId, group_id: groupId, variant })
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
  record: (jobId: number, groupId: string | null, variant: string | null) => Promise<void> = recordGoClick,
): Promise<void> {
  const jobId = parseJobId(queryParam(req, 'go'))
  const groupId = sanitizeGroupId(queryParam(req, 'g'))
  const variant = sanitizeVariant(queryParam(req, 'v'))
  res.statusCode = 302
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Location', whatsappLocation(jobId))
  res.end()
  if (jobId != null && shouldRecordGoClick(req.method, jobId)) await record(jobId, groupId, variant)
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
