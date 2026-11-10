import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  META_GRAPH_VERSION,
  accountDatesForSpans,
  assertMetaRead,
  bucketToIsraelDays,
  dateInSpans,
  HISTORY_FLOOR_DAYS,
  isTokenEnvName,
  mergeAccountConfigs,
  normalizeAccountId,
  parseInsightRow,
  planFetchSpans,
  safeEqual,
  stripSecrets,
  type AccountConfig,
  type IsraelSlice,
  type MetaInsightRow,
} from '../../../src/utils/metaAds/syncCore.ts'
import { parseAdMetric, syncModeOf, type SyncMode } from '../../../src/utils/metaAds/adMetrics.ts'
import { backoffMs, rateLimitCode } from '../../../src/utils/metaAds/rateLimit.ts'
import { addDaysISO, todayInIsrael } from '../../../src/utils/metaAds/zone.ts'

const ISRAEL = 'Asia/Jerusalem'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function authorized(req: Request): boolean {
  const secret = Deno.env.get('META_SYNC_SECRET') ?? ''
  if (!secret) return false
  const header = req.headers.get('x-cron-secret') ?? ''
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  return safeEqual(header, secret) || safeEqual(bearer, secret)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function graphGet(url: string): Promise<Record<string, unknown>> {
  assertMetaRead(url, 'GET')
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, { method: 'GET' })
    const text = await response.text()
    let data: Record<string, unknown>
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error(stripSecrets(text).slice(0, 240))
    }
    const error = data.error as { code?: number; error_subcode?: number; message?: string } | undefined
    if (rateLimitCode(error) != null && attempt < 4) {
      await sleep(backoffMs(attempt))
      continue
    }
    if (error) throw new Error(stripSecrets(error.message || 'Meta error'))
    return data
  }
  throw new Error('Meta rate limit')
}

async function paged(url: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let next: string | null = url
  while (next) {
    const page = await graphGet(next)
    const data = Array.isArray(page.data) ? page.data as Record<string, unknown>[] : []
    rows.push(...data)
    const paging = page.paging as { next?: string } | undefined
    next = typeof paging?.next === 'string' ? paging.next : null
  }
  return rows
}

function insightsUrl(accountId: string, date: string, token: string): string {
  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency',
    time_range: JSON.stringify({ since: date, until: date }),
    time_increment: '1',
    breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
    limit: '500',
    access_token: token,
  })
  return `https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/insights?${params}`
}

function campaignsUrl(accountId: string, token: string): string {
  const params = new URLSearchParams({
    fields: 'id,name,effective_status',
    limit: '200',
    access_token: token,
  })
  return `https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/campaigns?${params}`
}

function deliveryUrl(kind: 'ads' | 'adsets', accountId: string, token: string): string {
  const params = new URLSearchParams({
    fields: 'campaign_id,effective_status',
    filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
    limit: '500',
    access_token: token,
  })
  return `https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/${kind}?${params}`
}

function countByCampaign(rows: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const id = String(row.campaign_id ?? '')
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

function readExtraAccounts(): AccountConfig[] {
  const extras: AccountConfig[] = []
  const raw = Deno.env.get('META_ACCOUNTS_JSON') ?? ''
  if (raw.trim()) {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error('META_ACCOUNTS_JSON must be a list')
    for (const item of parsed as Record<string, unknown>[]) {
      extras.push({
        accountId: normalizeAccountId(String(item.accountId ?? item.account_id ?? '')),
        name: String(item.name || 'חשבון'),
        currency: String(item.currency || 'USD').toUpperCase(),
        timezone: String(item.timezone || ISRAEL),
        tokenEnv: String(item.tokenEnv ?? item.token_env ?? ''),
        enabled: item.enabled !== false,
      })
    }
  }
  const bleaz = Deno.env.get('META_BLEAZ_ACCOUNT_ID') ?? ''
  if (bleaz.trim()) {
    extras.push({
      accountId: normalizeAccountId(bleaz),
      name: Deno.env.get('META_BLEAZ_NAME') || 'BLEAZ',
      currency: (Deno.env.get('META_BLEAZ_CURRENCY') || 'ILS').toUpperCase(),
      timezone: Deno.env.get('META_BLEAZ_TIMEZONE') || ISRAEL,
      tokenEnv: 'META_TOKEN_BLEAZ',
      enabled: true,
    })
  }
  return extras
}

function sliceRow(accountId: string, slice: IsraelSlice, dateField: 'insight_date' | 'snapshot_date') {
  return {
    account_id: accountId,
    campaign_id: slice.campaignId,
    [dateField]: slice.date,
    campaign_name: slice.campaignName,
    currency: slice.currency,
    spend: Math.round(slice.spend * 10000) / 10000,
    impressions: Math.round(slice.impressions),
    clicks: Math.round(slice.clicks),
    results: Math.round(slice.results),
    result_action: slice.resultAction,
    synced_at: new Date().toISOString(),
  }
}

async function upsertChunks(supabase: ReturnType<typeof createClient>, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 200))
    if (error) throw new Error(error.message)
  }
}

async function upsertCampaigns(supabase: ReturnType<typeof createClient>, rows: Record<string, unknown>[]) {
  try {
    await upsertChunks(supabase, 'meta_campaigns', rows)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (!/delivering|active_ads|active_adsets|schema cache|column/i.test(message)) throw error
    const slim = rows.map(row => {
      const { delivering: _delivering, active_ads: _ads, active_adsets: _sets, ...rest } = row
      return rest
    })
    await upsertChunks(supabase, 'meta_campaigns', slim)
  }
}

function insightUrl(accountId: string, token: string, since: string, until: string, level: 'ad' | 'campaign', breakdown: string): string {
  const params = new URLSearchParams({
    level,
    fields: level === 'ad'
      ? 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpm,cpc,actions,account_currency'
      : 'campaign_id,campaign_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpm,cpc,actions,account_currency',
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    limit: '500',
    access_token: token,
  })
  if (breakdown) params.set('breakdowns', breakdown)
  return `https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/insights?${params}`
}

function metricRecord(accountId: string, row: NonNullable<ReturnType<typeof parseAdMetric>>, extra: Record<string, string> = {}) {
  return {
    account_id: accountId,
    campaign_id: row.campaignId,
    adset_id: row.adsetId,
    ad_id: row.adId,
    ad_name: row.adName,
    insight_date: row.date,
    currency: row.currency,
    spend: row.spend,
    impressions: Math.round(row.impressions),
    reach: Math.round(row.reach),
    frequency: row.frequency,
    clicks: Math.round(row.clicks),
    inline_link_clicks: Math.round(row.inlineLinkClicks),
    ctr: row.ctr,
    cpm: row.cpm,
    cpc: row.cpc,
    leads: Math.round(row.leads),
    lead_action: row.leadAction,
    cost_per_lead: row.costPerLead,
    synced_at: new Date().toISOString(),
    ...extra,
  }
}

async function rememberStatus(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  objectType: 'campaign' | 'adset' | 'ad',
  rows: { id: string; status: string; delivering: boolean | null }[],
) {
  const { data, error } = await supabase.from('meta_status_history')
    .select('object_id,effective_status,delivering,observed_at')
    .eq('account_id', accountId)
    .eq('object_type', objectType)
    .order('observed_at', { ascending: false })
    .limit(2000)
  if (error) {
    if (/schema cache|does not exist|could not find/i.test(error.message)) return
    throw new Error(error.message)
  }
  const latest = new Map<string, { status: string; delivering: boolean | null }>()
  for (const row of data ?? []) {
    const id = String(row.object_id)
    if (!latest.has(id)) latest.set(id, { status: String(row.effective_status ?? ''), delivering: row.delivering as boolean | null })
  }
  const inserts = rows.filter(row => {
    const prev = latest.get(row.id)
    if (!prev) return true
    return prev.status !== row.status || prev.delivering !== row.delivering
  }).map(row => ({
    account_id: accountId,
    object_type: objectType,
    object_id: row.id,
    effective_status: row.status,
    delivering: row.delivering,
  }))
  if (!inserts.length) return
  const { error: insertError } = await supabase.from('meta_status_history').insert(inserts)
  if (insertError && !/schema cache|does not exist|could not find/i.test(insertError.message)) throw new Error(insertError.message)
}

async function syncAdDepth(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  currency: string,
  token: string,
  since: string,
  until: string,
) {
  const daily: Record<string, unknown>[] = []
  for (const raw of await paged(insightUrl(accountId, token, since, until, 'ad', ''))) {
    const parsed = parseAdMetric(raw, currency)
    if (!parsed?.adId) continue
    daily.push(metricRecord(accountId, parsed))
  }
  await upsertChunks(supabase, 'meta_ad_insights_daily', daily)
  await sleep(200)

  const placements: Record<string, unknown>[] = []
  for (const raw of await paged(insightUrl(accountId, token, since, until, 'ad', 'publisher_platform,platform_position'))) {
    const parsed = parseAdMetric(raw, currency)
    if (!parsed?.adId) continue
    placements.push(metricRecord(accountId, parsed, {
      publisher_platform: parsed.publisherPlatform,
      platform_position: parsed.platformPosition,
    }))
  }
  await upsertChunks(supabase, 'meta_ad_placement_insights_daily', placements)
  await sleep(200)

  const regions: Record<string, unknown>[] = []
  for (const raw of await paged(insightUrl(accountId, token, since, until, 'campaign', 'region'))) {
    const parsed = parseAdMetric(raw, currency)
    if (!parsed) continue
    regions.push({
      account_id: accountId,
      campaign_id: parsed.campaignId,
      insight_date: parsed.date,
      region: parsed.region,
      currency: parsed.currency,
      spend: parsed.spend,
      impressions: Math.round(parsed.impressions),
      reach: Math.round(parsed.reach),
      frequency: parsed.frequency,
      clicks: Math.round(parsed.clicks),
      inline_link_clicks: Math.round(parsed.inlineLinkClicks),
      ctr: parsed.ctr,
      cpm: parsed.cpm,
      cpc: parsed.cpc,
      leads: Math.round(parsed.leads),
      lead_action: parsed.leadAction,
      cost_per_lead: parsed.costPerLead,
      synced_at: new Date().toISOString(),
    })
  }
  await upsertChunks(supabase, 'meta_campaign_region_insights_daily', regions)
  await sleep(200)

  const adParams = new URLSearchParams({
    fields: 'id,name,adset_id,campaign_id,status,effective_status,created_time,creative{id,thumbnail_url}',
    limit: '200',
    access_token: token,
  })
  const adsetParams = new URLSearchParams({
    fields: 'id,name,campaign_id,status,effective_status,created_time',
    limit: '200',
    access_token: token,
  })
  const ads = await paged(`https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/ads?${adParams}`)
  const adsets = await paged(`https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/adsets?${adsetParams}`)
  const adRows = ads.map(row => {
    const creative = row.creative && typeof row.creative === 'object' ? row.creative as Record<string, unknown> : {}
    return {
      account_id: accountId,
      ad_id: String(row.id ?? ''),
      adset_id: String(row.adset_id ?? ''),
      campaign_id: String(row.campaign_id ?? ''),
      name: String(row.name ?? ''),
      status: String(row.status ?? ''),
      effective_status: String(row.effective_status ?? ''),
      creative_id: String(creative.id ?? ''),
      thumbnail_url: String(creative.thumbnail_url ?? ''),
      created_time: row.created_time ? String(row.created_time) : null,
      updated_at: new Date().toISOString(),
    }
  }).filter(row => row.ad_id)
  const adsetRows = adsets.map(row => ({
    account_id: accountId,
    adset_id: String(row.id ?? ''),
    campaign_id: String(row.campaign_id ?? ''),
    name: String(row.name ?? ''),
    status: String(row.status ?? ''),
    effective_status: String(row.effective_status ?? ''),
    created_time: row.created_time ? String(row.created_time) : null,
    updated_at: new Date().toISOString(),
  })).filter(row => row.adset_id)
  await upsertChunks(supabase, 'meta_ads', adRows)
  await upsertChunks(supabase, 'meta_adsets', adsetRows)
  await rememberStatus(supabase, accountId, 'ad', adRows.map(row => ({
    id: row.ad_id,
    status: row.effective_status,
    delivering: row.effective_status === 'ACTIVE',
  })))
  await rememberStatus(supabase, accountId, 'adset', adsetRows.map(row => ({
    id: row.adset_id,
    status: row.effective_status,
    delivering: row.effective_status === 'ACTIVE',
  })))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401)

  const started = new Date().toISOString()
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  let backfillDays = 3
  let mode: SyncMode = 'backfill'
  if (req.method === 'POST') {
    try {
      const body = await req.json() as { backfill_days?: number; mode?: string }
      if (typeof body?.backfill_days === 'number') backfillDays = body.backfill_days
      mode = syncModeOf(body?.mode)
      if (body?.mode == null && typeof body?.backfill_days === 'number') mode = 'backfill'
    } catch {
      /* cron may send an empty body */
    }
  }

  const notes: string[] = []
  try {
    const { data: tableAccounts, error: accountError } = await supabase
      .from('meta_ad_accounts')
      .select('account_id,name,currency,timezone,token_env,enabled')
    if (accountError) throw new Error(accountError.message)

    const fromTable: AccountConfig[] = (tableAccounts ?? []).map(row => ({
      accountId: normalizeAccountId(String(row.account_id)),
      name: String(row.name ?? ''),
      currency: String(row.currency ?? 'USD'),
      timezone: String(row.timezone ?? ISRAEL),
      tokenEnv: String(row.token_env ?? ''),
      enabled: row.enabled !== false,
    }))

    let extras: AccountConfig[] = []
    try {
      extras = readExtraAccounts()
    } catch (error) {
      notes.push(stripSecrets(error instanceof Error ? error.message : 'bad account config'))
    }
    const accounts = mergeAccountConfigs(fromTable, extras)
    const today = todayInIsrael()
    const { data: stateRow } = await supabase.from('meta_sync_state').select('oldest_date').eq('id', 'default').maybeSingle()
    const oldest = stateRow?.oldest_date ? String(stateRow.oldest_date).slice(0, 10) : null
    const plan = mode === 'today'
      ? { spans: [{ start: today, end: today }], nextOldest: oldest ?? today }
      : mode === 'close'
        ? { spans: [{ start: addDaysISO(today, -2), end: today }], nextOldest: oldest ?? addDaysISO(today, -2) }
        : planFetchSpans(today, backfillDays, oldest)
    const dates = accountDatesForSpans(plan.spans)
    const insightSince = dates[0] || today
    const insightUntil = dates[dates.length - 1] || today

    let dailyRows = 0
    let todayRows = 0
    let syncedAccounts = 0
    let failed = 0

    for (const account of accounts) {
      if (!isTokenEnvName(account.tokenEnv)) {
        failed += 1
        notes.push(`${account.accountId}: token env name is not allowed`)
        continue
      }
      const token = Deno.env.get(account.tokenEnv) ?? ''
      if (!token) {
        failed += 1
        notes.push(`${account.name}: secret ${account.tokenEnv} is empty`)
        continue
      }
      try {
        const parsed = []
        for (const date of dates) {
          const page = await paged(insightsUrl(account.accountId, date, token))
          for (const row of page) {
            const hour = parseInsightRow(row as MetaInsightRow, account.currency)
            if (hour) parsed.push(hour)
          }
        }
        const slices = bucketToIsraelDays(parsed, account.timezone)
          .filter(slice => dateInSpans(slice.date, plan.spans))
        const daily = slices.filter(slice => slice.date < today).map(slice => sliceRow(account.accountId, slice, 'insight_date'))
        const live = slices.filter(slice => slice.date === today).map(slice => sliceRow(account.accountId, slice, 'snapshot_date'))
        await upsertChunks(supabase, 'meta_campaign_daily', daily)

        if (live.length === 0) {
          const { error } = await supabase.from('meta_campaign_today').delete().eq('account_id', account.accountId)
          if (error) throw new Error(error.message)
        } else {
          await upsertChunks(supabase, 'meta_campaign_today', live)
          const keep = new Set(live.map(row => String(row.campaign_id)))
          const { data: existing, error: readError } = await supabase
            .from('meta_campaign_today')
            .select('campaign_id')
            .eq('account_id', account.accountId)
          if (readError) throw new Error(readError.message)
          const stale = (existing ?? []).map(row => String(row.campaign_id)).filter(id => !keep.has(id))
          if (stale.length) {
            const { error } = await supabase.from('meta_campaign_today').delete()
              .eq('account_id', account.accountId)
              .in('campaign_id', stale)
            if (error) throw new Error(error.message)
          }
        }

        const catalogPage = await paged(campaignsUrl(account.accountId, token))
        let deliveryKnown = true
        let activeAds = new Map<string, number>()
        let activeAdsets = new Map<string, number>()
        try {
          activeAds = countByCampaign(await paged(deliveryUrl('ads', account.accountId, token)))
          activeAdsets = countByCampaign(await paged(deliveryUrl('adsets', account.accountId, token)))
        } catch (error) {
          deliveryKnown = false
          notes.push(`${account.name}: מצב המודעות לא נקרא, נשענים על סטטוס הקמפיין (${stripSecrets(error instanceof Error ? error.message : 'ads').slice(0, 120)})`)
        }
        const catalog = new Map<string, Record<string, unknown>>()
        const putCampaign = (id: string, name: string, status: string, currency: string) => {
          catalog.set(id, {
            account_id: account.accountId,
            campaign_id: id,
            campaign_name: name,
            currency,
            effective_status: status,
            delivering: deliveryKnown ? (activeAds.get(id) ?? 0) > 0 : null,
            active_ads: deliveryKnown ? (activeAds.get(id) ?? 0) : null,
            active_adsets: deliveryKnown ? (activeAdsets.get(id) ?? 0) : null,
            updated_at: new Date().toISOString(),
          })
        }
        for (const row of catalogPage) {
          const id = String(row.id ?? '')
          if (!id) continue
          putCampaign(id, String(row.name ?? id), String(row.effective_status ?? ''), account.currency)
        }
        for (const slice of slices) {
          if (!catalog.has(slice.campaignId)) {
            putCampaign(slice.campaignId, slice.campaignName, '', slice.currency || account.currency)
          }
        }
        await upsertCampaigns(supabase, [...catalog.values()])
        try {
          await syncAdDepth(supabase, account.accountId, account.currency, token, insightSince, insightUntil)
        } catch (error) {
          notes.push(`${account.name}: ad insights ${stripSecrets(error instanceof Error ? error.message : 'failed')}`.slice(0, 220))
        }
        dailyRows += daily.length
        todayRows += live.length
        syncedAccounts += 1
      } catch (error) {
        failed += 1
        notes.push(`${account.name}: ${stripSecrets(error instanceof Error ? error.message : 'sync failed')}`.slice(0, 300))
      }
    }

    const ok = failed === 0
    if (ok && mode === 'backfill') {
      await supabase.from('meta_sync_state').upsert({
        id: 'default',
        oldest_date: plan.nextOldest,
        updated_at: new Date().toISOString(),
      })
    }
    const message = notes.join(' | ').slice(0, 500)
    await supabase.from('meta_sync_log').insert({
      started_at: started,
      finished_at: new Date().toISOString(),
      ok,
      accounts: syncedAccounts,
      rows_daily: dailyRows,
      rows_today: todayRows,
      message,
    })
    const floor = addDaysISO(today, -HISTORY_FLOOR_DAYS)
    return json({
      ok,
      mode,
      today,
      accounts: syncedAccounts,
      failed,
      daily_rows: dailyRows,
      today_rows: todayRows,
      next_oldest: plan.nextOldest,
      history_floor: floor,
      caught_up: plan.nextOldest <= floor,
      notes,
    })
  } catch (error) {
    const message = stripSecrets(error instanceof Error ? error.message : 'sync failed').slice(0, 500)
    await supabase.from('meta_sync_log').insert({
      started_at: started,
      finished_at: new Date().toISOString(),
      ok: false,
      accounts: 0,
      rows_daily: 0,
      rows_today: 0,
      message,
    })
    return json({ ok: false, error: message }, 500)
  }
})
