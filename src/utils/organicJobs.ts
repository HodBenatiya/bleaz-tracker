/** Descriptive names for organic Facebook jobs. Add new jobs only here. */
export const ORGANIC_JOB_NAMES: Record<number, string> = {
  2: 'שירות לקוחות רמת החייל',
  9: 'שימור לקוחות פתח תקווה',
  10: 'שירות לקוחות באר שבע',
}

export const ORGANIC_SOURCE = 'organic_fb'

/**
 * Passed screening, sent to the client, interviewed, or hired.
 * The owner can correct this list.
 */
export const ORGANIC_RELEVANT_STATUSES = [
  'relevant',
  'future_relevant',
  'sent_to_client',
  'interview_scheduled',
  'started_working',
  'placement_complete',
] as const

/** Rejected or not suitable. */
export const ORGANIC_NOT_RELEVANT_STATUSES = ['irrelevant'] as const

const PLACEHOLDER_SOURCES = new Set(['', 'whatsapp'])
const VARIANTS = new Set(['A', 'B', 'C', 'D'])

export function organicJobName(jobId: number | null | undefined): string | null {
  if (jobId == null) return null
  return ORGANIC_JOB_NAMES[jobId] ?? null
}

/** First line `משרה: <name>` before the existing prefill. Jobs without a name stay as they are. */
export function withJobNameLine(jobId: number, text: string): string {
  const name = organicJobName(jobId)
  if (!name) return text
  return `משרה: ${name}\n${text}`
}

/** `?v=` is kept only for a single letter A, B, C, or D. */
export function sanitizeVariant(raw: string | null): 'A' | 'B' | 'C' | 'D' | null {
  if (raw == null || !VARIANTS.has(raw)) return null
  return raw as 'A' | 'B' | 'C' | 'D'
}

export function normalizeOrganicText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function namePattern(name: string): RegExp {
  const words = normalizeOrganicText(name).split(' ').filter(Boolean)
  const body = words.map(word => `ו?ב?${escapeRegExp(word)}`).join('\\s+')
  return new RegExp(body, 'u')
}

/** First inbound message only. Optional ו/ב before a name word still matches. */
export function matchOrganicJob(text: string | null | undefined): number | null {
  const normalized = normalizeOrganicText(text ?? '')
  if (!normalized) return null
  const entries = Object.entries(ORGANIC_JOB_NAMES)
    .map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => b.name.length - a.name.length)
  for (const entry of entries) {
    if (namePattern(entry.name).test(normalized)) return entry.id
  }
  return null
}

export function firstInboundText(
  messages: Array<{ direction?: string; text?: string; timestamp?: string }> | null | undefined,
): string {
  const inbound = (messages ?? []).filter(message => message?.direction === 'in')
  if (!inbound.length) return ''
  const timed = inbound.filter(message => message.timestamp)
  if (timed.length) {
    timed.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    return String(timed[0].text ?? '')
  }
  return String(inbound[0].text ?? '')
}

/**
 * Tag a lead that is being created now. A non-empty source other than the
 * WhatsApp placeholder is left alone, and the job is not attached either.
 */
export function tagNewOrganicLead<T extends { source?: string; organicJob?: number }>(
  lead: T,
  messages: Array<{ direction?: string; text?: string; timestamp?: string }> | null | undefined,
): T {
  const source = String(lead.source ?? '').trim()
  if (source && !PLACEHOLDER_SOURCES.has(source.toLowerCase())) return lead
  const jobId = matchOrganicJob(firstInboundText(messages))
  if (jobId == null) return lead
  return { ...lead, source: ORGANIC_SOURCE, organicJob: jobId }
}

export type OrganicRelevance = 'relevant' | 'not_relevant' | 'pending'

export function organicRelevance(status: string | undefined): OrganicRelevance {
  if (status && (ORGANIC_RELEVANT_STATUSES as readonly string[]).includes(status)) return 'relevant'
  if (status && (ORGANIC_NOT_RELEVANT_STATUSES as readonly string[]).includes(status)) return 'not_relevant'
  return 'pending'
}

export function jerusalemDay(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function recentJerusalemDays(count: number, now = new Date()): string[] {
  const today = jerusalemDay(now)
  const [year, month, day] = today.split('-').map(Number)
  const days: string[] = []
  for (let offset = 0; offset < count; offset += 1) {
    days.push(jerusalemDay(new Date(Date.UTC(year, month - 1, day - offset, 12))))
  }
  return days
}

export interface OrganicDayJob {
  day: string
  jobId: number | null
  leads: number
  relevant: number
  notRelevant: number
  pending: number
}

export function summarizeOrganicLeads(
  candidates: Array<{ source?: string; status?: string; organicJob?: number | null; createdAt?: string }>,
  now = new Date(),
): OrganicDayJob[] {
  const days = new Set(recentJerusalemDays(14, now))
  const grouped = new Map<string, OrganicDayJob>()
  for (const candidate of candidates) {
    if (candidate.source !== ORGANIC_SOURCE) continue
    const day = candidate.createdAt ? jerusalemDay(candidate.createdAt) : ''
    if (!day || !days.has(day)) continue
    const jobId = typeof candidate.organicJob === 'number' ? candidate.organicJob : null
    const key = `${day}:${jobId ?? ''}`
    const row = grouped.get(key) ?? { day, jobId, leads: 0, relevant: 0, notRelevant: 0, pending: 0 }
    row.leads += 1
    const bucket = organicRelevance(candidate.status)
    if (bucket === 'relevant') row.relevant += 1
    else if (bucket === 'not_relevant') row.notRelevant += 1
    else row.pending += 1
    grouped.set(key, row)
  }
  return [...grouped.values()].sort((a, b) => (
    b.day.localeCompare(a.day) || (a.jobId ?? 99) - (b.jobId ?? 99)
  ))
}
