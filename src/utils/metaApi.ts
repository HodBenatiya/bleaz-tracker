export interface MetaCredentials {
  accessToken: string
  accountId: string  // just the number, without 'act_' prefix
}

export interface MetaCampaign {
  campaignId:   string
  campaignName: string
  spend:        number
  leads:        number
  impressions:  number
  clicks:       number
}

const CREDS_KEY = 'bleaz_meta_credentials'

export function loadMetaCredentials(): MetaCredentials | null {
  try {
    const s = localStorage.getItem(CREDS_KEY)
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
}

export function saveMetaCredentials(creds: MetaCredentials): void {
  localStorage.setItem(CREDS_KEY, JSON.stringify(creds))
}

export function clearMetaCredentials(): void {
  localStorage.removeItem(CREDS_KEY)
}

export async function fetchDailyInsights(
  creds: MetaCredentials,
  date: string  // YYYY-MM-DD
): Promise<MetaCampaign[]> {
  const params = new URLSearchParams({
    fields:         'campaign_id,campaign_name,spend,actions,impressions,clicks',
    level:          'campaign',
    time_range:     JSON.stringify({ since: date, until: date }),
    time_increment: '1',
    access_token:   creds.accessToken,
  })

  const res  = await fetch(`https://graph.facebook.com/v19.0/act_${creds.accountId}/insights?${params}`)
  const data = await res.json()

  if (data.error) throw new Error(data.error.message || 'שגיאה ב-Meta API')

  const LEAD_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'omni_lead', 'contact_total']

  return (data.data ?? []).map((c: Record<string, unknown>) => {
    const actions    = (c.actions as { action_type: string; value: string }[] | undefined) ?? []
    const leadAction = actions.find(a => LEAD_TYPES.includes(a.action_type))
    return {
      campaignId:   String(c.campaign_id   ?? ''),
      campaignName: String(c.campaign_name ?? ''),
      spend:        parseFloat(String(c.spend ?? '0')),
      leads:        parseInt(leadAction?.value ?? '0'),
      impressions:  parseInt(String(c.impressions ?? '0')),
      clicks:       parseInt(String(c.clicks ?? '0')),
    }
  })
}
