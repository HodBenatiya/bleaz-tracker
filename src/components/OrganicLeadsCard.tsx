import { useEffect, useState } from 'react'
import type { Candidate } from '../types'
import {
  organicJobName,
  summarizeOrganicLeads,
  type OrganicDayJob,
  jerusalemDay,
  recentJerusalemDays,
} from '../utils/organicJobs'
import { supabase } from '../utils/supabase'

type ClickRow = {
  job_id: number
  variant: string | null
  group_id: string | null
  created_at: string
  is_bot?: boolean
}

export interface ClickSummary {
  day: string
  jobId: number
  variant: string | null
  groupId: string | null
  clicks: number
}

function dayLabel(day: string): string {
  const [year, month, date] = day.slice(0, 10).split('-').map(Number)
  if (!year || !month || !date) return day
  return new Date(year, month - 1, date).toLocaleDateString('he-IL')
}

function jobLabel(jobId: number | null): string {
  if (jobId == null) return '—'
  const name = organicJobName(jobId)
  return name ? `${jobId} · ${name}` : String(jobId)
}

export function summarizeGoClicks(rows: ClickRow[], now = new Date()): ClickSummary[] {
  const days = new Set(recentJerusalemDays(14, now))
  const grouped = new Map<string, ClickSummary>()
  for (const row of rows) {
    const day = jerusalemDay(row.created_at)
    if (row.is_bot) continue
    if (!day || !days.has(day)) continue
    const variant = row.variant || null
    const groupId = row.group_id || null
    const key = `${day}:${row.job_id}:${variant ?? ''}:${groupId ?? ''}`
    const current = grouped.get(key) ?? { day, jobId: row.job_id, variant, groupId, clicks: 0 }
    current.clicks += 1
    grouped.set(key, current)
  }
  return [...grouped.values()].sort((a, b) => (
    b.day.localeCompare(a.day) || a.jobId - b.jobId || String(a.variant ?? '').localeCompare(String(b.variant ?? ''))
  ))
}

export function OrganicLeadsCardView({
  leads,
  clicks,
  clicksState,
}: {
  leads: OrganicDayJob[]
  clicks: ClickSummary[] | null
  clicksState: 'loading' | 'ready' | 'missing'
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <h2 className="text-base font-bold text-slate-800">Organic leads</h2>
      <p className="text-xs text-slate-400 mt-1">14 הימים האחרונים, לפי יום ומשרה. אחרי סינון.</p>
      {leads.length === 0 && (
        <p className="text-sm text-slate-400 mt-3">אין לידים אורגניים ב-14 הימים האחרונים</p>
      )}
      {leads.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm text-right min-w-[28rem]">
            <thead>
              <tr className="text-slate-400 text-xs">
                <th className="font-medium pb-2">יום</th>
                <th className="font-medium pb-2">משרה</th>
                <th className="font-medium pb-2">לידים</th>
                <th className="font-medium pb-2">רלוונטיים</th>
                <th className="font-medium pb-2">לא רלוונטיים</th>
                <th className="font-medium pb-2">בתהליך</th>
              </tr>
            </thead>
            <tbody>
              {leads.map(row => (
                <tr key={`${row.day}-${row.jobId ?? 'x'}`} className="border-t border-slate-100 text-slate-700">
                  <td className="py-1.5 whitespace-nowrap">{dayLabel(row.day)}</td>
                  <td className="py-1.5">{jobLabel(row.jobId)}</td>
                  <td className="py-1.5">{row.leads}</td>
                  <td className="py-1.5">{row.relevant}</td>
                  <td className="py-1.5">{row.notRelevant}</td>
                  <td className="py-1.5">{row.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {clicksState === 'loading' && <p className="text-sm text-slate-400 mt-4">טוען לחיצות…</p>}
      {clicksState === 'missing' && (
        <p className="text-sm text-slate-400 mt-4">לחיצות /go יופיעו אחרי schema_go_clicks.sql, schema_go_clicks_variant.sql ו-schema_go_clicks_bot.sql</p>
      )}
      {clicksState === 'ready' && clicks && clicks.length === 0 && (
        <p className="text-sm text-slate-400 mt-4">אין לחיצות /go ב-14 הימים האחרונים</p>
      )}
      {clicksState === 'ready' && clicks && clicks.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">לחיצות /go</h3>
          <table className="w-full text-sm text-right min-w-[28rem]">
            <thead>
              <tr className="text-slate-400 text-xs">
                <th className="font-medium pb-2">יום</th>
                <th className="font-medium pb-2">משרה</th>
                <th className="font-medium pb-2">גרסה</th>
                <th className="font-medium pb-2">קבוצה</th>
                <th className="font-medium pb-2">לחיצות</th>
              </tr>
            </thead>
            <tbody>
              {clicks.map(row => (
                <tr key={`${row.day}-${row.jobId}-${row.variant ?? ''}-${row.groupId ?? ''}`} className="border-t border-slate-100 text-slate-700">
                  <td className="py-1.5 whitespace-nowrap">{dayLabel(row.day)}</td>
                  <td className="py-1.5">{jobLabel(row.jobId)}</td>
                  <td className="py-1.5">{row.variant ?? '—'}</td>
                  <td className="py-1.5">{row.groupId ?? '—'}</td>
                  <td className="py-1.5">{row.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** Read-only. Leads come from candidates already loaded. Clicks are selected, never written. */
export default function OrganicLeadsCard({ candidates }: { candidates: Candidate[] }) {
  const [clicks, setClicks] = useState<ClickSummary[] | null>(null)
  const [clicksState, setClicksState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const leads = summarizeOrganicLeads(candidates)

  useEffect(() => {
    let cancelled = false
    const since = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
    supabase
      .from('go_clicks')
      .select('job_id, variant, group_id, created_at, is_bot')
      .eq('is_bot', false)
      .gte('created_at', since)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setClicks(null)
          setClicksState('missing')
          return
        }
        setClicks(summarizeGoClicks((data ?? []) as ClickRow[]))
        setClicksState('ready')
      })
    return () => { cancelled = true }
  }, [])

  return <OrganicLeadsCardView leads={leads} clicks={clicks} clicksState={clicksState} />
}
