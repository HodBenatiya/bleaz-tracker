import { supabase } from './supabase'
import { campaignIsLive } from './metaAds/live'
import type { SpendSlice, MapRow } from './metaAds/metrics'
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
}

type DbError = { code?: string; message?: string } | null

function missingTable(error: DbError): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache|could not find the table/i.test(error.message ?? '')
}

const INSTALL_HINT = 'טבלאות המודעות עדיין לא הותקנו. אחרי הרצת schema_meta_ads.sql והגדרת הסודות, הנתונים נכנסים לבד כל שעה.'

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

export async function loadAdsBundle(start: string, end: string): Promise<AdsBundle> {
  const israelToday = todayInIsrael()
  try {
    const [daily, todayRows, campaignRows, mapRows, accountRows, settings, syncRows] = await Promise.all([
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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'לא הצלחנו לטעון את נתוני המודעות'
    if (missingTable(error as DbError) || message === INSTALL_HINT) throw new Error(INSTALL_HINT)
    throw new Error(message)
  }
}

async function loadCampaignRows(): Promise<Record<string, unknown>[]> {
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
  const { data, error } = await supabase.from('meta_campaign_positions').select('account_id,campaign_id,position_id').limit(2000)
  if (error || !data) return []
  return data.map(row => ({
    accountId: String(row.account_id),
    campaignId: String(row.campaign_id),
    positionId: String(row.position_id),
  }))
}

export async function loadCampaignChoices(): Promise<CampaignChoice[]> {
  const accounts = await supabase.from('meta_ad_accounts').select('account_id,name').limit(50)
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

export async function loadCampaignNames(): Promise<string[]> {
  const { data, error } = await supabase.from('meta_campaigns').select('campaign_name').limit(500)
  if (error || !data) return []
  return [...new Set(data.map(row => String(row.campaign_name ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'))
}

export async function saveUsdToIls(rate: number | null): Promise<string | null> {
  const { error } = await supabase.from('meta_ads_settings').update({
    usd_to_ils: rate,
    updated_at: new Date().toISOString(),
  }).eq('id', 'default')
  return error ? error.message : null
}

export async function mapCampaignPosition(accountId: string, campaignId: string, positionId: string): Promise<string | null> {
  const { error } = await supabase.from('meta_campaign_positions').upsert({
    account_id: accountId,
    campaign_id: campaignId,
    position_id: positionId,
  })
  return error ? error.message : null
}

export async function unmapCampaignPosition(accountId: string, campaignId: string, positionId: string): Promise<string | null> {
  const { error } = await supabase.from('meta_campaign_positions').delete()
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .eq('position_id', positionId)
  return error ? error.message : null
}
