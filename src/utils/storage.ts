import type { DailyReport, SavedPosition, PipelineCompany, Task } from '../types'
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
