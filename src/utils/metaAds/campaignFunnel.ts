import type { Candidate } from '../../types'
import { candidateAnchor, classifyPlacementForSpendRange } from '../candidateAnchor'
import { normalizeHebrew } from '../matchCandidates'
import { isGenericSource } from './inferCampaign'
import type { MapRow, SpendSlice } from './metrics'
import { addMoney, costOf, emptyMoney, type CostFigure, type MoneyTotals } from './money'
import { isDropoutStatus, isInterviewStatus, isRelevantStatus } from './stages'

const SENT = new Set(['sent_to_client', 'interview_scheduled', 'started_working', 'placement_complete'])

export interface FunnelCampaign {
  accountId: string
  campaignId: string
  campaignName: string
}

export interface CampaignFunnelRow {
  accountId: string
  campaignId: string
  campaignName: string
  accountName: string
  money: MoneyTotals
  metaLeads: number
  crmLeads: number
  relevant: number
  sent: number
  interviews: number
  placements: number
  notRelevant: number
  costPerRelevant: CostFigure
  costPerInterview: CostFigure
  costPerPlacement: CostFigure
}

interface LinkedLead {
  id: string
  status: string
  anchorDay: string
  positionIds: string[]
  placement: ReturnType<typeof classifyPlacementForSpendRange>
  accountId: string
  campaignId: string
}

function campaignKey(accountId: string, campaignId: string): string {
  return `${accountId}::${campaignId}`
}

function positionIdsOf(candidate: Pick<Candidate, 'savedPositionId' | 'savedPositionIds'>): string[] {
  return [...new Set([...(candidate.savedPositionIds ?? []), candidate.savedPositionId ?? ''].map(id => String(id || '').trim()).filter(Boolean))]
}

function linkOf(
  candidate: Pick<Candidate, 'source' | 'metaAccountId' | 'metaCampaignId'>,
  campaigns: FunnelCampaign[],
): { accountId: string; campaignId: string } | null {
  if (candidate.metaAccountId && candidate.metaCampaignId) {
    return { accountId: candidate.metaAccountId, campaignId: candidate.metaCampaignId }
  }
  if (isGenericSource(candidate.source)) return null
  const name = normalizeHebrew(candidate.source || '')
  const matches = campaigns.filter(item => normalizeHebrew(item.campaignName) === name)
  if (matches.length !== 1) return null
  return { accountId: matches[0].accountId, campaignId: matches[0].campaignId }
}

function inJobs(lead: LinkedLead, jobIds: string[] | 'all', maps: MapRow[]): boolean {
  if (jobIds === 'all') return true
  const selected = new Set(jobIds)
  if (lead.positionIds.some(id => selected.has(id))) return true
  if (lead.positionIds.length) return false
  return maps.some(row => row.accountId === lead.accountId && row.campaignId === lead.campaignId && selected.has(row.positionId))
}

function campaignShown(
  accountId: string,
  campaignId: string,
  jobIds: string[] | 'all',
  maps: MapRow[],
  leads: LinkedLead[],
): boolean {
  if (jobIds === 'all') return true
  const selected = new Set(jobIds)
  if (maps.some(row => row.accountId === accountId && row.campaignId === campaignId && selected.has(row.positionId))) return true
  return leads.some(lead => lead.accountId === accountId && lead.campaignId === campaignId && lead.positionIds.some(id => selected.has(id)))
}

/**
 * One row per campaign: Meta's own lead count beside the people actually linked in the CRM.
 * A link is the saved account + campaign id, or an exact campaign name already stored as מקור הגעה.
 */
export function campaignFunnel(input: {
  candidates: Pick<Candidate, 'id' | 'status' | 'source' | 'metaAccountId' | 'metaCampaignId' | 'savedPositionId' | 'savedPositionIds' | 'createdAt' | 'startDate' | 'interviewDate' | 'interviewHistory' | 'updatedAt' | 'attributionMonth'>[]
  campaigns: FunnelCampaign[]
  accounts?: { accountId: string; name: string }[]
  spend: (SpendSlice & { results?: number })[]
  maps?: MapRow[]
  jobIds: string[] | 'all'
  start: string
  end: string
  usdToIls: number | null
}): CampaignFunnelRow[] {
  const maps = input.maps ?? []
  const names = new Map(input.campaigns.map(item => [campaignKey(item.accountId, item.campaignId), item.campaignName]))
  const accountNames = new Map((input.accounts ?? []).map(item => [item.accountId, item.name]))
  const leads: LinkedLead[] = []
  for (const candidate of input.candidates) {
    const link = linkOf(candidate, input.campaigns)
    if (!link) continue
    if (!names.has(campaignKey(link.accountId, link.campaignId))) {
      names.set(campaignKey(link.accountId, link.campaignId), candidate.source || link.campaignId)
    }
    leads.push({
      id: candidate.id,
      status: candidate.status,
      anchorDay: candidateAnchor(candidate).day,
      positionIds: positionIdsOf(candidate),
      placement: classifyPlacementForSpendRange(candidate, input.start, input.end),
      accountId: link.accountId,
      campaignId: link.campaignId,
    })
  }

  const money = new Map<string, MoneyTotals>()
  const metaLeads = new Map<string, number>()
  for (const row of input.spend) {
    if (!row.date || row.date < input.start || row.date > input.end) continue
    const id = campaignKey(row.accountId, row.campaignId)
    money.set(id, addMoney(money.get(id) ?? emptyMoney(), row.spend, row.currency, input.usdToIls))
    metaLeads.set(id, (metaLeads.get(id) ?? 0) + (row.results || 0))
    if (!names.has(id)) names.set(id, row.campaignId)
  }

  const ids = new Set<string>([...money.keys(), ...leads.map(lead => campaignKey(lead.accountId, lead.campaignId))])
  const rows: CampaignFunnelRow[] = []
  for (const id of ids) {
    const [accountId, campaignId] = id.split('::')
    if (!campaignShown(accountId, campaignId, input.jobIds, maps, leads)) continue
    const mine = leads.filter(lead => campaignKey(lead.accountId, lead.campaignId) === id && inJobs(lead, input.jobIds, maps))
    const seen = new Set<string>()
    const unique = mine.filter(lead => {
      if (seen.has(lead.id)) return false
      seen.add(lead.id)
      return true
    })
    const inRange = unique.filter(lead => lead.anchorDay && lead.anchorDay >= input.start && lead.anchorDay <= input.end)
    const bag = money.get(id) ?? emptyMoney()
    const relevant = inRange.filter(lead => isRelevantStatus(lead.status)).length
    const interviews = inRange.filter(lead => isInterviewStatus(lead.status)).length
    const placements = unique.filter(lead => lead.placement === 'dated' || lead.placement === 'month').length
    const meta = metaLeads.get(id) ?? 0
    const crm = inRange.length
    if (!meta && !crm && !(bag.byCurrency.length)) continue
    rows.push({
      accountId,
      campaignId,
      campaignName: names.get(id) || campaignId,
      accountName: accountNames.get(accountId) || accountId,
      money: bag,
      metaLeads: meta,
      crmLeads: crm,
      relevant,
      sent: inRange.filter(lead => SENT.has(lead.status)).length,
      interviews,
      placements,
      notRelevant: inRange.filter(lead => isDropoutStatus(lead.status)).length,
      costPerRelevant: costOf(bag, relevant),
      costPerInterview: costOf(bag, interviews),
      costPerPlacement: costOf(bag, placements),
    })
  }
  return rows.sort((a, b) => b.crmLeads - a.crmLeads || b.metaLeads - a.metaLeads || a.campaignName.localeCompare(b.campaignName, 'he'))
}
