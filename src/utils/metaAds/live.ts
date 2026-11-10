/** A campaign is live when an ad is actually delivering. Unknown delivery falls back to the campaign status. */

export function campaignIsLive(status?: string | null, delivering?: boolean | null): boolean {
  if (delivering === true) return true
  if (delivering === false) return false
  return String(status ?? '').trim().toUpperCase() === 'ACTIVE'
}

export function visibleCampaigns<T extends { campaignName: string; status?: string | null; delivering?: boolean | null }>(
  campaigns: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  return campaigns.filter(campaign => {
    const live = campaignIsLive(campaign.status, campaign.delivering)
    if (!needle) return live
    return campaign.campaignName.toLowerCase().includes(needle)
  })
}

export function updatedAgo(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime()
  if (!iso || Number.isNaN(then)) return 'עדיין לא עודכן'
  const mins = Math.max(0, Math.round((now - then) / 60000))
  if (mins < 1) return 'עודכן עכשיו'
  if (mins < 60) return `עודכן לפני ${mins} דק׳`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `עודכן לפני ${hours} שע׳`
  return `עודכן לפני ${Math.round(hours / 24)} ימים`
}
