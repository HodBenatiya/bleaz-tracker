import { normalizeHebrew } from '../matchCandidates'

export interface KnownCampaign {
  accountId: string
  campaignId: string
  campaignName: string
  positionIds: string[]
}

export interface LeadRef {
  source?: string
  savedPositionId?: string
  savedPositionIds?: string[]
}

export type LeadAttribution =
  | { kind: 'attributed'; positionIds: string[]; via: 'assignment' | 'source'; campaignId?: string }
  | { kind: 'unattributed'; why: 'no-link' | 'unmapped-campaign' | 'ambiguous' }

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

function assignedIds(lead: LeadRef): string[] {
  const ids = [...(lead.savedPositionIds ?? []), lead.savedPositionId ?? '']
  return [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))]
}

function sourceMatchesCampaign(sourceNorm: string, rawSource: string, campaign: KnownCampaign): boolean {
  const name = normalizeHebrew(campaign.campaignName)
  if (name && sourceNorm === name) return true
  const campaignDigits = campaign.campaignId.replace(/\D/g, '')
  if (campaignDigits.length >= 6 && rawSource.includes(campaignDigits)) return true
  if (name.length >= 4 && sourceNorm.includes(name)) return true
  return false
}

/**
 * A lead belongs to a job only when someone assigned the job, or the arrival
 * source is exactly one known campaign that is already mapped. Otherwise לא משויך.
 */
export function attributeLead(lead: LeadRef, campaigns: KnownCampaign[]): LeadAttribution {
  const jobs = assignedIds(lead)
  const rawSource = String(lead.source ?? '').trim()
  const sourceNorm = normalizeHebrew(rawSource)
  const generic = GENERIC.has(sourceNorm) || GENERIC.has(rawSource.trim().toLowerCase())

  let matched: KnownCampaign[] = []
  if (!generic && sourceNorm.length >= 3) {
    matched = campaigns.filter(campaign => sourceMatchesCampaign(sourceNorm, rawSource, campaign))
  }
  const campaignId = matched.length === 1 ? matched[0].campaignId : undefined

  if (jobs.length) {
    return { kind: 'attributed', positionIds: jobs, via: 'assignment', campaignId }
  }
  if (matched.length > 1) return { kind: 'unattributed', why: 'ambiguous' }
  if (matched.length === 1) {
    const ids = [...new Set(matched[0].positionIds.filter(Boolean))]
    if (!ids.length) return { kind: 'unattributed', why: 'unmapped-campaign' }
    return { kind: 'attributed', positionIds: ids, via: 'source', campaignId: matched[0].campaignId }
  }
  return { kind: 'unattributed', why: 'no-link' }
}
