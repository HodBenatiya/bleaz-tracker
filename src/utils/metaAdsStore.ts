import { isViewer } from './accessMode'
import { supabase } from './supabase'
import { isMissingViewerRpc, readViewerPages, type ViewerFilter, type ViewerTable } from './viewerRead'
import { campaignIsLive } from './metaAds/live'
import type { SpendSlice, MapRow } from './metaAds/metrics'
import { historySpan } from './metaAds/range'
import { todayInIsrael } from './metaAds/zone'

export interface AdsAccountRow {
  accountId: string
  name: string
  currency: string
  timezone: string
  enabled: boolean
}

export interface AdsCampaignRow {
  accountId: string
  campaignId: string
  campaignName: string
  currency: string
  status: string
  delivering?: boolean | null
  activeAds?: number | null
  activeAdsets?: number | null
}

export interface CampaignChoice {
  accountId: string
  accountName: string
  campaignId: string
  campaignName: string
  status: string
  active: boolean
}

export interface AdsSyncLog {
  finishedAt: string
  ok: boolean
  message: string
}

export interface AdsBundle {
  spend: SpendSlice[]
  campaigns: AdsCampaignRow[]
  maps: MapRow[]
  accounts: AdsAccountRow[]
  usdToIls: number | null
  lastSync: AdsSyncLog | null
  todaySpend: SpendSlice[]
  historyNote?: string | null
}

type DbError = { code?: string; message?: string } | null

function missingTable(error: DbError): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache|could not find the table/i.test(error.message ?? '')
}

const INSTALL_HINT = 'טבלאות המודעות עדיין לא הותקנו. אחרי הרצת schema_meta_ads.sql והגדרת הסודות, הנתונים נכנסים לבד כל שעה.'

async function viewerTable(table: ViewerTable, filter: ViewerFilter = {}): Promise<Record<string, unknown>[] | null> {
  if (!isViewer()) return null
  try {
    return await readViewerPages<Record<string, unknown>>(table, filter)
  } catch (error) {
    if (isMissingViewerRpc(error as { code?: string; message?: string })) return null
    throw error
  }
}

async function page<T>(load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await load(from, from + 999)
    if (missingTable(error)) throw new Error(INSTALL_HINT)
    if (error) throw new Error(error.message || 'load failed')
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

const HISTORY_NOTE = 'ההוצאה לימים הקודמים עדיין לא נשמרה. אחרי עדכון סנכרון מטא היא תיטען לטווח שנבחר.'
const COVERAGE_KEY = 'meta_daily_coverage_v1'
const COVERAGE_MS = 6 * 60 * 60 * 1000
const FAIL_MS = 2 * 60 * 1000

function browserStorage(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    return sessionStorage
  } catch {
    return null
  }
}

interface Coverage { since: string; until: string; at: number }

function readCoverage(): Coverage[] {
  const storage = browserStorage()
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(COVERAGE_KEY) || '[]') as Coverage[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function spanCovered(since: string, until: string): boolean {
  const now = Date.now()
  return readCoverage().some(row => now - row.at < COVERAGE_MS && row.since <= since && row.until >= until)
}

function rememberCoverage(since: string, until: string) {
  const storage = browserStorage()
  if (!storage) return
  const rows = readCoverage().filter(row => Date.now() - row.at < COVERAGE_MS)
  rows.push({ since, until, at: Date.now() })
  storage.setItem(COVERAGE_KEY, JSON.stringify(rows.slice(-12)))
}

function recentlyFailed(since: string, until: string): boolean {
  const storage = browserStorage()
  if (!storage) return false
  const at = Number(storage.getItem(`meta_daily_fail:${since}:${until}`) || 0)
  return at > 0 && Date.now() - at < FAIL_MS
}

function rememberFailure(since: string, until: string) {
  browserStorage()?.setItem(`meta_daily_fail:${since}:${until}`, String(Date.now()))
}

/** Ask the existing Meta sync to cache daily insights for days before today. */
export async function ensureDailySpend(start: string, end: string): Promise<string | null> {
  const span = historySpan(start, end, todayInIsrael())
  if (!span) return null
  if (spanCovered(span.since, span.until)) return null
  if (recentlyFailed(span.since, span.until)) return HISTORY_NOTE
  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    const base = import.meta.env.VITE_SUPABASE_URL as string
    if (!token || !base) {
      rememberFailure(span.since, span.until)
      return HISTORY_NOTE
    }
    const response = await fetch(`${base}/functions/v1/meta-ads-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({ mode: 'range', since: span.since, until: span.until }),
      signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) {
      rememberFailure(span.since, span.until)
      return HISTORY_NOTE
    }
    rememberCoverage(span.since, span.until)
    return null
  } catch {
    rememberFailure(span.since, span.until)
    return HISTORY_NOTE
  }
}

export async function loadAdsBundle(start: string, end: string): Promise<AdsBundle> {
  const historyNote = await ensureDailySpend(start, end)
  const israelToday = todayInIsrael()
  try {
    const viewerDaily = await viewerTable('meta_campaign_daily', { insight_date_gte: start, insight_date_lte: end })
    const viewerToday = viewerDaily && await viewerTable('meta_campaign_today', { snapshot_date: israelToday })
    const viewerCampaigns = viewerToday && await viewerTable('meta_campaigns')
    const viewerMaps = viewerCampaigns && await viewerTable('meta_campaign_positions')
    const viewerAccounts = viewerMaps && await viewerTable('meta_ad_accounts')
    const viewerSettings = viewerAccounts && await viewerTable('meta_ads_settings')
    const [daily, todayRows, campaignRows, mapRows, accountRows, settings, syncRows] = viewerSettings
      ? [
          viewerDaily,
          viewerToday,
          viewerCampaigns,
          viewerMaps,
          viewerAccounts,
          { data: viewerSettings[0] ?? null, error: null as DbError },
          { data: [] as { finished_at?: string; ok?: boolean; message?: string }[], error: null as DbError },
        ] as const
      : await Promise.all([
      page<Record<string, unknown>>((from, to) =>
        supabase.from('meta_campaign_daily')
          .select('account_id,campaign_id,campaign_name,insight_date,spend,currency,results')
          .gte('insight_date', start)
          .lte('insight_date', end)
          .range(from, to)),
      page<Record<string, unknown>>((from, to) =>
        supabase.from('meta_campaign_today')
          .select('account_id,campaign_id,campaign_name,snapshot_date,spend,currency,results')
          .eq('snapshot_date', israelToday)
          .range(from, to)),
      loadCampaignRows(),
      page<Record<string, unknown>>((from, to) =>
        supabase.from('meta_campaign_positions')
          .select('account_id,campaign_id,position_id')
          .range(from, to)),
      page<Record<string, unknown>>((from, to) =>
        supabase.from('meta_ad_accounts')
          .select('account_id,name,currency,timezone,enabled')
          .range(from, to)),
      supabase.from('meta_ads_settings').select('usd_to_ils').eq('id', 'default').maybeSingle(),
      supabase.from('meta_sync_log').select('finished_at,ok,message').order('id', { ascending: false }).limit(1),
    ])
    for (const result of [settings, syncRows]) {
      if (missingTable(result.error)) throw new Error(INSTALL_HINT)
      if (result.error) throw new Error(result.error.message)
    }

    const spend: SpendSlice[] = []
    const seenCampaigns = new Map<string, AdsCampaignRow>()
    const pushCampaign = (accountId: string, campaignId: string, name: string, currency: string, extra?: Partial<AdsCampaignRow>) => {
      const key = `${accountId}::${campaignId}`
      const prev = seenCampaigns.get(key)
      seenCampaigns.set(key, {
        accountId,
        campaignId,
        campaignName: name || prev?.campaignName || campaignId,
        currency: currency || prev?.currency || '',
        status: extra?.status || prev?.status || '',
        delivering: extra?.delivering !== undefined ? extra.delivering : prev?.delivering,
        activeAds: extra?.activeAds !== undefined ? extra.activeAds : prev?.activeAds,
        activeAdsets: extra?.activeAdsets !== undefined ? extra.activeAdsets : prev?.activeAdsets,
      })
    }
    for (const row of campaignRows) {
      const delivering = row.delivering
      pushCampaign(String(row.account_id), String(row.campaign_id), String(row.campaign_name ?? ''), String(row.currency ?? ''), {
        status: String(row.effective_status ?? ''),
        delivering: typeof delivering === 'boolean' ? delivering : null,
        activeAds: row.active_ads == null ? null : Number(row.active_ads),
        activeAdsets: row.active_adsets == null ? null : Number(row.active_adsets),
      })
    }
    const addSpend = (row: Record<string, unknown>, dateKey: string) => {
      const date = String(row[dateKey] ?? '').slice(0, 10)
      if (!date || date < start || date > end) return
      if (dateKey === 'insight_date' && date === israelToday) return
      const accountId = String(row.account_id)
      const campaignId = String(row.campaign_id)
      const campaignName = String(row.campaign_name ?? '')
      const currency = String(row.currency ?? '')
      pushCampaign(accountId, campaignId, campaignName, currency)
      spend.push({
        accountId,
        campaignId,
        date,
        spend: Number(row.spend ?? 0) || 0,
        currency,
        results: Number(row.results ?? 0) || 0,
      })
    }
    for (const row of daily) addSpend(row, 'insight_date')
    for (const row of todayRows) addSpend(row, 'snapshot_date')

    const todaySpend: SpendSlice[] = todayRows.map(row => ({
      accountId: String(row.account_id),
      campaignId: String(row.campaign_id),
      date: String(row.snapshot_date ?? israelToday).slice(0, 10),
      spend: Number(row.spend ?? 0) || 0,
      currency: String(row.currency ?? ''),
      results: Number(row.results ?? 0) || 0,
    }))
    const rate = settings.data?.usd_to_ils
    const last = syncRows.data?.[0]
    return {
      spend,
      campaigns: [...seenCampaigns.values()].sort((a, b) => a.campaignName.localeCompare(b.campaignName, 'he')),
      maps: mapRows.map(row => ({
        accountId: String(row.account_id),
        campaignId: String(row.campaign_id),
        positionId: String(row.position_id),
      })),
      accounts: accountRows.map(row => ({
        accountId: String(row.account_id),
        name: String(row.name ?? ''),
        currency: String(row.currency ?? ''),
        timezone: String(row.timezone ?? ''),
        enabled: row.enabled !== false,
      })),
      usdToIls: rate == null || rate === '' ? null : Number(rate),
      lastSync: last ? {
        finishedAt: String(last.finished_at ?? ''),
        ok: !!last.ok,
        message: String(last.message ?? ''),
      } : null,
      todaySpend,
      historyNote,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'לא הצלחנו לטעון את נתוני המודעות'
    if (missingTable(error as DbError) || message === INSTALL_HINT) throw new Error(INSTALL_HINT)
    throw new Error(message)
  }
}

async function loadCampaignRows(): Promise<Record<string, unknown>[]> {
  const paged = await viewerTable('meta_campaigns')
  if (paged) return paged
  try {
    return await page((from, to) =>
      supabase.from('meta_campaigns')
        .select('account_id,campaign_id,campaign_name,currency,effective_status,delivering,active_ads,active_adsets')
        .range(from, to))
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (!/delivering|active_ads|active_adsets|schema cache|column/i.test(message)) throw error
    return await page((from, to) =>
      supabase.from('meta_campaigns')
        .select('account_id,campaign_id,campaign_name,currency,effective_status')
        .range(from, to))
  }
}

export async function loadCampaignPositionMaps(): Promise<{ accountId: string; campaignId: string; positionId: string }[]> {
  const paged = await viewerTable('meta_campaign_positions')
  const data = paged ?? (await (async () => {
    const loaded = await supabase.from('meta_campaign_positions').select('account_id,campaign_id,position_id').limit(2000)
    if (loaded.error || !loaded.data) return [] as Record<string, unknown>[]
    return loaded.data as Record<string, unknown>[]
  })())
  return data.map(row => ({
    accountId: String(row.account_id),
    campaignId: String(row.campaign_id),
    positionId: String(row.position_id),
  }))
}

export async function loadCampaignChoices(): Promise<CampaignChoice[]> {
  const pagedAccounts = await viewerTable('meta_ad_accounts')
  const accounts = pagedAccounts
    ? { data: pagedAccounts, error: null as DbError }
    : await supabase.from('meta_ad_accounts').select('account_id,name').limit(50)
  let campaigns: Record<string, unknown>[]
  try {
    campaigns = await loadCampaignRows()
  } catch {
    return []
  }
  if (accounts.error) return []
  const names = new Map((accounts.data ?? []).map(row => [String(row.account_id), String(row.name ?? '')]))
  return campaigns.map(row => {
    const status = String(row.effective_status ?? '')
    const delivering = typeof row.delivering === 'boolean' ? row.delivering : null
    return {
      accountId: String(row.account_id),
      accountName: names.get(String(row.account_id)) || String(row.account_id),
      campaignId: String(row.campaign_id),
      campaignName: String(row.campaign_name ?? ''),
      status,
      active: campaignIsLive(status, delivering),
    }
  }).sort((a, b) => Number(b.active) - Number(a.active) || a.campaignName.localeCompare(b.campaignName, 'he'))
}

export async function loadKnownAds(): Promise<{ accountId: string; adId: string; adsetId: string; campaignId: string; campaignName: string }[]> {
  const paged = await viewerTable('meta_ads')
  const loaded = paged ? { data: paged, error: null as DbError } : await supabase.from('meta_ads').select('account_id,ad_id,adset_id,campaign_id,name').limit(2000)
  if (loaded.error || !loaded.data) return []
  return loaded.data.map(row => ({
    accountId: String(row.account_id),
    adId: String(row.ad_id),
    adsetId: String(row.adset_id ?? ''),
    campaignId: String(row.campaign_id ?? ''),
    campaignName: String(row.name ?? ''),
  }))
}

export interface PlacementSpend {
  platform: string
  position: string
  spend: number
  currency: string
  leads: number
}

export async function loadPlacementSpend(start: string, end: string): Promise<PlacementSpend[] | null> {
  let data: { publisher_platform?: unknown; platform_position?: unknown; spend?: unknown; currency?: unknown; leads?: unknown }[] | null = null
  const paged = await viewerTable('meta_ad_placement_insights_daily', { insight_date_gte: start, insight_date_lte: end })
  if (paged) {
    data = paged
  } else {
    const loaded = await supabase.from('meta_ad_placement_insights_daily')
      .select('publisher_platform,platform_position,spend,currency,leads,insight_date')
      .gte('insight_date', start)
      .lte('insight_date', end)
      .limit(5000)
    if (loaded.error) return null
    data = loaded.data
  }
  const grouped = new Map<string, PlacementSpend>()
  for (const row of data ?? []) {
    const platform = String(row.publisher_platform ?? '')
    const position = String(row.platform_position ?? '')
    const currency = String(row.currency ?? '')
    const key = `${platform}|${position}|${currency}`
    const current = grouped.get(key) ?? { platform, position, currency, spend: 0, leads: 0 }
    current.spend += Number(row.spend ?? 0) || 0
    current.leads += Number(row.leads ?? 0) || 0
    grouped.set(key, current)
  }
  return [...grouped.values()].sort((a, b) => b.spend - a.spend)
}

export async function loadCampaignNames(): Promise<string[]> {
  const paged = await viewerTable('meta_campaigns')
  const data = paged ?? (await (async () => {
    const loaded = await supabase.from('meta_campaigns').select('campaign_name').limit(500)
    if (loaded.error || !loaded.data) return [] as { campaign_name?: unknown }[]
    return loaded.data
  })())
  return [...new Set(data.map(row => String(row.campaign_name ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'))
}

export async function saveUsdToIls(rate: number | null): Promise<string | null> {
  if (isViewer()) return 'צפייה בלבד — אין הרשאת עריכה'
  const { error } = await supabase.from('meta_ads_settings').update({
    usd_to_ils: rate,
    updated_at: new Date().toISOString(),
  }).eq('id', 'default')
  return error ? error.message : null
}

export async function mapCampaignPosition(accountId: string, campaignId: string, positionId: string): Promise<string | null> {
  if (isViewer()) return 'צפייה בלבד — אין הרשאת עריכה'
  const { error } = await supabase.from('meta_campaign_positions').upsert({
    account_id: accountId,
    campaign_id: campaignId,
    position_id: positionId,
  })
  return error ? error.message : null
}

export async function unmapCampaignPosition(accountId: string, campaignId: string, positionId: string): Promise<string | null> {
  if (isViewer()) return 'צפייה בלבד — אין הרשאת עריכה'
  const { error } = await supabase.from('meta_campaign_positions').delete()
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .eq('position_id', positionId)
  return error ? error.message : null
}
