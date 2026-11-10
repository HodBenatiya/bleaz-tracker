import type { AdReferral } from './adReferral'

export interface KnownAd {
  accountId: string
  adId: string
  adsetId: string
  campaignId: string
  campaignName: string
}

/** The WhatsApp click-to-ad source id is an ad id when it matches exactly one stored ad. */
export function adFromReferral(referrals: AdReferral[], ads: KnownAd[]): KnownAd | null {
  for (const referral of referrals) {
    const id = String(referral.sourceId ?? '').trim()
    if (!id) continue
    const hits = ads.filter(ad => ad.adId === id)
    if (hits.length === 1) return hits[0]
  }
  return null
}
