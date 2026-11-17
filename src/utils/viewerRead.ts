import { supabase } from './supabase'
import { VIEWER_PAGE_SIZE, redactJson } from './accessRole'

/** Tables a viewer may page. Keep this list identical to v_allowed in schema_viewer_role.sql. */
export const VIEWER_TABLES = [
  'reports',
  'positions',
  'pipeline_companies',
  'tasks',
  'candidates',
  'wa_inbox',
  'meta_campaign_daily',
  'meta_campaign_today',
  'meta_campaigns',
  'meta_campaign_positions',
  'meta_ad_accounts',
  'meta_ads_settings',
  'meta_ads',
  'meta_ad_placement_insights_daily',
] as const

export type ViewerTable = (typeof VIEWER_TABLES)[number]

export interface ViewerFilter {
  insight_date_gte?: string
  insight_date_lte?: string
  snapshot_date?: string
}

const PAGE_CAP = 20000

export function isMissingViewerRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const message = error.message || ''
  return error.code === 'PGRST202'
    || /could not find the function|schema cache/i.test(message) && /viewer_read_page/i.test(message)
    || /viewer_read_page/i.test(message) && /does not exist/i.test(message)
}

export async function readViewerPage<T>(table: ViewerTable, offset: number, filter: ViewerFilter = {}): Promise<T[]> {
  const { data, error } = await supabase.rpc('viewer_read_page', {
    p_table: table,
    p_limit: VIEWER_PAGE_SIZE,
    p_offset: offset,
    p_filter: filter,
  })
  if (error) throw error
  const payload = typeof data === 'string' ? JSON.parse(data) as unknown : data
  const rows = Array.isArray(payload) ? payload as T[] : []
  return rows.map(row => redactJson(row))
}

/** Every page is at most 50 rows. Stops on a short page. Caps the walk so a bug cannot loop forever. */
export async function readViewerPages<T>(table: ViewerTable, filter: ViewerFilter = {}): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; offset < PAGE_CAP; offset += VIEWER_PAGE_SIZE) {
    const page = await readViewerPage<T>(table, offset, filter)
    rows.push(...page)
    if (page.length < VIEWER_PAGE_SIZE) break
  }
  return rows
}
