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

async function graphGet(url: string): Promise<Record<string, unknown>> {
  assertMetaRead(url, 'GET')
  const response = await fetch(url, { method: 'GET' })
  const text = await response.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(stripSecrets(text).slice(0, 240))
  }
  const error = data.error as { message?: string } | undefined
  if (error) throw new Error(stripSecrets(error.message || 'Meta error'))
  return data
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
  if (req.method === 'POST') {
    try {
      const body = await req.json() as { backfill_days?: number }
      if (typeof body?.backfill_days === 'number') backfillDays = body.backfill_days
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
    const plan = planFetchSpans(today, backfillDays, oldest)
    const dates = accountDatesForSpans(plan.spans)

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
        dailyRows += daily.length
        todayRows += live.length
        syncedAccounts += 1
      } catch (error) {
        failed += 1
        notes.push(`${account.name}: ${stripSecrets(error instanceof Error ? error.message : 'sync failed')}`.slice(0, 300))
      }
    }

    const ok = failed === 0
    if (ok) {
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
