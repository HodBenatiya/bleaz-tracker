import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'

type DayRow = {
  day: string
  views: number
  clicks: number
  click_rate: number | string | null
}

function rateLabel(value: number | string | null): string {
  if (value == null || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function dayLabel(day: string): string {
  const [year, month, date] = day.slice(0, 10).split('-').map(Number)
  if (!year || !month || !date) return day
  return new Date(year, month - 1, date).toLocaleDateString('he-IL')
}

/** Read-only daily counts from landing_events_daily. Does not write. */
export default function LandingStatsCard() {
  const [rows, setRows] = useState<DayRow[] | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('landing_events_daily')
      .select('day, views, clicks, click_rate')
      .order('day', { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setRows([])
          setMissing(true)
          return
        }
        setRows((data ?? []) as DayRow[])
      })
    return () => { cancelled = true }
  }, [])

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <h2 className="text-base font-bold text-slate-800">דף נחיתה: צפיות / לחיצות וואטסאפ</h2>
      {rows == null && <p className="text-sm text-slate-400 mt-3">טוען…</p>}
      {rows != null && missing && (
        <p className="text-sm text-slate-400 mt-3">הנתונים יופיעו אחרי הרצת schema_landing_events.sql</p>
      )}
      {rows != null && !missing && rows.length === 0 && (
        <p className="text-sm text-slate-400 mt-3">אין צפיות עדיין</p>
      )}
      {rows != null && !missing && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="text-slate-400 text-xs">
                <th className="font-medium pb-2">יום</th>
                <th className="font-medium pb-2">צפיות</th>
                <th className="font-medium pb-2">לחיצות</th>
                <th className="font-medium pb-2">אחוז לחיצה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.day} className="border-t border-slate-100 text-slate-700">
                  <td className="py-1.5">{dayLabel(row.day)}</td>
                  <td className="py-1.5">{row.views}</td>
                  <td className="py-1.5">{row.clicks}</td>
                  <td className="py-1.5">{rateLabel(row.click_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
