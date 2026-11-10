import type { DailyReport, SavedPosition, PipelineCompany, Task, Candidate, WaInboxLead, WaSessionState } from '../types'
import { mergeCandidateSave } from './wa'
import { supabase } from './supabase'

// ── Reports ──────────────────────────────────────────────────────────────────

export async function loadReports(): Promise<DailyReport[]> {
  const { data, error } = await supabase
    .from('reports')
    .select('data')
    .order('date', { ascending: false })
  if (error) { console.error('loadReports:', error); return [] }
  return (data ?? []).map(row => row.data as DailyReport)
}

export async function upsertReport(report: DailyReport): Promise<void> {
  const { error } = await supabase.from('reports').upsert({
    id:         report.id,
    date:       report.date,
    data:       report,
    updated_at: new Date().toISOString(),
  })
  if (error) console.error('upsertReport:', error)
}

export async function deleteReport(id: string): Promise<void> {
  const { error } = await supabase.from('reports').delete().eq('id', id)
  if (error) console.error('deleteReport:', error)
}

// ── Positions ─────────────────────────────────────────────────────────────────

export async function loadPositions(): Promise<SavedPosition[]> {
  const { data, error } = await supabase.from('positions').select('data')
  if (error) { console.error('loadPositions:', error); return [] }
  return (data ?? []).map(row => {
    const p = row.data as Record<string, unknown>
    return {
      funnelSentToClient: 0, funnelInterviews: 0,
      funnelAccepted: 0,     funnelConfirmed:  0,
      ...p,
    } as SavedPosition
  })
}

export async function savePositions(positions: SavedPosition[]): Promise<void> {
  const { data: existing } = await supabase.from('positions').select('id')
  const existingIds = (existing ?? []).map(r => r.id as string)
  const newIds      = positions.map(p => p.id)
  const toDelete    = existingIds.filter(id => !newIds.includes(id))

  if (toDelete.length > 0) {
    await supabase.from('positions').delete().in('id', toDelete)
  }
  if (positions.length > 0) {
    const { error } = await supabase.from('positions').upsert(
      positions.map(p => ({ id: p.id, data: p }))
    )
    if (error) console.error('savePositions:', error)
  }
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export async function loadPipeline(): Promise<PipelineCompany[]> {
  const { data, error } = await supabase.from('pipeline_companies').select('data')
  if (error) { console.error('loadPipeline:', error); return [] }
  return (data ?? []).map(row => row.data as PipelineCompany)
}

export async function savePipeline(companies: PipelineCompany[]): Promise<void> {
  const { data: existing } = await supabase.from('pipeline_companies').select('id')
  const existingIds = (existing ?? []).map(r => r.id as string)
  const newIds      = companies.map(c => c.id)
  const toDelete    = existingIds.filter(id => !newIds.includes(id))

  if (toDelete.length > 0) {
    await supabase.from('pipeline_companies').delete().in('id', toDelete)
  }
  if (companies.length > 0) {
    const { error } = await supabase.from('pipeline_companies').upsert(
      companies.map(c => ({ id: c.id, data: c }))
    )
    if (error) console.error('savePipeline:', error)
  }
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function loadTasks(): Promise<Task[]> {
  const { data, error } = await supabase.from('tasks').select('data')
  if (error) { console.error('loadTasks:', error); return [] }
  return (data ?? []).map(row => row.data as Task)
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  const { data: existing } = await supabase.from('tasks').select('id')
  const existingIds = (existing ?? []).map(r => r.id as string)
  const newIds      = tasks.map(t => t.id)
  const toDelete    = existingIds.filter(id => !newIds.includes(id))

  if (toDelete.length > 0) {
    await supabase.from('tasks').delete().in('id', toDelete)
  }
  if (tasks.length > 0) {
    const { error } = await supabase.from('tasks').upsert(
      tasks.map(t => ({ id: t.id, data: t }))
    )
    if (error) console.error('saveTasks:', error)
  }
}

// ── Candidates ────────────────────────────────────────────────────────────────

function missingCampaignColumns(message: string): boolean {
  return /meta_account_id|meta_campaign_id|meta_adset_id|meta_ad_id|schema cache|could not find the/i.test(message)
}

export async function loadCandidates(): Promise<Candidate[]> {
  const withColumns = await supabase
    .from('candidates')
    .select('data, meta_account_id, meta_campaign_id, meta_adset_id, meta_ad_id')
    .order('updated_at', { ascending: false })
  const rows = withColumns.error && missingCampaignColumns(withColumns.error.message)
    ? await supabase.from('candidates').select('data').order('updated_at', { ascending: false })
    : withColumns
  if (rows.error) { console.error('loadCandidates:', rows.error); return [] }
  return (rows.data ?? []).map(row => {
    const candidate = row.data as Candidate
    const extra = row as { meta_account_id?: string | null; meta_campaign_id?: string | null; meta_adset_id?: string | null; meta_ad_id?: string | null }
    if (!candidate.metaAccountId && extra.meta_account_id) candidate.metaAccountId = extra.meta_account_id
    if (!candidate.metaCampaignId && extra.meta_campaign_id) candidate.metaCampaignId = extra.meta_campaign_id
    if (!candidate.metaAdsetId && extra.meta_adset_id) candidate.metaAdsetId = extra.meta_adset_id
    if (!candidate.metaAdId && extra.meta_ad_id) candidate.metaAdId = extra.meta_ad_id
    return candidate
  })
}

export async function upsertCandidate(candidate: Candidate): Promise<Candidate> {
  const { data: freshRow, error: readErr } = await supabase
    .from('candidates').select('data').eq('id', candidate.id).maybeSingle()
  if (readErr) throw new Error(readErr.message)
  const merged = mergeCandidateSave(freshRow?.data as Candidate | undefined, candidate)
  const base = { id: merged.id, data: merged, updated_at: new Date().toISOString() }
  const full = {
    ...base,
    meta_account_id: merged.metaAccountId || null,
    meta_campaign_id: merged.metaCampaignId || null,
    meta_adset_id: merged.metaAdsetId || null,
    meta_ad_id: merged.metaAdId || null,
  }
  const campaignOnly = {
    ...base,
    meta_account_id: merged.metaAccountId || null,
    meta_campaign_id: merged.metaCampaignId || null,
  }
  let { error } = await supabase.from('candidates').upsert(full)
  if (error && /meta_adset_id|meta_ad_id/i.test(error.message)) {
    const retry = await supabase.from('candidates').upsert(campaignOnly)
    error = retry.error
  }
  if (error && missingCampaignColumns(error.message)) {
    const retry = await supabase.from('candidates').upsert(base)
    error = retry.error
  }
  if (error) throw new Error(error.message)
  return merged
}

export interface WaInboxLoad {
  rows: WaInboxLead[]
  session: WaSessionState | null
  error: string | null
}

export async function loadWaInbox(): Promise<WaInboxLoad> {
  const { data, error } = await supabase.from('wa_inbox').select('data').order('updated_at', { ascending: false })
  if (error) return { rows: [], session: null, error: error.message }
  const rows: WaInboxLead[] = []
  let session: WaSessionState | null = null
  for (const row of data ?? []) {
    const item = row.data as (WaInboxLead & Partial<WaSessionState>) | null
    if (!item || typeof item !== 'object') continue
    if (item.id === 'wa_session' || item.kind === 'session') {
      session = item as WaSessionState
      continue
    }
    rows.push(item)
  }
  return { rows, session, error: null }
}

export async function markCandidateWaRead(id: string): Promise<Candidate | null> {
  const { data, error } = await supabase.from('candidates').select('data').eq('id', id).maybeSingle()
  if (error || !data?.data) return null
  const c = data.data as Candidate
  if (!c.waUnread) return c
  const next: Candidate = { ...c, waUnread: 0 }
  const { error: writeErr } = await supabase.from('candidates').upsert({
    id,
    data: next,
    updated_at: new Date().toISOString(),
  })
  if (writeErr) return null
  return next
}

export async function markWaInboxRead(id: string): Promise<WaInboxLead | null> {
  const { data, error } = await supabase.from('wa_inbox').select('data').eq('id', id).maybeSingle()
  if (error || !data?.data) return null
  const lead = data.data as WaInboxLead
  if (!lead.unread) return lead
  const next: WaInboxLead = { ...lead, unread: 0, updatedAt: new Date().toISOString() }
  const { error: writeErr } = await supabase.from('wa_inbox').upsert({ id, data: next, updated_at: next.updatedAt })
  if (writeErr) return null
  return next
}

export async function linkWaInbox(id: string, candidateId: string): Promise<WaInboxLead | null> {
  const { data, error } = await supabase.from('wa_inbox').select('data').eq('id', id).maybeSingle()
  if (error || !data?.data) return null
  const lead = data.data as WaInboxLead
  const next: WaInboxLead = { ...lead, candidateId, unread: 0, updatedAt: new Date().toISOString() }
  const { error: writeErr } = await supabase.from('wa_inbox').upsert({ id, data: next, updated_at: next.updatedAt })
  if (writeErr) return null
  return next
}

export async function deleteCandidate(id: string): Promise<void> {
  const { error } = await supabase.from('candidates').delete().eq('id', id)
  if (error) console.error('deleteCandidate:', error)
}

// ── One-time migration from localStorage ─────────────────────────────────────
// Runs automatically on first load if Supabase is empty

export async function migrateFromLocalStorage(): Promise<{
  reports: DailyReport[]; positions: SavedPosition[];
  pipeline: PipelineCompany[]; tasks: Task[]
}> {
  const parse = <T>(key: string): T[] => {
    try { return JSON.parse(localStorage.getItem(key) ?? '[]') as T[] }
    catch { return [] }
  }

  const localReports   = parse<DailyReport>('bleaz_daily_reports')
  const localPositions = parse<SavedPosition>('bleaz_saved_positions')
  const localPipeline  = parse<PipelineCompany>('bleaz_pipeline_companies')
  const localTasks     = parse<Task>('bleaz_tasks')

  const hasLocal = localReports.length > 0 || localPositions.length > 0

  if (hasLocal) {
    await Promise.all([
      ...localReports.map(r => upsertReport(r)),
      savePositions(localPositions),
      savePipeline(localPipeline),
      saveTasks(localTasks),
    ])
    // Clear localStorage after migration
    localStorage.removeItem('bleaz_daily_reports')
    localStorage.removeItem('bleaz_saved_positions')
    localStorage.removeItem('bleaz_pipeline_companies')
    localStorage.removeItem('bleaz_tasks')
  }

  return {
    reports:  localReports,
    positions: localPositions,
    pipeline:  localPipeline,
    tasks:     localTasks,
  }
}
