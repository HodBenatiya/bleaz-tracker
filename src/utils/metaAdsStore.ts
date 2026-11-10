import { supabase } from './supabase'
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
  const includeToday = start <= israelToday && end >= israelToday
  try {
    const [daily, todayRows, campaignRows, mapRows, accountRows, settings, syncRows] = await Promise.all([
      page<Record<string, unknown>>((from, to) =>
        supabase.from('meta_campaign_daily')
          .select('account_id,campaign_id,campaign_name,insight_date,spend,currency')
          .gte('insight_date', start)
          .lte('insight_date', end)
          .range(from, to)),
      includeToday
        ? page<Record<string, unknown>>((from, to) =>
          supabase.from('meta_campaign_today')
            .select('account_id,campaign_id,campaign_name,snapshot_date,spend,currency')
            .eq('snapshot_date', israelToday)
            .range(from, to))
        : Promise.resolve([]),
      page<Record<string, unknown>>((from, to) =>
        supabase.from('meta_campaigns')
          .select('account_id,campaign_id,campaign_name,currency,effective_status')
          .range(from, to)),
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
    const pushCampaign = (accountId: string, campaignId: string, name: string, currency: string, status = '') => {
      const key = `${accountId}::${campaignId}`
      const prev = seenCampaigns.get(key)
      if (!prev || (name && name !== campaignId)) {
        seenCampaigns.set(key, {
          accountId,
          campaignId,
          campaignName: name || prev?.campaignName || campaignId,
          currency: currency || prev?.currency || '',
          status: status || prev?.status || '',
        })
      }
    }
    for (const row of campaignRows) {
      pushCampaign(String(row.account_id), String(row.campaign_id), String(row.campaign_name ?? ''), String(row.currency ?? ''), String(row.effective_status ?? ''))
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
      })
    }
    for (const row of daily) addSpend(row, 'insight_date')
    for (const row of todayRows) addSpend(row, 'snapshot_date')

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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'לא הצלחנו לטעון את נתוני המודעות'
    if (missingTable(error as DbError) || message === INSTALL_HINT) throw new Error(INSTALL_HINT)
    throw new Error(message)
  }
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
