import { normalizeHebrew } from '../matchCandidates'
import type { AdReferral } from './adReferral'

export interface InferCampaign {
  accountId: string
  campaignId: string
  campaignName: string
}

export interface InferMap {
  accountId: string
  campaignId: string
  positionId: string
}

export type InferReason = 'referral-id' | 'referral-name' | 'source-name' | 'job'

export interface CampaignInference {
  accountId: string
  campaignId: string
  campaignName: string
  reason: InferReason
}

const GENERIC = new Set([
  '',
  'whatsapp',
  'meta',
  'facebook',
  'instagram',
  'facebook lead ads',
  'meta ads',
  'אורגני',
  'שיתוף / המלצה',
  'שיתוף המלצה',
  'אחר',
])

export function isGenericSource(source: string | undefined): boolean {
  const raw = String(source ?? '').trim()
  return GENERIC.has(raw.toLowerCase()) || GENERIC.has(normalizeHebrew(raw))
}

function key(accountId: string, campaignId: string): string {
  return `${accountId}::${campaignId}`
}

function unique(list: InferCampaign[]): InferCampaign | null {
  const seen = new Map<string, InferCampaign>()
  for (const item of list) seen.set(key(item.accountId, item.campaignId), item)
  if (seen.size !== 1) return null
  return [...seen.values()][0]
}

function byId(campaigns: InferCampaign[], sourceId: string): InferCampaign | null {
  const id = sourceId.trim()
  if (!id) return null
  return unique(campaigns.filter(item => item.campaignId === id))
}

function byName(campaigns: InferCampaign[], name: string): InferCampaign | null {
  const norm = normalizeHebrew(name)
  if (!norm || norm.length < 4) return null
  return unique(campaigns.filter(item => normalizeHebrew(item.campaignName) === norm))
}

function byJob(campaigns: InferCampaign[], maps: InferMap[], positionIds: string[]): InferCampaign | null {
  const ids = [...new Set(positionIds.map(id => id.trim()).filter(Boolean))]
  if (!ids.length) return null
  const hits = new Map<string, InferCampaign>()
  for (const positionId of ids) {
    for (const row of maps) {
      if (row.positionId !== positionId) continue
      const campaign = campaigns.find(item => item.accountId === row.accountId && item.campaignId === row.campaignId)
      if (campaign) hits.set(key(campaign.accountId, campaign.campaignId), campaign)
    }
  }
  if (hits.size !== 1) return null
  return [...hits.values()][0]
}

/**
 * Pick a campaign only when one answer is clear.
 * A referral id wins, then an exact referral or source name, then a job mapped to one campaign.
 */
export function inferCampaign(input: {
  campaigns: InferCampaign[]
  maps?: InferMap[]
  referrals?: AdReferral[]
  source?: string
  positionIds?: string[]
}): CampaignInference | null {
  const campaigns = input.campaigns
  if (!campaigns.length) return null

  for (const referral of input.referrals ?? []) {
    const hit = byId(campaigns, referral.sourceId || '')
    if (hit) return { ...hit, reason: 'referral-id' }
  }
  for (const referral of input.referrals ?? []) {
    const hit = byName(campaigns, referral.title || '') || byName(campaigns, referral.body || '')
    if (hit) return { ...hit, reason: 'referral-name' }
  }
  if (!isGenericSource(input.source)) {
    const hit = byName(campaigns, input.source || '')
    if (hit) return { ...hit, reason: 'source-name' }
  }
  const job = byJob(campaigns, input.maps ?? [], input.positionIds ?? [])
  if (job) return { ...job, reason: 'job' }
  return null
}
