import type { MapRow, MetricLead, SpendSlice } from './metrics'
import { addMoney, costOf, emptyMoney, type CostFigure, type MoneyTotals } from './money'
import { addDaysISO, eachDate } from './zone'

export type TrendGrain = 'day' | 'week' | 'month'

export interface TrendPoint {
  key: string
  label: string
  start: string
  end: string
  spend: MoneyTotals
  leads: number
  costPerLead: CostFigure
}

function weekStart(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return addDaysISO(iso, -weekday)
}

export function trendKey(iso: string, grain: TrendGrain): string {
  if (grain === 'month') return iso.slice(0, 7)
  if (grain === 'week') return weekStart(iso)
  return iso
}

function campaignKey(accountId: string, campaignId: string): string {
  return `${accountId}::${campaignId}`
}

function shareSpend(
  rows: SpendSlice[],
  maps: MapRow[],
  jobId: string | 'all' | 'unattributed',
  usdToIls: number | null,
): MoneyTotals {
  const mapByCampaign = new Map<string, string[]>()
  for (const row of maps) {
    if (!row.positionId) continue
    const key = campaignKey(row.accountId, row.campaignId)
    const list = mapByCampaign.get(key) ?? []
    if (!list.includes(row.positionId)) list.push(row.positionId)
    mapByCampaign.set(key, list)
  }
  let money = emptyMoney()
  for (const row of rows) {
    const ids = mapByCampaign.get(campaignKey(row.accountId, row.campaignId)) ?? []
    if (!ids.length) {
      if (jobId === 'all' || jobId === 'unattributed') money = addMoney(money, row.spend, row.currency, usdToIls)
      continue
    }
    if (jobId === 'unattributed') continue
    if (jobId === 'all') {
      money = addMoney(money, row.spend, row.currency, usdToIls)
      continue
    }
    if (!ids.includes(jobId)) continue
    money = addMoney(money, row.spend / ids.length, row.currency, usdToIls)
  }
  return money
}

/** Spend and cost-per-lead for each day, Sunday-week, or month inside the range. */
export function buildTrend(input: {
  spend: SpendSlice[]
  maps: MapRow[]
  leads: MetricLead[]
  jobId: string | 'all' | 'unattributed'
  usdToIls: number | null
  start: string
  end: string
  grain: TrendGrain
}): TrendPoint[] {
  const days = eachDate(input.start, input.end)
  const groups = new Map<string, string[]>()
  for (const day of days) {
    const key = trendKey(day, input.grain)
    const list = groups.get(key) ?? []
    list.push(day)
    groups.set(key, list)
  }
  const points: TrendPoint[] = []
  for (const [key, bucket] of groups) {
    const start = bucket[0]
    const end = bucket[bucket.length - 1]
    const inBucket = new Set(bucket)
    const spend = shareSpend(
      input.spend.filter(row => inBucket.has(row.date)),
      input.maps,
      input.jobId,
      input.usdToIls,
    )
    const seen = new Set<string>()
    const leads = input.leads.filter(lead => {
      if (!lead.anchorDay || !inBucket.has(lead.anchorDay) || seen.has(lead.id)) return false
      if (input.jobId === 'unattributed' && lead.positionIds.length > 0) return false
      if (input.jobId !== 'all' && input.jobId !== 'unattributed' && !lead.positionIds.includes(input.jobId)) return false
      seen.add(lead.id)
      return true
    }).length
    const label = input.grain === 'day'
      ? start
      : input.grain === 'month'
        ? key
        : start === end ? start : `${start} – ${end}`
    points.push({
      key,
      label,
      start,
      end,
      spend,
      leads,
      costPerLead: costOf(spend, leads),
    })
  }
  return points
}
