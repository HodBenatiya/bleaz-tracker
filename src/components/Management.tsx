import { useState } from 'react'
import { ChevronRight, ChevronLeft, ChevronDown, Edit2, Check, X, TrendingUp, DollarSign, Users, Clock, AlertCircle, CalendarCheck } from 'lucide-react'
import type { Candidate, SavedPosition, DailyReport } from '../types'

const PLACEMENT_FEE = 5000

interface Props {
  candidates:         Candidate[]
  positions:          SavedPosition[]
  reports:            DailyReport[]
  onCandidatesChange: (updated: Candidate[]) => void
}

// ── Warranty ──────────────────────────────────────────────────────────────────

function warrantyDays(c: Candidate, positions: SavedPosition[]): number {
  const ids = c.savedPositionIds?.length
    ? c.savedPositionIds
    : c.savedPositionId ? [c.savedPositionId] : []
  const pos = ids.map(id => positions.find(p => p.id === id)).find(Boolean)
  return (pos?.companyName ?? '').toUpperCase().includes('BINGO') ? 45 : 30
}

function warrantyEnd(c: Candidate, positions: SavedPosition[]): Date | null {
  if (!c.startDate) return null
  const d = new Date(c.startDate + 'T12:00:00')
  d.setDate(d.getDate() + warrantyDays(c, positions))
  return d
}

// ── Month helpers ─────────────────────────────────────────────────────────────

type MonthFilter = { year: number; month: number }

function currentMonth(): MonthFilter {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}
function prevM(f: MonthFilter): MonthFilter {
  return f.month === 1 ? { year: f.year - 1, month: 12 } : { year: f.year, month: f.month - 1 }
}
function nextM(f: MonthFilter): MonthFilter {
  return f.month === 12 ? { year: f.year + 1, month: 1 } : { year: f.year, month: f.month + 1 }
}
function isCurrent(f: MonthFilter): boolean {
  const d = new Date()
  return f.year === d.getFullYear() && f.month === d.getMonth() + 1
}
function monthLabel(f: MonthFilter): string {
  return new Date(f.year, f.month - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
}
function inMonth(dateStr: string | undefined, f: MonthFilter): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  return d.getFullYear() === f.year && d.getMonth() + 1 === f.month
}
function daysInMonth(f: MonthFilter): number {
  return new Date(f.year, f.month, 0).getDate()
}

// ── Goal storage (localStorage — per month, shared target) ───────────────────

const goalKey = (f: MonthFilter) => `bleaz_goal_${f.year}_${f.month}`
function loadGoal(f: MonthFilter): number {
  try { return parseInt(localStorage.getItem(goalKey(f)) ?? '0', 10) || 0 } catch { return 0 }
}
function persistGoal(f: MonthFilter, n: number): void {
  try { localStorage.setItem(goalKey(f), String(n)) } catch {}
}

// ── Pace ──────────────────────────────────────────────────────────────────────

function paceBar(actual: number, target: number, f: MonthFilter): string {
  if (target === 0) return 'bg-slate-300'
  const elapsed = isCurrent(f) ? new Date().getDate() / daysInMonth(f) : 1
  const expected = target * elapsed
  if (expected === 0) return 'bg-green-500'
  const ratio = actual / expected
  if (ratio >= 0.85) return 'bg-green-500'
  if (ratio >= 0.5)  return 'bg-amber-400'
  return 'bg-red-500'
}

function paceMsg(actual: number, target: number, f: MonthFilter): string {
  if (target === 0) return 'הגדר יעד לחודש'
  if (!isCurrent(f)) return actual >= target ? '✅ יעד הושג' : `${target - actual} חסרות ליעד`
  const elapsed  = new Date().getDate() / daysInMonth(f)
  const expected = Math.round(target * elapsed * 10) / 10
  if (actual >= target)  return '🏆 יעד הושג!'
  const behind = Math.round((expected - actual) * 10) / 10
  if (behind <= 0) return '🟢 בקצב טוב'
  return `🔴 אחורה ב-${behind} מהקצב`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' })
}
function fmtNum(n: number): string {
  return n.toLocaleString('he-IL')
}

// ── Week helpers ──────────────────────────────────────────────────────────────

function getWeekBounds(offset: number): { start: Date; end: Date; label: string } {
  const now = new Date()
  const day = now.getDay() // 0 = Sunday (Israeli week starts Sunday)
  const sunday = new Date(now)
  sunday.setDate(now.getDate() - day + offset * 7)
  sunday.setHours(0, 0, 0, 0)
  const saturday = new Date(sunday)
  saturday.setDate(sunday.getDate() + 6)
  saturday.setHours(23, 59, 59, 999)
  const fmt = (d: Date) => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
  const label = offset === 0 ? 'השבוע' : offset === -1 ? 'שבוע שעבר' : `${fmt(sunday)}–${fmt(saturday)}`
  return { start: sunday, end: saturday, label }
}

function candidateCompany(c: Candidate, positions: SavedPosition[]): string {
  const ids = c.savedPositionIds?.length ? c.savedPositionIds : c.savedPositionId ? [c.savedPositionId] : []
  const pos = ids.map(id => positions.find(p => p.id === id)).find(Boolean)
  return pos?.companyName ?? c.positionType ?? '—'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Management({ candidates, positions, reports, onCandidatesChange }: Props) {
  const [filter,         setFilter]         = useState<MonthFilter>(currentMonth)
  const [target,         setTarget]         = useState(() => loadGoal(currentMonth()))
  const [editGoal,       setEditGoal]       = useState(false)
  const [goalInput,      setGoalInput]      = useState('')
  const [showPlacements, setShowPlacements] = useState(false)

  function changeFilter(f: MonthFilter) {
    setFilter(f)
    setTarget(loadGoal(f))
    setEditGoal(false)
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  // Placements = started or fully completed, with startDate in the selected month
  const placements = candidates.filter(c =>
    (c.status === 'started_working' || c.status === 'placement_complete') &&
    inMonth(c.startDate, filter)
  )

  // All active in pipeline (not new, not irrelevant)
  const inPipeline = candidates.filter(c =>
    ['sent_to_client', 'interview_scheduled', 'relevant', 'called', 'screening', 'call_scheduled', 'future_relevant'].includes(c.status)
  )

  const revenue = placements.length * PLACEMENT_FEE

  const marketingBudget = reports
    .filter(r => inMonth(r.date, filter))
    .reduce((sum, r) => sum + r.jobs.reduce((s, j) => s + (j.campaignCost || 0), 0), 0)

  const profit = revenue - marketingBudget

  const newLeads = candidates.filter(c => inMonth(c.createdAt, filter)).length

  const cac = placements.length > 0 ? Math.round(marketingBudget / placements.length) : null

  // מועמדים שהוגשו ללקוח החודש (נשלח ללקוח ומעלה, לפי תאריך יצירה)
  const submittedThisMonth = candidates.filter(c =>
    ['sent_to_client', 'interview_scheduled', 'started_working', 'placement_complete'].includes(c.status) &&
    inMonth(c.createdAt, filter)
  ).length
  const costPerSubmission = submittedThisMonth > 0 ? Math.round(marketingBudget / submittedThisMonth) : null

  // All placed candidates (ever) for collections table, newest first
  const allPlaced = candidates
    .filter(c => c.startDate && (c.status === 'started_working' || c.status === 'placement_complete'))
    .sort((a, b) => (b.startDate ?? '') > (a.startDate ?? '') ? 1 : -1)

  // Last 4 months for growth chart (oldest → newest)
  const last4: MonthFilter[] = [3, 2, 1, 0].map(i => {
    let f = currentMonth()
    for (let j = 0; j < i; j++) f = prevM(f)
    return f
  })

  const month4Counts = last4.map(f =>
    candidates.filter(c =>
      (c.status === 'started_working' || c.status === 'placement_complete') && inMonth(c.startDate, f)
    ).length
  )
  const max4 = Math.max(...month4Counts, 1)

  // ── Invoice update ────────────────────────────────────────────────────────

  function updateInvoice(c: Candidate, status: 'none' | 'sent' | 'paid') {
    const now_ = new Date().toISOString()
    const updated: Candidate = {
      ...c,
      invoiceStatus:   status,
      invoiceSentDate: status === 'sent' && !c.invoiceSentDate ? now_.split('T')[0] : c.invoiceSentDate,
      paidDate:        status === 'paid' && !c.paidDate       ? now_.split('T')[0] : c.paidDate,
      updatedAt:       now_,
    }
    onCandidatesChange(candidates.map(x => x.id === c.id ? updated : x))
  }

  // ── Invoice summary (pending/sent/paid totals) ────────────────────────────

  const invoiceCounts = allPlaced.reduce(
    (acc, c) => {
      const s = c.invoiceStatus ?? 'none'
      acc[s] = (acc[s] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-6xl mx-auto">

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">דשבורד ניהול</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => changeFilter(prevM(filter))}
            className="p-1.5 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 text-slate-500 transition">
            <ChevronRight size={18} />
          </button>
          <div className="relative px-3 py-1.5 rounded-lg bg-white border border-slate-200 min-w-36 text-center">
            <span className="text-sm font-semibold text-slate-700">{monthLabel(filter)}</span>
            {isCurrent(filter) && (
              <span className="absolute -top-2 right-2 text-[9px] bg-brand-600 text-white px-1.5 py-0.5 rounded-full">עכשיו</span>
            )}
          </div>
          <button onClick={() => changeFilter(nextM(filter))}
            disabled={isCurrent(filter)}
            className="p-1.5 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 text-slate-500 transition disabled:opacity-30">
            <ChevronLeft size={18} />
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          label="השמות החודש" value={placements.length}
          sub={`יעד: ${target || '—'}`}
          color="emerald" icon={<Users size={15} />}
          onClick={() => setShowPlacements(v => !v)}
          active={showPlacements}
        />
        <KpiCard
          label="לידים חדשים" value={newLeads}
          sub={`${inPipeline.length} בתהליך פעיל`}
          color="blue" icon={<Clock size={15} />}
        />
        <KpiCard
          label="הכנסות" value={`₪${fmtNum(revenue)}`}
          sub={`${placements.length} × ₪5,000`}
          color="green" icon={<DollarSign size={15} />}
        />
        <KpiCard
          label="תקציב שיווק" value={`₪${fmtNum(marketingBudget)}`}
          sub={[
            cac != null             ? `גיוס: ₪${fmtNum(cac)}`         : 'גיוס: —',
            costPerSubmission != null ? `הגשה: ₪${fmtNum(costPerSubmission)}` : 'הגשה: —',
          ].join(' · ')}
          color="orange" icon={<TrendingUp size={15} />}
        />
        <KpiCard
          label="רווח נקי" value={`₪${fmtNum(profit)}`}
          sub={marketingBudget > 0 ? `${Math.round((profit / revenue) * 100) || 0}% מרווח` : '—'}
          color={profit >= 0 ? 'purple' : 'red'} icon={<AlertCircle size={15} />}
        />
      </div>

      {/* Placements drill-down */}
      {showPlacements && (
        <div className="bg-white rounded-2xl border border-emerald-200 overflow-hidden">
          <div className="px-5 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
            <h3 className="font-bold text-emerald-800 text-sm">
              השמות {monthLabel(filter)} — {placements.length} מועמדים
            </h3>
            <button onClick={() => setShowPlacements(false)} className="text-emerald-500 hover:text-emerald-700 transition">
              <X size={16} />
            </button>
          </div>
          {placements.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-8">אין השמות בחודש זה</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {placements.map(c => {
                const company = candidateCompany(c, positions)
                const inv     = c.invoiceStatus ?? 'none'
                return (
                  <div key={c.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold shrink-0">
                        {c.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800 text-sm">{c.name}</div>
                        <div className="text-xs text-slate-500">{company}{c.startDate ? ` · ${fmtDate(c.startDate)}` : ''}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.estimatedSalary ? (
                        <span className="text-xs text-slate-400">₪{fmtNum(c.estimatedSalary)}/חודש</span>
                      ) : null}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        inv === 'paid' ? 'bg-green-100 text-green-700' :
                        inv === 'sent' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {inv === 'paid' ? 'שולם ✓' : inv === 'sent' ? 'נשלחה' : 'לא נשלחה'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 text-xs text-slate-500 flex justify-between">
            <span>סה"כ השמות החודש</span>
            <span className="font-semibold text-slate-700">₪{fmtNum(placements.length * PLACEMENT_FEE)}</span>
          </div>
        </div>
      )}

      {/* Goal + Marketing detailed — side by side */}
      <div className="grid md:grid-cols-2 gap-5">

        {/* Goal */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800">יעד חודשי — {monthLabel(filter)}</h3>
            {!editGoal ? (
              <button
                onClick={() => { setEditGoal(true); setGoalInput(String(target || '')) }}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-semibold transition">
                <Edit2 size={12} />
                {target ? 'ערוך' : 'הגדר יעד'}
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="number" min="0" max="99"
                  value={goalInput}
                  onChange={e => setGoalInput(e.target.value)}
                  className="input w-16 text-sm text-center py-1"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { const n = parseInt(goalInput, 10) || 0; setTarget(n); persistGoal(filter, n); setEditGoal(false) }
                    if (e.key === 'Escape') setEditGoal(false)
                  }}
                />
                <button onClick={() => { const n = parseInt(goalInput, 10) || 0; setTarget(n); persistGoal(filter, n); setEditGoal(false) }}
                  className="p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition">
                  <Check size={13} />
                </button>
                <button onClick={() => setEditGoal(false)}
                  className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition">
                  <X size={13} />
                </button>
              </div>
            )}
          </div>

          {/* Progress */}
          <div className="flex items-end justify-between mb-2">
            <span className="text-4xl font-black text-slate-800">{placements.length}</span>
            <span className="text-sm text-slate-400 pb-1">מתוך {target || '?'}</span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden mb-2">
            <div
              className={`h-full rounded-full transition-all duration-700 ${paceBar(placements.length, target, filter)}`}
              style={{ width: target > 0 ? `${Math.min(100, (placements.length / target) * 100)}%` : '0%' }}
            />
          </div>
          <p className="text-sm text-slate-500">{paceMsg(placements.length, target, filter)}</p>

          {/* Days remaining + forecast — only for current month */}
          {isCurrent(filter) && (() => {
            const totalDays    = daysInMonth(filter)
            const elapsed      = new Date().getDate()
            const remaining    = totalDays - elapsed
            const needed       = target > 0 ? Math.max(0, target - placements.length) : null
            const perDay       = needed != null && remaining > 0 ? (needed / remaining).toFixed(1) : null
            const forecast     = elapsed > 0
              ? Math.round((placements.length / elapsed) * totalDays)
              : 0
            return (
              <div className="mt-3 bg-slate-50 rounded-xl px-4 py-3 flex items-center justify-between gap-2">
                <div className="text-center">
                  <div className="text-xl font-black text-slate-700">{remaining}</div>
                  <div className="text-[10px] text-slate-400">ימים נותרו</div>
                </div>
                <div className="w-px h-8 bg-slate-200" />
                <div className="text-center">
                  <div className="text-xl font-black text-slate-700">{perDay ?? '—'}</div>
                  <div className="text-[10px] text-slate-400">גיוס/יום לסגירה</div>
                </div>
                <div className="w-px h-8 bg-slate-200" />
                <div className="text-center">
                  <div className={`text-xl font-black ${target > 0 && forecast >= target ? 'text-green-600' : 'text-amber-500'}`}>~{forecast}</div>
                  <div className="text-[10px] text-slate-400">תחזית חודש</div>
                </div>
              </div>
            )
          })()}

          {/* Upcoming interviews */}
          {(() => {
            const today = new Date().toISOString().split('T')[0]
            const in14  = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
            const upcoming = candidates
              .filter(c => c.status === 'interview_scheduled' && c.interviewDate && c.interviewDate >= today && c.interviewDate <= in14)
              .sort((a, b) => (a.interviewDate ?? '') > (b.interviewDate ?? '') ? 1 : -1)
              .slice(0, 4)
            if (upcoming.length === 0) return (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
                  <CalendarCheck size={13} />
                  <span className="font-semibold">ראיונות קרובים</span>
                </div>
                <p className="text-xs text-slate-400 text-center py-2">אין ראיונות מתוכננים ב-14 הימים הקרובים</p>
              </div>
            )
            return (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
                  <CalendarCheck size={13} className="text-brand-600" />
                  <span className="font-semibold">ראיונות קרובים</span>
                  <span className="mr-auto bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded-full text-[10px] font-bold">{upcoming.length}</span>
                </div>
                <div className="space-y-1.5">
                  {upcoming.map(c => {
                    const company = candidateCompany(c, positions)
                    const d       = new Date(c.interviewDate! + 'T12:00:00')
                    const isToday = c.interviewDate === today
                    const isTomorrow = c.interviewDate === new Date(Date.now() + 86400000).toISOString().split('T')[0]
                    const dayStr  = isToday ? 'היום' : isTomorrow ? 'מחר' : d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })
                    return (
                      <div key={c.id} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${isToday ? 'bg-brand-50 border border-brand-200' : 'bg-slate-50'}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isToday ? 'bg-brand-500' : 'bg-slate-300'}`} />
                          <span className="font-semibold text-slate-800 truncate">{c.name}</span>
                          <span className="text-slate-400 truncate hidden sm:inline">· {company}</span>
                        </div>
                        <div className="shrink-0 text-right text-slate-500">
                          <span className={isToday ? 'text-brand-600 font-bold' : ''}>{dayStr}</span>
                          {c.interviewTime && <span className="mr-1 text-slate-400">{c.interviewTime}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Marketing detailed card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
          <h3 className="font-bold text-slate-800">שיווק ועלות גיוס — {monthLabel(filter)}</h3>

          {/* Budget big number */}
          <div>
            <div className="text-xs text-slate-400 mb-1">תקציב שיווק החודש</div>
            <div className="text-3xl font-black text-slate-800">₪{fmtNum(marketingBudget)}</div>
            {/* spend vs revenue bar */}
            {revenue > 0 && (
              <div className="mt-2">
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-orange-400 rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(100, (marketingBudget / revenue) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>{Math.round((marketingBudget / revenue) * 100)}% מההכנסות</span>
                  <span>הכנסות: ₪{fmtNum(revenue)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Submissions block */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
              <div className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide mb-2">הגשות ללקוח</div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-2xl font-black text-blue-800">{submittedThisMonth}</div>
                  <div className="text-[10px] text-blue-500">מועמדים הוגשו</div>
                </div>
                <div className="text-left">
                  <div className="text-lg font-bold text-blue-700">
                    {costPerSubmission != null ? `₪${fmtNum(costPerSubmission)}` : '—'}
                  </div>
                  <div className="text-[10px] text-blue-400">עלות להגשה</div>
                </div>
              </div>
            </div>

            {/* Placements block */}
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
              <div className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wide mb-2">גיוסים סגורים</div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-2xl font-black text-emerald-800">{placements.length}</div>
                  <div className="text-[10px] text-emerald-500">גיוסים בפועל</div>
                </div>
                <div className="text-left">
                  <div className="text-lg font-bold text-emerald-700">
                    {cac != null ? `₪${fmtNum(cac)}` : '—'}
                  </div>
                  <div className="text-[10px] text-emerald-400">עלות לגיוס (CAC)</div>
                </div>
              </div>
            </div>
          </div>

          {/* P&L summary */}
          <div className="border border-slate-100 rounded-xl overflow-hidden">
            <div className="flex justify-between items-center px-4 py-2 hover:bg-slate-50">
              <span className="text-sm text-slate-500">הכנסות</span>
              <span className="text-sm font-semibold text-slate-700">₪{fmtNum(revenue)}</span>
            </div>
            <div className="flex justify-between items-center px-4 py-2 hover:bg-slate-50 border-t border-slate-100">
              <span className="text-sm text-slate-500">הוצאות שיווק</span>
              <span className="text-sm font-semibold text-red-500">−₪{fmtNum(marketingBudget)}</span>
            </div>
            <div className={`flex justify-between items-center px-4 py-2.5 border-t-2 border-slate-200 ${profit >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <span className="text-sm font-bold text-slate-700">רווח נקי</span>
              <span className={`text-base font-black ${profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                ₪{fmtNum(profit)}
                {revenue > 0 && (
                  <span className="text-xs font-normal mr-1 opacity-70">
                    ({Math.round((profit / revenue) * 100)}%)
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Growth bar chart — full width */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="font-bold text-slate-800 mb-4">השמות — 4 חודשים אחרונים</h3>
        <div className="flex items-end gap-4 h-28 mb-3">
          {last4.map((f, i) => {
            const count     = month4Counts[i]
            const heightPct = max4 > 0 ? (count / max4) * 100 : 0
            const active    = f.year === filter.year && f.month === filter.month
            return (
              <div
                key={`${f.year}-${f.month}`}
                className="flex-1 flex flex-col items-center gap-1 cursor-pointer group"
                onClick={() => changeFilter(f)}
              >
                <span className="text-sm font-bold text-slate-600">{count}</span>
                <div className="w-full flex items-end" style={{ height: 80 }}>
                  <div
                    className={`w-full rounded-t-lg transition-all ${active ? 'bg-brand-600' : 'bg-slate-200 group-hover:bg-slate-300'}`}
                    style={{ height: `${Math.max(heightPct, 5)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex gap-4">
          {last4.map((f, i) => {
            const active = f.year === filter.year && f.month === filter.month
            const count  = month4Counts[i]
            return (
              <div key={i} className="flex-1 text-center">
                <div className={`text-[11px] font-semibold ${active ? 'text-brand-600' : 'text-slate-400'}`}>
                  {new Date(f.year, f.month - 1, 1).toLocaleDateString('he-IL', { month: 'long' })}
                </div>
                <div className="text-[10px] text-slate-400">₪{fmtNum(count * PLACEMENT_FEE)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Weekly tracking */}
      <WeeklySection candidates={candidates} positions={positions} />

      {/* Collections & Warranty table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">גבייה ואחריות</h3>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {invoiceCounts['none'] > 0 && (
              <span className="bg-slate-100 px-2 py-0.5 rounded-full">{invoiceCounts['none']} לא נשלחה</span>
            )}
            {invoiceCounts['sent'] > 0 && (
              <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{invoiceCounts['sent']} נשלחה</span>
            )}
            {invoiceCounts['paid'] > 0 && (
              <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{invoiceCounts['paid']} שולם ✓</span>
            )}
          </div>
        </div>

        {allPlaced.length === 0 ? (
          <div className="py-16 text-center">
            <Users size={32} className="mx-auto mb-2 text-slate-200" />
            <p className="text-sm text-slate-400">אין השמות עדיין</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="text-right px-4 py-2.5 font-semibold">מועמד</th>
                  <th className="text-right px-4 py-2.5 font-semibold">חברה</th>
                  <th className="text-right px-4 py-2.5 font-semibold">תחילת עבודה</th>
                  <th className="text-right px-4 py-2.5 font-semibold">אחריות</th>
                  <th className="text-right px-4 py-2.5 font-semibold">סכום</th>
                  <th className="text-right px-4 py-2.5 font-semibold">גבייה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allPlaced.map(c => {
                  const wDays   = warrantyDays(c, positions)
                  const wEnd    = warrantyEnd(c, positions)
                  const today   = new Date()
                  const expired = wEnd ? wEnd < today : false
                  const daysLeft = wEnd ? Math.ceil((wEnd.getTime() - today.getTime()) / 86400000) : null
                  const company  = candidateCompany(c, positions)
                  const inv      = c.invoiceStatus ?? 'none'

                  return (
                    <tr key={c.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                      <td className="px-4 py-3 text-slate-600">{company}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{c.startDate ? fmtDate(c.startDate) : '—'}</td>
                      <td className="px-4 py-3">
                        {wEnd === null ? (
                          <span className="text-slate-400 text-xs">—</span>
                        ) : expired ? (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ פגה</span>
                        ) : (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${daysLeft != null && daysLeft <= 7 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {daysLeft != null && daysLeft <= 0 ? 'פגה היום' : `${daysLeft} ימים`}
                            <span className="opacity-60 mr-1">({wDays})</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-700">
                        ₪{fmtNum(PLACEMENT_FEE)}
                        {c.estimatedSalary ? (
                          <div className="text-[10px] text-slate-400 font-normal">שכר: ₪{fmtNum(c.estimatedSalary)}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          <InvBtn active={inv === 'none'} color="slate"  onClick={() => updateInvoice(c, 'none')}>לא נשלחה</InvBtn>
                          <InvBtn active={inv === 'sent'} color="amber"  onClick={() => updateInvoice(c, 'sent')}>נשלחה</InvBtn>
                          <InvBtn active={inv === 'paid'} color="green"  onClick={() => updateInvoice(c, 'paid')}>שולם ✓</InvBtn>
                        </div>
                        {c.paidDate && inv === 'paid' && (
                          <div className="text-[10px] text-slate-400 mt-0.5">שולם: {fmtDate(c.paidDate)}</div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Invoice revenue summary */}
        {allPlaced.length > 0 && (
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-sm">
            <span className="text-slate-500">סה"כ השמות</span>
            <div className="flex items-center gap-6 text-slate-700">
              <span>₪{fmtNum(allPlaced.length * PLACEMENT_FEE)} <span className="text-slate-400 text-xs">ב{allPlaced.length} השמות</span></span>
              <span className="font-bold text-green-700">₪{fmtNum((invoiceCounts['paid'] ?? 0) * PLACEMENT_FEE)} <span className="text-xs font-normal">התקבל</span></span>
              <span className="font-bold text-amber-700">₪{fmtNum(((invoiceCounts['none'] ?? 0) + (invoiceCounts['sent'] ?? 0)) * PLACEMENT_FEE)} <span className="text-xs font-normal">ממתין</span></span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface KpiCardProps {
  label:   string
  value:   string | number
  sub:     string
  color:   'emerald' | 'blue' | 'green' | 'orange' | 'purple' | 'red'
  icon:    React.ReactNode
  onClick?: () => void
  active?:  boolean
}

function KpiCard({ label, value, sub, color, icon, onClick, active }: KpiCardProps) {
  const styles: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    blue:    'bg-blue-50   text-blue-700   border-blue-100',
    green:   'bg-green-50  text-green-700  border-green-100',
    orange:  'bg-orange-50 text-orange-700 border-orange-100',
    purple:  'bg-purple-50 text-purple-700 border-purple-100',
    red:     'bg-red-50    text-red-700    border-red-100',
  }
  const ring = active ? 'ring-2 ring-emerald-400' : ''
  return (
    <div
      className={`rounded-2xl border p-4 ${styles[color]} ${ring} ${onClick ? 'cursor-pointer hover:brightness-95 transition' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 opacity-60">{icon}<span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span></div>
        {onClick && <ChevronDown size={14} className={`opacity-50 transition-transform ${active ? 'rotate-180' : ''}`} />}
      </div>
      <div className="text-2xl font-black leading-none">{value}</div>
      <div className="text-xs opacity-50 mt-1">{sub}</div>
    </div>
  )
}

interface InvBtnProps {
  active:   boolean
  color:    'slate' | 'amber' | 'green'
  onClick:  () => void
  children: React.ReactNode
}

function InvBtn({ active, color, onClick, children }: InvBtnProps) {
  const base = 'text-[11px] px-2 py-0.5 rounded-lg border transition whitespace-nowrap'
  const styles = {
    slate: active ? 'bg-slate-200 text-slate-700 border-slate-300 font-semibold' : 'text-slate-400 border-slate-200 hover:bg-slate-100',
    amber: active ? 'bg-amber-200 text-amber-800 border-amber-300 font-semibold' : 'text-slate-400 border-slate-200 hover:bg-amber-50',
    green: active ? 'bg-green-200 text-green-800 border-green-300 font-semibold' : 'text-slate-400 border-slate-200 hover:bg-green-50',
  }
  return <button onClick={onClick} className={`${base} ${styles[color]}`}>{children}</button>
}

// ── Weekly section ─────────────────────────────────────────────────────────────

function WeeklySection({ candidates, positions }: { candidates: Candidate[]; positions: SavedPosition[] }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const { start: wStart, end: wEnd, label: weekLabel } = getWeekBounds(weekOffset)

  const fmt2 = (d: Date) => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
  const weekDateRange = `${fmt2(wStart)} — ${fmt2(wEnd)}`

  const active = positions.filter(p => p.isActive)

  function inWeek(dateStr?: string): boolean {
    if (!dateStr) return false
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00')
    return d >= wStart && d <= wEnd
  }

  function linkedToPos(c: Candidate, posId: string): boolean {
    return !!(
      c.savedPositionIds?.includes(posId) ||
      c.savedPositionId === posId ||
      (c.interviewHistory ?? []).some(h => h.savedPositionId === posId)
    )
  }

  function totalInterviewCount(c: Candidate): number {
    return (c.interviewHistory?.length ?? 0) + (c.status === 'interview_scheduled' ? 1 : 0)
  }

  function hadInterviewAtPosInWeek(c: Candidate, posId: string): boolean {
    if (
      c.status === 'interview_scheduled' && c.interviewDate && inWeek(c.interviewDate) &&
      (c.savedPositionIds?.includes(posId) || c.savedPositionId === posId)
    ) return true
    return (c.interviewHistory ?? []).some(h => h.savedPositionId === posId && inWeek(h.date))
  }

  const PIPELINE_STATUSES = ['relevant', 'called', 'screening', 'call_scheduled', 'future_relevant', 'sent_to_client', 'interview_scheduled']

  const posRows = active.map(pos => {
    const posId      = pos.id
    const inPipeline = candidates.filter(c => PIPELINE_STATUSES.includes(c.status) && linkedToPos(c, posId)).length
    const newLeads   = candidates.filter(c => inWeek(c.createdAt) && linkedToPos(c, posId)).length
    const sentNow    = candidates.filter(c => c.status === 'sent_to_client' && linkedToPos(c, posId)).length
    const firstInter = candidates.filter(c => hadInterviewAtPosInWeek(c, posId) && totalInterviewCount(c) === 1).length
    const secInter   = candidates.filter(c => hadInterviewAtPosInWeek(c, posId) && totalInterviewCount(c) > 1).length
    const placed     = candidates.filter(c => inWeek(c.startDate) && linkedToPos(c, posId)).length
    const rejected   = candidates.filter(c => c.status === 'irrelevant' && inWeek(c.updatedAt) && linkedToPos(c, posId)).length
    return { pos, inPipeline, newLeads, sentNow, firstInter, secInter, placed, rejected }
  })

  const totals = posRows.reduce(
    (acc, r) => ({
      inPipeline: acc.inPipeline + r.inPipeline,
      newLeads:   acc.newLeads   + r.newLeads,
      sentNow:    acc.sentNow    + r.sentNow,
      firstInter: acc.firstInter + r.firstInter,
      secInter:   acc.secInter   + r.secInter,
      placed:     acc.placed     + r.placed,
      rejected:   acc.rejected   + r.rejected,
    }),
    { inPipeline: 0, newLeads: 0, sentNow: 0, firstInter: 0, secInter: 0, placed: 0, rejected: 0 }
  )

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-800">בקרה שבועית</h3>
          <p className="text-xs text-slate-400 mt-0.5">{weekDateRange}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekOffset(o => o - 1)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition"
          >
            <ChevronRight size={16} />
          </button>
          <div className="relative px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 min-w-28 text-center">
            <span className="text-sm font-semibold text-slate-700">{weekLabel}</span>
            {weekOffset === 0 && (
              <span className="absolute -top-2 right-1 text-[9px] bg-brand-600 text-white px-1.5 py-0.5 rounded-full">עכשיו</span>
            )}
          </div>
          <button
            onClick={() => setWeekOffset(o => Math.min(0, o + 1))}
            disabled={weekOffset >= 0}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">אין משרות פעילות</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500">
                <th className="text-right px-4 py-2.5 font-semibold">משרה</th>
                <th className="text-center px-3 py-2.5 font-semibold leading-tight">בפייפליין<br /><span className="font-normal opacity-60">כעת</span></th>
                <th className="text-center px-3 py-2.5 font-semibold leading-tight">לידים<br /><span className="font-normal opacity-60">השבוע</span></th>
                <th className="text-center px-3 py-2.5 font-semibold leading-tight">לפני<br /><span className="font-normal opacity-60">ראיון</span></th>
                <th className="text-center px-3 py-2.5 font-semibold leading-tight">ראיון<br /><span className="font-normal opacity-60">א׳ שבוע</span></th>
                <th className="text-center px-3 py-2.5 font-semibold leading-tight">ראיון<br /><span className="font-normal opacity-60">ב׳+ שבוע</span></th>
                <th className="text-center px-3 py-2.5 font-semibold">גויסו</th>
                <th className="text-center px-3 py-2.5 font-semibold">נפסלו</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {posRows.map(r => (
                <tr key={r.pos.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{r.pos.companyName}</div>
                    {r.pos.positionTitle && <div className="text-xs text-slate-400">{r.pos.positionTitle}</div>}
                  </td>
                  <WCell v={r.inPipeline}  color="slate" />
                  <WCell v={r.newLeads}    color="blue" />
                  <WCell v={r.sentNow}     color="orange" />
                  <WCell v={r.firstInter}  color="purple" />
                  <WCell v={r.secInter}    color="indigo" />
                  <WCell v={r.placed}      color="green" />
                  <WCell v={r.rejected}    color="red" />
                </tr>
              ))}
              <tr className="bg-slate-50">
                <td className="px-4 py-2.5 text-sm font-bold text-slate-600">סה"כ</td>
                <WCell v={totals.inPipeline}  color="slate"  bold />
                <WCell v={totals.newLeads}    color="blue"   bold />
                <WCell v={totals.sentNow}     color="orange" bold />
                <WCell v={totals.firstInter}  color="purple" bold />
                <WCell v={totals.secInter}    color="indigo" bold />
                <WCell v={totals.placed}      color="green"  bold />
                <WCell v={totals.rejected}    color="red"    bold />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function WCell({ v, color, bold }: { v: number; color: string; bold?: boolean }) {
  const on: Record<string, string> = {
    slate:  'bg-slate-200 text-slate-700',
    blue:   'bg-blue-100 text-blue-700',
    orange: 'bg-orange-100 text-orange-700',
    purple: 'bg-purple-100 text-purple-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    green:  'bg-green-100 text-green-700',
    red:    'bg-red-100 text-red-700',
  }
  return (
    <td className="px-3 py-3 text-center">
      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm ${bold ? 'font-bold' : 'font-semibold'} ${v > 0 ? on[color] : 'text-slate-300'}`}>
        {v > 0 ? v : '—'}
      </span>
    </td>
  )
}
