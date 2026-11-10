import type { Candidate } from '../../types'
import { candidateAnchor, classifyPlacementForSpendRange, type SpendPlacementKind } from '../candidateAnchor'
import { attributeLead, type KnownCampaign } from './attributeLead'
import { addMoney, costOf, emptyMoney, type CostFigure, type MoneyTotals } from './money'
import { isDropoutStatus, isInterviewStatus, isRelevantStatus } from './stages'

export interface SpendSlice {
  accountId: string
  campaignId: string
  date: string
  spend: number
  currency: string
}

export interface MapRow {
  accountId: string
  campaignId: string
  positionId: string
}

export interface MetricLead {
  id: string
  status: string
  anchorDay: string
  positionIds: string[]
  placementKind: SpendPlacementKind
}

export interface StageCounts {
  leads: number
  relevant: number
  interviews: number
  placements: number
  placementsWithheld: number
  dropouts: number
}

export interface ScopeMetrics {
  id: string
  label: string
  counts: StageCounts
  money: MoneyTotals
  costPerLead: CostFigure
  costPerRelevant: CostFigure
  costPerInterview: CostFigure
  costPerPlacement: CostFigure
  costPerDropout: CostFigure
}

export interface AdsReport {
  selection: ScopeMetrics
  jobs: ScopeMetrics[]
  unattributed: ScopeMetrics
  usdToIls: number | null
}

function campaignKey(accountId: string, campaignId: string): string {
  return `${accountId}::${campaignId}`
}

function countsFor(leads: MetricLead[], start: string, end: string): StageCounts {
  const seen = new Set<string>()
  const unique = leads.filter(lead => {
    if (seen.has(lead.id)) return false
    seen.add(lead.id)
    return true
  })
  const inRange = unique.filter(lead => lead.anchorDay && lead.anchorDay >= start && lead.anchorDay <= end)
  return {
    leads: inRange.length,
    relevant: inRange.filter(lead => isRelevantStatus(lead.status)).length,
    interviews: inRange.filter(lead => isInterviewStatus(lead.status)).length,
    dropouts: inRange.filter(lead => isDropoutStatus(lead.status)).length,
    placements: unique.filter(lead => lead.placementKind === 'dated' || lead.placementKind === 'month').length,
    placementsWithheld: unique.filter(lead => lead.placementKind === 'withheld').length,
  }
}

function scope(id: string, label: string, counts: StageCounts, money: MoneyTotals): ScopeMetrics {
  return {
    id,
    label,
    counts,
    money,
    costPerLead: costOf(money, counts.leads),
    costPerRelevant: costOf(money, counts.relevant),
    costPerInterview: costOf(money, counts.interviews),
    costPerPlacement: costOf(money, counts.placements),
    costPerDropout: costOf(money, counts.dropouts),
  }
}

function moneySize(money: MoneyTotals): number {
  if (money.ils != null) return money.ils
  return money.byCurrency.reduce((sum, row) => sum + row.amount, 0)
}

export function computeAdsMetrics(input: {
  spend: SpendSlice[]
  maps: MapRow[]
  leads: MetricLead[]
  jobIds: string[] | 'all'
  labels?: Record<string, string>
  usdToIls: number | null
  start: string
  end: string
  selectionLabel?: string
}): AdsReport {
  const { start, end, usdToIls } = input
  const selected = input.jobIds === 'all' ? null : new Set(input.jobIds)
  const mapByCampaign = new Map<string, string[]>()
  for (const row of input.maps) {
    if (!row.positionId) continue
    const key = campaignKey(row.accountId, row.campaignId)
    const list = mapByCampaign.get(key) ?? []
    if (!list.includes(row.positionId)) list.push(row.positionId)
    mapByCampaign.set(key, list)
  }

  const jobMoney = new Map<string, MoneyTotals>()
  let selectionMoney = emptyMoney()
  let unmappedMoney = emptyMoney()
  const ensure = (id: string) => {
    if (!jobMoney.has(id)) jobMoney.set(id, emptyMoney())
    return jobMoney.get(id) as MoneyTotals
  }

  for (const row of input.spend) {
    if (!row.date || row.date < start || row.date > end) continue
    const ids = mapByCampaign.get(campaignKey(row.accountId, row.campaignId)) ?? []
    if (!ids.length) {
      unmappedMoney = addMoney(unmappedMoney, row.spend, row.currency, usdToIls)
      if (!selected) selectionMoney = addMoney(selectionMoney, row.spend, row.currency, usdToIls)
      continue
    }
    const share = row.spend / ids.length
    for (const id of ids) {
      jobMoney.set(id, addMoney(ensure(id), share, row.currency, usdToIls))
    }
    if (!selected) {
      selectionMoney = addMoney(selectionMoney, row.spend, row.currency, usdToIls)
    } else {
      const hit = ids.filter(id => selected.has(id)).length
      if (hit) selectionMoney = addMoney(selectionMoney, share * hit, row.currency, usdToIls)
    }
  }

  const selectionLeads = input.leads.filter(lead => {
    if (!selected) return true
    return lead.positionIds.some(id => selected.has(id))
  })
  const unattributedLeads = input.leads.filter(lead => lead.positionIds.length === 0)

  const jobIds = new Set<string>(selected ? [...selected] : [])
  if (!selected) {
    for (const id of jobMoney.keys()) jobIds.add(id)
    for (const lead of input.leads) for (const id of lead.positionIds) jobIds.add(id)
  }

  const jobs = [...jobIds].map(id => scope(
    id,
    input.labels?.[id] || 'משרה',
    countsFor(input.leads.filter(lead => lead.positionIds.includes(id)), start, end),
    jobMoney.get(id) ?? emptyMoney(),
  )).sort((a, b) => moneySize(b.money) - moneySize(a.money) || b.counts.leads - a.counts.leads)

  return {
    selection: scope(selected ? 'selection' : 'all', input.selectionLabel || (selected ? 'משרות נבחרות' : 'הכל'), countsFor(selectionLeads, start, end), selectionMoney),
    jobs,
    unattributed: scope('unattributed', 'לא משויך', countsFor(unattributedLeads, start, end), unmappedMoney),
    usdToIls,
  }
}

export function metricLeads(
  candidates: Pick<Candidate, 'id' | 'status' | 'source' | 'savedPositionId' | 'savedPositionIds' | 'createdAt' | 'startDate' | 'interviewDate' | 'interviewHistory' | 'updatedAt' | 'attributionMonth'>[],
  campaigns: KnownCampaign[],
  start: string,
  end: string,
): MetricLead[] {
  return candidates.map(candidate => {
    const attribution = attributeLead(candidate, campaigns)
    return {
      id: candidate.id,
      status: candidate.status,
      anchorDay: candidateAnchor(candidate).day,
      positionIds: attribution.kind === 'attributed' ? attribution.positionIds : [],
      placementKind: classifyPlacementForSpendRange(candidate, start, end),
    }
  })
}

export function campaignsFromMaps(
  catalog: { accountId: string; campaignId: string; campaignName: string }[],
  maps: MapRow[],
): KnownCampaign[] {
  const names = new Map<string, { accountId: string; campaignId: string; campaignName: string }>()
  for (const row of catalog) names.set(campaignKey(row.accountId, row.campaignId), row)
  for (const row of maps) {
    const key = campaignKey(row.accountId, row.campaignId)
    if (!names.has(key)) names.set(key, { accountId: row.accountId, campaignId: row.campaignId, campaignName: row.campaignId })
  }
  return [...names.values()].map(row => ({
    ...row,
    positionIds: maps.filter(item => item.accountId === row.accountId && item.campaignId === row.campaignId).map(item => item.positionId),
  }))
}
