import { pickResult, type MetaAction } from './syncCore.ts'

/**
 * Lead count on an insights row. Same rule as campaign sync: the first action
 * in this order that has a positive value, not a sum of them.
 * 1. onsite_conversion.messaging_conversation_started_7d
 * 2. onsite_conversion.messaging_first_reply
 * 3. onsite_conversion.total_messaging_connection
 * 4. messaging_conversation_started_7d
 * 5. contact_total
 * 6. lead
 * 7. onsite_conversion.lead_grouped
 * 8. omni_lead
 */
export function insightLeads(actions: MetaAction[] | undefined): { leads: number; action: string } {
  const picked = pickResult(actions)
  return { leads: picked.value, action: picked.action }
}

export interface AdMetricInput {
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  ad_id?: string
  ad_name?: string
  date_start?: string
  spend?: string
  impressions?: string
  reach?: string
  frequency?: string
  clicks?: string
  inline_link_clicks?: string
  ctr?: string
  cpm?: string
  cpc?: string
  actions?: MetaAction[]
  publisher_platform?: string
  platform_position?: string
  region?: string
  account_currency?: string
}

export interface AdMetricRow {
  date: string
  campaignId: string
  campaignName: string
  adsetId: string
  adsetName: string
  adId: string
  adName: string
  currency: string
  spend: number
  impressions: number
  reach: number
  frequency: number | null
  clicks: number
  inlineLinkClicks: number
  ctr: number | null
  cpm: number | null
  cpc: number | null
  leads: number
  leadAction: string
  costPerLead: number | null
  publisherPlatform: string
  platformPosition: string
  region: string
}

function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function optionalRate(value: unknown, fallback: number | null): number | null {
  if (value == null || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function parseAdMetric(row: AdMetricInput, fallbackCurrency = ''): AdMetricRow | null {
  const date = String(row.date_start ?? '').slice(0, 10)
  const campaignId = String(row.campaign_id ?? '').trim()
  if (!campaignId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const spend = num(row.spend)
  const impressions = num(row.impressions)
  const reach = num(row.reach)
  const clicks = num(row.clicks)
  const leads = insightLeads(row.actions)
  const ctr = optionalRate(row.ctr, impressions > 0 ? (clicks / impressions) * 100 : null)
  const cpm = optionalRate(row.cpm, impressions > 0 ? (spend / impressions) * 1000 : null)
  const cpc = optionalRate(row.cpc, clicks > 0 ? spend / clicks : null)
  const frequency = optionalRate(row.frequency, reach > 0 ? impressions / reach : null)
  return {
    date,
    campaignId,
    campaignName: String(row.campaign_name ?? '').trim(),
    adsetId: String(row.adset_id ?? '').trim(),
    adsetName: String(row.adset_name ?? '').trim(),
    adId: String(row.ad_id ?? '').trim(),
    adName: String(row.ad_name ?? '').trim(),
    currency: String(row.account_currency || fallbackCurrency || '').toUpperCase(),
    spend,
    impressions,
    reach,
    frequency,
    clicks,
    inlineLinkClicks: num(row.inline_link_clicks),
    ctr,
    cpm,
    cpc,
    leads: leads.leads,
    leadAction: leads.action,
    costPerLead: leads.leads > 0 ? spend / leads.leads : null,
    publisherPlatform: String(row.publisher_platform ?? '').trim(),
    platformPosition: String(row.platform_position ?? '').trim(),
    region: String(row.region ?? '').trim(),
  }
}

/** Frequency up, CTR down, and CPL up, with at least 3 recent days. */
export function creativeFatigue(input: {
  days: number
  frequencyRecent: number | null
  frequencyPrior: number | null
  ctrRecent: number | null
  ctrPrior: number | null
  cplRecent: number | null
  cplPrior: number | null
}): boolean {
  if (input.days < 3) return false
  const { frequencyRecent, frequencyPrior, ctrRecent, ctrPrior, cplRecent, cplPrior } = input
  if (frequencyRecent == null || frequencyPrior == null) return false
  if (ctrRecent == null || ctrPrior == null) return false
  if (cplRecent == null || cplPrior == null) return false
  return frequencyRecent > frequencyPrior && ctrRecent < ctrPrior && cplRecent > cplPrior
}

export function placementLabel(platform: string, position: string): string {
  const place = `${platform} ${position}`.toLowerCase()
  if (place.includes('instagram') && place.includes('stor')) return 'אינסטגרם סטוריז'
  if (place.includes('instagram') && place.includes('reel')) return 'אינסטגרם רילס'
  if (place.includes('instagram') && place.includes('feed')) return 'פיד אינסטגרם'
  if (place.includes('facebook') && place.includes('reel')) return 'פייסבוק רילס'
  if (place.includes('facebook') && place.includes('stor')) return 'פייסבוק סטוריז'
  if (place.includes('facebook') && place.includes('feed')) return 'פיד פייסבוק'
  if (place.includes('messenger')) return 'מסנג׳ר'
  if (place.includes('audience')) return 'רשת הקהלים'
  const raw = [platform, position].filter(Boolean).join(' · ')
  return raw || 'אחר'
}

export type SyncMode = 'today' | 'close' | 'backfill'

export function syncModeOf(value: unknown): SyncMode {
  if (value === 'today' || value === 'close' || value === 'backfill') return value
  return 'backfill'
}
