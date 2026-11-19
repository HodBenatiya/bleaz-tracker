import { useEffect, useState } from 'react'
import type { Candidate } from '../types'
import { CANDIDATE_STATUS_LABELS, type CandidateStatus } from '../types'
import {
  organicJobName,
  summarizeOrganicLeads,
  summarizeGoClicks,
  summarizeOrganicWindow,
  humanClicksByJob,
  organicPresetRange,
  type OrganicDayJob,
  type OrganicPreset,
  type GoClickRow,
  type ClickSummary,
} from '../utils/organicJobs'
import { supabase } from '../utils/supabase'

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
        setClicks(summarizeGoClicks((data ?? []) as GoClickRow[]))
        setClicksState('ready')
      })
    return () => { cancelled = true }
  }, [])

  return <OrganicLeadsCardView leads={leads} clicks={clicks} clicksState={clicksState} />
}

function statusLabel(status: string): string {
  return CANDIDATE_STATUS_LABELS[status as CandidateStatus] || status || '—'
}

/** Compact dashboard tile. Counts come from the same helpers as the management card. */
export function OrganicLeadsTile({
  candidates,
  onOpenCandidate,
}: {
  candidates: Candidate[]
  onOpenCandidate?: (id: string) => void
}) {
  const [preset, setPreset] = useState<OrganicPreset>('week')
  const [open, setOpen] = useState(false)
  const [jobKey, setJobKey] = useState<string | null>(null)
  const [rows, setRows] = useState<GoClickRow[] | null>(null)
  const [clicksState, setClicksState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const range = organicPresetRange(preset)
  const window = summarizeOrganicWindow(candidates, range.start, range.end)
  const clicks = humanClicksByJob(rows ?? [], range.start, range.end)

  useEffect(() => {
    let cancelled = false
    const since = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    supabase
      .from('go_clicks')
      .select('job_id, variant, group_id, created_at, is_bot')
      .eq('is_bot', false)
      .gte('created_at', since)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setRows(null)
          setClicksState('missing')
          return
        }
        setRows((data ?? []) as GoClickRow[])
        setClicksState('ready')
      })
    return () => { cancelled = true }
  }, [])

  const jobs = [...window.jobs]
  for (const [id, count] of Object.entries(clicks)) {
    const jobId = Number(id)
    if (!count || jobs.some(job => job.jobId === jobId)) continue
    jobs.push({ jobId, leads: 0, relevant: 0, notRelevant: 0, inProcess: 0, people: [] })
  }
  const selected = jobs.find(job => String(job.jobId ?? '') === jobKey) ?? null

  return (
    <>
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <button type="button" onClick={() => setOpen(true)} className="text-right min-w-0">
            <p className="text-xs text-slate-500">לידים מאורגני</p>
            <p className="text-2xl font-black text-slate-900">{window.leads}</p>
            <p className="text-[11px] text-slate-400">{range.label}</p>
          </button>
          <div className="flex flex-wrap gap-1">
            {(['today', 'week', 'month'] as OrganicPreset[]).map(item => (
              <button
                key={item}
                type="button"
                onClick={() => setPreset(item)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${preset === item ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {item === 'today' ? 'היום' : item === 'week' ? '7 ימים' : 'החודש'}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="grid grid-cols-3 gap-2 mt-3 w-full text-center">
          <span className="rounded-xl bg-emerald-50 px-2 py-2"><span className="block text-[10px] text-emerald-700">רלוונטי</span><span className="font-black text-emerald-800">{window.relevant}</span></span>
          <span className="rounded-xl bg-red-50 px-2 py-2"><span className="block text-[10px] text-red-700">לא רלוונטי</span><span className="font-black text-red-800">{window.notRelevant}</span></span>
          <span className="rounded-xl bg-slate-50 px-2 py-2"><span className="block text-[10px] text-slate-500">בתהליך</span><span className="font-black text-slate-800">{window.inProcess}</span></span>
        </button>
      </section>
      {open && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-2" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-4" dir="rtl" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-slate-800">לידים מאורגני · {range.label}</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">סגור</button>
            </div>
            {clicksState === 'missing' && <p className="text-xs text-slate-400 mt-2">לחיצות /go יופיעו אחרי טבלאות הלחיצות</p>}
            <div className="mt-3 space-y-2">
              {jobs.length === 0 && <p className="text-sm text-slate-400">אין לידים בטווח</p>}
              {jobs.map(job => {
                const key = String(job.jobId ?? '')
                const name = job.jobId == null ? '—' : (organicJobName(job.jobId) || String(job.jobId))
                const clickCount = job.jobId == null ? 0 : (clicks[job.jobId] ?? 0)
                return (
                  <div key={key || 'x'} className="rounded-xl border border-slate-200">
                    <button type="button" onClick={() => setJobKey(current => current === key ? null : key)} className="w-full text-right px-3 py-2">
                      <div className="font-semibold text-slate-800 text-sm">{name}</div>
                      <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>{job.leads} לידים</span>
                        <span>{job.relevant} רלוונטי</span>
                        <span>{job.notRelevant} לא רלוונטי</span>
                        <span>{job.inProcess} בתהליך</span>
                        <span>{clickCount} לחיצות</span>
                      </div>
                    </button>
                    {selected && String(selected.jobId ?? '') === key && (
                      <div className="border-t border-slate-100 divide-y divide-slate-100">
                        {job.people.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">אין מועמדים להצגה</p>}
                        {job.people.map(person => (
                          <button
                            key={person.id}
                            type="button"
                            onClick={() => onOpenCandidate?.(person.id)}
                            className="w-full text-right px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50"
                          >
                            <span className="font-medium text-sm text-slate-800 truncate">{person.name}</span>
                            <span className="text-[11px] text-slate-500 shrink-0">{statusLabel(person.status)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
