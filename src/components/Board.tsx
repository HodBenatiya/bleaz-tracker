import React, { useState } from 'react'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { Candidate, SavedPosition, CANDIDATE_STATUS_LABELS, CANDIDATE_STATUS_COLORS } from '../types'

interface Props {
  positions: SavedPosition[]
  candidates: Candidate[]
}

type MonthFilter = { year: number; month: number } | null   // null = כל הזמן

function candidatesForPos(candidates: Candidate[], posId: string) {
  return candidates.filter(c =>
    c.savedPositionIds?.includes(posId) || c.savedPositionId === posId
  )
}

function inMonth(dateStr: string, f: MonthFilter) {
  if (!f) return true
  const d = new Date(dateStr)
  return d.getFullYear() === f.year && d.getMonth() + 1 === f.month
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function monthLabel(f: MonthFilter) {
  if (!f) return 'כל הזמן'
  return new Date(f.year, f.month - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
}

function prevMonth(f: NonNullable<MonthFilter>): NonNullable<MonthFilter> {
  return f.month === 1 ? { year: f.year - 1, month: 12 } : { year: f.year, month: f.month - 1 }
}

function nextMonth(f: NonNullable<MonthFilter>): NonNullable<MonthFilter> {
  return f.month === 12 ? { year: f.year + 1, month: 1 } : { year: f.year, month: f.month + 1 }
}

function isCurrentMonth(f: MonthFilter) {
  if (!f) return false
  const now = new Date()
  return f.year === now.getFullYear() && f.month === now.getMonth() + 1
}

const ACTIVE_STATUSES  = ['new','screening','call_scheduled','called','relevant','future_relevant','sent_to_client','interview_scheduled','started_working','placement_complete']
const SENT_STATUSES    = ['sent_to_client','interview_scheduled','started_working','placement_complete']
const INTERVIEW_STATUS = ['interview_scheduled']
const WORKING_STATUSES = ['started_working','placement_complete']

export default function Board({ positions, candidates }: Props) {
  const now = new Date()
  const [filter,   setFilter]   = useState<MonthFilter>({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [expanded, setExpanded] = useState<string | null>(null)

  const active = positions.filter(p => p.isActive)

  // סינון מועמדים לפי חודש (לפי createdAt)
  const filtered = candidates.filter(c => inMonth(c.createdAt, filter))

  // האם למועמד היה ראיון בחודש הנוכחי (כולל היסטוריה)
  const hadInterviewInPeriod = (c: Candidate, f: MonthFilter, posId?: string) => {
    // ראיון נוכחי
    if (c.status === 'interview_scheduled') {
      if (!posId || c.savedPositionIds?.includes(posId) || c.savedPositionId === posId) return true
    }
    // היסטוריית ראיונות
    return (c.interviewHistory ?? []).some(h =>
      inMonth(h.date, f) && (!posId || h.savedPositionId === posId)
    )
  }

  // ── KPI עולמי ──
  const kpi = {
    positions:  active.length,
    candidates: filtered.filter(c => ACTIVE_STATUSES.includes(c.status)).length,
    sent:       filtered.filter(c => SENT_STATUSES.includes(c.status)).length,
    interviews: filtered.filter(c => hadInterviewInPeriod(c, filter)).length,
    working:    filtered.filter(c => WORKING_STATUSES.includes(c.status)).length,
    placed:     filtered.filter(c => c.status === 'placement_complete').length,
  }

  // ── נתוני משרה ──
  const posData = active.map(pos => {
    const all    = candidatesForPos(filtered, pos.id)
    // מועמדים שהיו בראיון לתפקיד זה (גם היסטוריה, גם כאלה שעברו למקום אחר)
    const interviewedHere = filtered.filter(c => hadInterviewInPeriod(c, filter, pos.id))
    const inPipe = all.filter(c => ACTIVE_STATUSES.includes(c.status))
    return {
      pos,
      total:      inPipe.length,
      sent:       inPipe.filter(c => SENT_STATUSES.includes(c.status)).length,
      interviews: interviewedHere.length,
      working:    inPipe.filter(c => WORKING_STATUSES.includes(c.status)).length,
      placed:     inPipe.filter(c => c.status === 'placement_complete').length,
      all:        inPipe,
    }
  }).sort((a, b) => b.total - a.total)

  const canGoNext = filter !== null && !isCurrentMonth(filter)

  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* ── כותרת + ניווט חודש ── */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">לוח בקרה ניהולי</h1>
          <p className="text-sm text-gray-500 mt-1">מצב עדכני לפי משרה — כל הנתונים בזמן אמת</p>
        </div>

        {/* ── Month selector ── */}
        <div className="flex items-center gap-2">
          {/* כל הזמן */}
          <button
            onClick={() => setFilter(null)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border
              ${filter === null
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'}`}
          >
            כל הזמן
          </button>

          {/* ניווט חודשים */}
          <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* חודש קודם */}
            <button
              onClick={() => setFilter(f => f ? prevMonth(f) : prevMonth({ year: now.getFullYear(), month: now.getMonth() + 1 }))}
              className="px-2 py-1.5 hover:bg-gray-50 transition-colors text-gray-500 hover:text-gray-800"
            >
              <ChevronRight size={16} />
            </button>

            {/* תצוגת חודש */}
            <span
              className={`px-3 py-1.5 text-sm font-semibold min-w-[130px] text-center cursor-pointer select-none
                ${filter !== null ? 'text-gray-800' : 'text-gray-400'}`}
              onClick={() => setFilter({ year: now.getFullYear(), month: now.getMonth() + 1 })}
            >
              {filter !== null ? monthLabel(filter) : 'בחר חודש'}
              {isCurrentMonth(filter) && (
                <span className="mr-1 text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-medium">עכשיו</span>
              )}
            </span>

            {/* חודש הבא */}
            <button
              onClick={() => {
                if (filter && !isCurrentMonth(filter)) setFilter(nextMonth(filter))
              }}
              disabled={!canGoNext}
              className={`px-2 py-1.5 transition-colors
                ${canGoNext ? 'hover:bg-gray-50 text-gray-500 hover:text-gray-800' : 'text-gray-200 cursor-default'}`}
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        {[
          { label: 'משרות פתוחות',   value: kpi.positions,  color: 'bg-indigo-50 text-indigo-700',   icon: '📋' },
          { label: 'מועמדים חדשים',  value: kpi.candidates, color: 'bg-blue-50 text-blue-700',       icon: '👥' },
          { label: 'נשלחו ללקוח',    value: kpi.sent,       color: 'bg-amber-50 text-amber-700',     icon: '📤' },
          { label: 'בראיון',         value: kpi.interviews, color: 'bg-emerald-50 text-emerald-700', icon: '🗓️' },
          { label: 'הושמו ✓',        value: kpi.placed,     color: 'bg-green-50 text-green-700',     icon: '🏆' },
        ].map(k => (
          <div key={k.label} className={`rounded-xl p-4 ${k.color} flex items-center gap-3`}>
            <span className="text-2xl">{k.icon}</span>
            <div>
              <div className="text-2xl font-bold leading-none">{k.value}</div>
              <div className="text-xs mt-1 opacity-80">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── כרטיסי משרות ── */}
      {posData.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-3">📋</div>
          <p>אין משרות פתוחות</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {posData.map(({ pos, total, sent, interviews, working, placed, all }) => {
            const isOpen = expanded === pos.id
            const pct    = total > 0 ? Math.round((placed / total) * 100) : 0

            return (
              <div key={pos.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">

                {/* Header */}
                <div
                  className="flex items-start justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : pos.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900 text-lg">{pos.companyName}</span>
                      {pos.positionTitle && (
                        <span className="text-sm text-gray-500 font-medium">· {pos.positionTitle}</span>
                      )}
                      {pos.city && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{pos.city}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      נפתחה {fmtDate(pos.createdAt)}
                    </div>
                  </div>

                  {/* מספרי פאנל */}
                  <div className="flex items-center gap-1 shrink-0 mr-4">
                    {[
                      { label: 'מאגר',   val: total,      bg: 'bg-slate-100 text-slate-700' },
                      { label: 'נשלחו',  val: sent,       bg: 'bg-blue-100 text-blue-700' },
                      { label: 'ראיון',  val: interviews, bg: 'bg-amber-100 text-amber-700' },
                      { label: 'עובדים', val: working,    bg: 'bg-emerald-100 text-emerald-700' },
                      { label: '✓ הושמו',val: placed,     bg: 'bg-green-100 text-green-700' },
                    ].map(s => (
                      <div key={s.label} className={`flex flex-col items-center px-3 py-1.5 rounded-xl ${s.bg} min-w-[52px]`}>
                        <span className="text-xl font-bold leading-none">{s.val}</span>
                        <span className="text-[10px] mt-0.5 whitespace-nowrap">{s.label}</span>
                      </div>
                    ))}
                    <span className="text-gray-300 mr-2 text-sm">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Progress bar */}
                {total > 0 && (
                  <div className="px-5 pb-3">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>פאנל המרה</span>
                      <span>{pct}% הושמו</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
                      <div className="bg-blue-300 h-full transition-all"   style={{ width: `${(sent/total)*100}%` }} />
                      <div className="bg-amber-400 h-full transition-all"  style={{ width: `${(interviews/total)*100}%` }} />
                      <div className="bg-emerald-400 h-full transition-all"style={{ width: `${(working/total)*100}%` }} />
                      <div className="bg-green-500 h-full transition-all"  style={{ width: `${(placed/total)*100}%` }} />
                    </div>
                    <div className="flex gap-4 mt-1.5 text-[10px] text-gray-400">
                      <span><span className="inline-block w-2 h-2 rounded-full bg-blue-300 ml-1"/>נשלחו</span>
                      <span><span className="inline-block w-2 h-2 rounded-full bg-amber-400 ml-1"/>ראיונות</span>
                      <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-400 ml-1"/>עובדים</span>
                      <span><span className="inline-block w-2 h-2 rounded-full bg-green-500 ml-1"/>הושמו</span>
                    </div>
                  </div>
                )}

                {total === 0 && (
                  <div className="px-5 pb-3">
                    <p className="text-xs text-gray-300 italic">
                      {filter !== null ? `אין מועמדים שנכנסו ב${monthLabel(filter)}` : 'אין מועמדים פעילים'}
                    </p>
                  </div>
                )}

                {/* רשימת מועמדים */}
                {isOpen && (
                  <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
                    {all.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-4">אין מועמדים משויכים למשרה זו</p>
                    ) : (
                      <>
                        <p className="text-xs font-semibold text-gray-500 mb-3">מועמדים פעילים ({all.length})</p>
                        <div className="flex flex-col gap-2">
                          {all
                            .sort((a, b) => {
                              const order = ['placement_complete','started_working','interview_scheduled','sent_to_client','relevant','called','call_scheduled','screening','new','future_relevant']
                              return order.indexOf(a.status) - order.indexOf(b.status)
                            })
                            .map(c => (
                              <div key={c.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-gray-100">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600 shrink-0">
                                    {c.name.charAt(0)}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-medium text-gray-900 text-sm truncate">{c.name}</div>
                                    <div className="text-xs text-gray-400">{c.phone}</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {c.interviewDate && (
                                    <span className="text-xs text-gray-400">📅 {fmtDate(c.interviewDate)}</span>
                                  )}
                                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${CANDIDATE_STATUS_COLORS[c.status]}`}>
                                    {CANDIDATE_STATUS_LABELS[c.status]}
                                  </span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
