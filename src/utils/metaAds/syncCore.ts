import { addDaysISO, israelDateForAccountHour, parseHourLabel } from './zone.ts'

export const META_GRAPH_VERSION = 'v19.0'
export const HISTORY_FLOOR_DAYS = 90

const GRAPH_HOST = 'graph.facebook.com'
const READ_PATH = /^\/v\d+\.\d+\/act_\d+\/(insights|campaigns|ads|adsets)\/?$/

/** The sync may only read insights, campaigns, ad sets, and ads. */
export function assertMetaRead(url: string, method: string): void {
  if (String(method || '').toUpperCase() !== 'GET') {
    throw new Error('Meta ads sync is read-only')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Meta URL is invalid')
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== GRAPH_HOST) {
    throw new Error('Meta host is not allowed')
  }
  if (!READ_PATH.test(parsed.pathname)) {
    throw new Error('Only campaign insights reads are allowed')
  }
}

export function stripSecrets(text: string): string {
  return String(text || '')
    .replace(/access_token=[^&\s]+/gi, 'access_token=redacted')
    .replace(/EAA[A-Za-z0-9]+/g, 'redacted')
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function normalizeAccountId(id: string): string {
  const digits = String(id || '').trim().replace(/^act_/, '')
  if (!/^\d+$/.test(digits)) throw new Error('Ad account id is invalid')
  return `act_${digits}`
}

export function isTokenEnvName(name: string): boolean {
  return /^META_TOKEN_[A-Z0-9_]+$/.test(name)
}

export interface MetaAction {
  action_type?: string
  value?: string
}

export interface MetaInsightRow {
  campaign_id?: string
  campaign_name?: string
  spend?: string
  impressions?: string
  clicks?: string
  account_currency?: string
  date_start?: string
  hourly_stats_aggregated_by_advertiser_time_zone?: string
  actions?: MetaAction[]
}

export interface ParsedHour {
  campaignId: string
  campaignName: string
  currency: string
  accountDate: string
  hour: number | null
  spend: number
  impressions: number
  clicks: number
  results: number
  resultAction: string
}

/** Click-to-WhatsApp first, then lead actions. The first one present wins for that row. */
export const RESULT_ACTIONS = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_first_reply',
  'onsite_conversion.total_messaging_connection',
  'messaging_conversation_started_7d',
  'contact_total',
  'lead',
  'onsite_conversion.lead_grouped',
  'omni_lead',
]

export function pickResult(actions: MetaAction[] | undefined): { action: string; value: number } {
  const list = actions ?? []
  for (const action of RESULT_ACTIONS) {
    const found = list.find(item => item?.action_type === action)
    if (!found) continue
    const value = Number(found.value ?? 0)
    if (value > 0) return { action, value }
  }
  return { action: '', value: 0 }
}

export function parseInsightRow(row: MetaInsightRow, fallbackCurrency: string): ParsedHour | null {
  const campaignId = String(row.campaign_id ?? '').trim()
  const accountDate = String(row.date_start ?? '').slice(0, 10)
  if (!campaignId || !/^\d{4}-\d{2}-\d{2}$/.test(accountDate)) return null
  const result = pickResult(row.actions)
  const currency = String(row.account_currency || fallbackCurrency || '').toUpperCase()
  return {
    campaignId,
    campaignName: String(row.campaign_name ?? '').trim() || campaignId,
    currency,
    accountDate,
    hour: parseHourLabel(row.hourly_stats_aggregated_by_advertiser_time_zone),
    spend: Number(row.spend ?? 0) || 0,
    impressions: Number(row.impressions ?? 0) || 0,
    clicks: Number(row.clicks ?? 0) || 0,
    results: result.value,
    resultAction: result.action,
  }
}

export interface IsraelSlice {
  campaignId: string
  campaignName: string
  currency: string
  date: string
  spend: number
  impressions: number
  clicks: number
  results: number
  resultAction: string
}

export function bucketToIsraelDays(rows: ParsedHour[], accountTimeZone: string): IsraelSlice[] {
  const grouped = new Map<string, IsraelSlice>()
  for (const row of rows) {
    if (row.hour == null) continue
    const date = israelDateForAccountHour(row.accountDate, row.hour, accountTimeZone)
    const key = `${row.campaignId}|${date}`
    const current = grouped.get(key) ?? {
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      currency: row.currency,
      date,
      spend: 0,
      impressions: 0,
      clicks: 0,
      results: 0,
      resultAction: row.resultAction,
    }
    current.campaignName = row.campaignName || current.campaignName
    current.currency = row.currency || current.currency
    current.spend += row.spend
    current.impressions += row.impressions
    current.clicks += row.clicks
    current.results += row.results
    if (!current.resultAction && row.resultAction) current.resultAction = row.resultAction
    grouped.set(key, current)
  }
  return [...grouped.values()]
}

export interface DateSpan {
  start: string
  end: string
}

/**
 * Each run refreshes the recent Israel days, and walks backward up to 90 days
 * in week-sized steps so one hourly call stays small.
 */
export function planFetchSpans(today: string, backfillDays: number, oldest: string | null, floorDays = HISTORY_FLOOR_DAYS): { spans: DateSpan[]; nextOldest: string } {
  const requested = Math.min(Math.max(Math.floor(backfillDays) || 1, 1), 21)
  const recentStart = addDaysISO(today, -(requested - 1))
  const floor = addDaysISO(today, -floorDays)
  const spans: DateSpan[] = [{ start: recentStart, end: today }]
  const cursor = oldest && oldest < recentStart ? oldest : recentStart
  let nextOldest = cursor
  if (cursor > floor) {
    let catchupStart = addDaysISO(cursor, -7)
    if (catchupStart < floor) catchupStart = floor
    const catchupEnd = addDaysISO(cursor, -1)
    if (catchupStart <= catchupEnd) spans.push({ start: catchupStart, end: catchupEnd })
    nextOldest = catchupStart
  }
  return { spans, nextOldest }
}

/** Account-timezone dates that can contain hours falling on the Israel spans, plus one day of padding. */
export function accountDatesForSpans(spans: DateSpan[]): string[] {
  const dates = new Set<string>()
  for (const span of spans) {
    let cursor = addDaysISO(span.start, -1)
    const end = addDaysISO(span.end, 1)
    while (cursor <= end) {
      dates.add(cursor)
      cursor = addDaysISO(cursor, 1)
    }
  }
  return [...dates].sort()
}

export function dateInSpans(date: string, spans: DateSpan[]): boolean {
  return spans.some(span => date >= span.start && date <= span.end)
}

export interface AccountConfig {
  accountId: string
  name: string
  currency: string
  timezone: string
  tokenEnv: string
  enabled: boolean
}

export function mergeAccountConfigs(tableRows: AccountConfig[], extras: AccountConfig[]): AccountConfig[] {
  const byId = new Map<string, AccountConfig>()
  for (const extra of extras) {
    if (!extra.enabled) continue
    byId.set(extra.accountId, extra)
  }
  for (const row of tableRows) {
    if (!row.enabled) {
      byId.delete(row.accountId)
      continue
    }
    const prev = byId.get(row.accountId)
    byId.set(row.accountId, {
      accountId: row.accountId,
      name: row.name || prev?.name || row.accountId,
      currency: row.currency || prev?.currency || 'USD',
      timezone: row.timezone || prev?.timezone || 'Asia/Jerusalem',
      tokenEnv: row.tokenEnv || prev?.tokenEnv || '',
      enabled: true,
    })
  }
  return [...byId.values()]
}
