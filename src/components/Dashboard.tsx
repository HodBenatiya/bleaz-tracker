import React, { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, DollarSign, Users, Target,
  Activity, Building2, Calendar, BarChart2, GitBranch, Award,
  CheckSquare, AlertCircle, Percent,
} from 'lucide-react'
import type { DailyReport, DashboardTab, PipelineCompany, SavedPosition, Task } from '../types'
import { PIPELINE_STAGE_LABELS, PIPELINE_STAGE_COLORS } from '../types'
import {
  todayISO, getWeekStart, getWeekDates, reportsForWeek, reportsForMonth,
  reportForDate, formatDateShortHe, getDayNameHe, formatMonthHe, formatCurrency,
  calcCostPerLead, sumField, aggregateByCompany,
  trendDirection, sortedReports, newEmptyReport,
  calcFunnelFromPositions, calcMonthForecast, calcRoi,
} from '../utils/helpers'
import AlertsBanner from './AlertsBanner'

interface Props {
  reports:   DailyReport[]
  positions: SavedPosition[]
  pipeline:  PipelineCompany[]
  tasks:     Task[]
  onNav:     (v: 'tasks' | 'pipeline') => void
}

const COLORS = { blue: '#2563eb', emerald: '#10b981', amber: '#f59e0b', violet: '#7c3aed', red: '#ef4444' }

function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-sm" dir="rtl">
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p, i) => <p key={i} style={{ color: p.color }}>{p.name}: <strong>{p.value}</strong></p>)}
    </div>
  )
}

function StatCard({ icon, color, label, value, sub, alert }: {
  icon: React.ReactNode; color: string; label: string; value: string; sub: string; alert?: boolean
}) {
  return (
    <div className="stat-card">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${color}`}>{icon}</div>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${alert ? 'text-red-600' : 'text-slate-800'}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
    </div>
  )
}

function DashTab({ id, active, label, icon, onClick }: {
  id: DashboardTab; active: boolean; label: string; icon: React.ReactNode; onClick: (id: DashboardTab) => void
}) {
  return (
    <button onClick={() => onClick(id)}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition
        ${active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
      {icon}{label}
    </button>
  )
}

function FunnelBar({ label, value, total, pct, color }: {
  label: string; value: number; total: number; pct: number; color: string
}) {
  const width = total > 0 ? Math.max(4, Math.round((value / total) * 100)) : 0
  return (
    <div className="flex items-center gap-3">
      <p className="text-xs text-slate-500 w-32 shrink-0 text-left">{label}</p>
      <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
        <div className={`h-5 rounded-full flex items-center px-2 ${color} transition-all`}
          style={{ width: `${width}%` }}>
          {width > 20 && <span className="text-white text-[10px] font-bold">{value}</span>}
        </div>
      </div>
      {width <= 20 && <span className="text-xs font-bold text-slate-700 w-6">{value}</span>}
      {pct > 0 && <span className="text-xs text-slate-400 w-12 shrink-0">{pct}%</span>}
    </div>
  )
}

export default function Dashboard({ reports, positions, pipeline, tasks, onNav }: Props) {
  const [tab, setTab] = useState<DashboardTab>('daily')
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null)

  const today       = todayISO()
  const weekStart   = getWeekStart()
  const now         = new Date()
  const weekReports = reportsForWeek(reports, weekStart)
  const todayReport = reportForDate(reports, today) ?? null

  const openTasks    = tasks.filter(t => !t.done)
  const overdueTasks = openTasks.filter(t => t.dueDate < today)
  const todayTasks   = openTasks.filter(t => t.dueDate === today)

  if (reports.length === 0 && pipeline.length === 0 && tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <Activity className="mb-4 opacity-30" size={64} />
        <p className="text-lg font-semibold">אין נתונים עדיין</p>
        <p className="text-sm mt-1">מלא את הדיווח היומי הראשון כדי לראות סטטיסטיקות</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <AlertsBanner todayReport={todayReport} weekReports={weekReports} />

      {(overdueTasks.length > 0 || todayTasks.length > 0) && (
        <button onClick={() => onNav('tasks')}
          className="w-full flex items-center gap-3 p-4 mb-4 bg-amber-50 border border-amber-200 rounded-xl text-right hover:bg-amber-100 transition">
          <AlertCircle size={18} className="text-amber-600 shrink-0" />
          <div className="flex-1">
            {overdueTasks.length > 0 && <p className="text-sm font-semibold text-amber-800">{overdueTasks.length} משימות באיחור</p>}
            {todayTasks.length > 0  && <p className="text-sm text-amber-700">{todayTasks.length} משימות להיום</p>}
          </div>
          <span className="text-xs text-amber-600">לצפייה ←</span>
        </button>
      )}

      <div className="flex gap-2 mb-6 flex-wrap">
        <DashTab id="daily"   active={tab==='daily'}   label="יומי"     icon={<Calendar size={15}/>}   onClick={setTab} />
        <DashTab id="weekly"  active={tab==='weekly'}  label="שבועי"    icon={<BarChart2 size={15}/>}  onClick={setTab} />
        <DashTab id="monthly" active={tab==='monthly'} label="חודשי"    icon={<Activity size={15}/>}   onClick={setTab} />
        <DashTab id="company" active={tab==='company'} label="לפי חברה" icon={<Building2 size={15}/>}  onClick={setTab} />
      </div>

      {tab === 'daily'   && <DailyView   report={todayReport} pipeline={pipeline} tasks={openTasks} onNav={onNav} />}
      {tab === 'weekly'  && <WeeklyView  reports={reports} positions={positions} weekStart={weekStart} />}
      {tab === 'monthly' && <MonthlyView reports={reports} positions={positions} year={now.getFullYear()} month={now.getMonth()} />}
      {tab === 'company' && <CompanyView reports={reports} selected={selectedCompany} onSelect={setSelectedCompany} />}
    </div>
  )
}

// ════════════════════════════════════════
// DAILY VIEW
// ════════════════════════════════════════
function DailyView({ report, pipeline, tasks, onNav }: {
  report: DailyReport | null; pipeline: PipelineCompany[]; tasks: Task[]; onNav: (v: 'tasks' | 'pipeline') => void
}) {
  const activePipeline = pipeline.filter(c => c.stage !== 'lost' && c.stage !== 'signed')
  const todayTasks     = tasks.filter(t => t.dueDate === todayISO())

  const totalLeads    = report ? report.jobs.reduce((s, j) => s + j.leadsIn, 0) : 0
  const totalCost     = report ? report.jobs.reduce((s, j) => s + j.campaignCost, 0) : 0
  const totalRelevant = report ? report.jobs.reduce((s, j) => s + j.relevantLeads, 0) : 0
  const avgCPL        = calcCostPerLead(totalCost, totalLeads)

  return (
    <div className="flex flex-col gap-6">
      {todayTasks.length > 0 && (
        <div className="card border-r-4 border-r-amber-400">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-700 flex items-center gap-2">
              <CheckSquare size={16} className="text-amber-500" /> משימות להיום ({todayTasks.length})
            </h3>
            <button onClick={() => onNav('tasks')} className="text-xs text-brand-600 hover:underline">כל המשימות</button>
          </div>
          <div className="flex flex-col gap-2">
            {todayTasks.slice(0, 4).map(t => (
              <div key={t.id} className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  t.priority === 'high' ? 'bg-red-500' : t.priority === 'medium' ? 'bg-amber-400' : 'bg-slate-300'
                }`} />
                <span className="text-slate-700">{t.title}</span>
                <span className="text-xs text-slate-400 mr-auto">
                  {t.assignee === 'hod' ? 'הוד' : t.assignee === 'tzachi' ? 'צחי' : 'שניהם'}
                </span>
              </div>
            ))}
            {todayTasks.length > 4 && <p className="text-xs text-slate-400">ועוד {todayTasks.length - 4}...</p>}
          </div>
        </div>
      )}

      {report ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={<Users size={20}/>}      color="bg-blue-50 text-blue-600"       label="לידים היום"     value={String(totalLeads)}   sub={`${totalRelevant} רלוונטיים`} />
            <StatCard icon={<DollarSign size={20}/>} color="bg-amber-50 text-amber-600"     label="עלות לליד"      value={avgCPL > 0 ? formatCurrency(avgCPL) : '—'} sub={formatCurrency(totalCost)} alert={avgCPL > 30} />
            <StatCard icon={<Users size={20}/>}      color="bg-violet-50 text-violet-600"   label="שיחות סינון"    value={String(report.screeningCalls)} sub={`${report.nonaUsersRegistered} יוזרי נונה`} />
            <StatCard icon={<Activity size={20}/>}   color="bg-emerald-50 text-emerald-600" label="פניות יזומות"   value={String(report.outreachSent)} sub={`${report.newClientsSigned} לקוחות חדשים`} />
          </div>

          {report.jobs.some(j => j.leadsIn > 0 || j.campaignCost > 0) && (
            <div className="card">
              <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Building2 size={16} className="text-brand-600" /> קמפיינים פעילים היום
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-100">
                      <th className="text-right pb-2 pr-2">חברה</th>
                      <th className="text-right pb-2">תפקיד</th>
                      <th className="text-right pb-2">תקציב</th>
                      <th className="text-right pb-2">לידים</th>
                      <th className="text-right pb-2">רלוונטיים</th>
                      <th className="text-right pb-2">עלות/ליד</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.jobs.map(j => {
                      const cpl = calcCostPerLead(j.campaignCost, j.leadsIn)
                      return (
                        <tr key={j.id} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="py-2 pr-2 font-medium">{j.companyName || '—'}</td>
                          <td className="py-2 text-slate-500 text-xs">{j.positionTitle || '—'}</td>
                          <td className="py-2">{j.campaignCost > 0 ? formatCurrency(j.campaignCost) : '—'}</td>
                          <td className="py-2 font-medium">{j.leadsIn}</td>
                          <td className="py-2 text-emerald-700 font-medium">{j.relevantLeads}</td>
                          <td className={`py-2 font-medium ${cpl > 30 ? 'text-red-600' : 'text-slate-700'}`}>
                            {cpl > 0 ? formatCurrency(cpl) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(report.hodBlockers || report.tzachiBlockers || report.generalNotes) && (
            <div className="card">
              <h3 className="font-semibold text-slate-700 mb-3">הערות יום</h3>
              {report.hodBlockers    && <BlockRow label="הוד — חסמים"  text={report.hodBlockers} />}
              {report.tzachiBlockers && <BlockRow label="צחי — חסמים" text={report.tzachiBlockers} />}
              {report.generalNotes   && <BlockRow label="הערות כלליות" text={report.generalNotes} />}
            </div>
          )}
        </>
      ) : (
        <div className="card text-center py-10 text-slate-400">
          <p className="font-semibold">אין דיווח להיום</p>
          <p className="text-sm mt-1">עבור ל"דיווח יומי" והזן את הנתונים</p>
        </div>
      )}

      {activePipeline.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-700 flex items-center gap-2">
              <GitBranch size={16} className="text-emerald-600" /> פייפליין פעיל — {activePipeline.length} חברות
            </h3>
            <button onClick={() => onNav('pipeline')} className="text-xs text-brand-600 hover:underline">פתח פייפליין</button>
          </div>
          <div className="flex flex-col gap-2">
            {activePipeline.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className={`badge text-xs ${PIPELINE_STAGE_COLORS[c.stage]}`}>{PIPELINE_STAGE_LABELS[c.stage]}</span>
                <span className="font-medium text-slate-700">{c.name}</span>
                {c.nextAction && <span className="text-slate-400 text-xs truncate">→ {c.nextAction}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════
// WEEKLY VIEW
// ════════════════════════════════════════
function WeeklyView({ reports, positions, weekStart }: {
  reports: DailyReport[]; positions: SavedPosition[]; weekStart: Date
}) {
  const [offset, setOffset] = useState(0)
  const ws = new Date(weekStart)
  ws.setDate(ws.getDate() + offset * 7)
  const weekDates   = getWeekDates(ws)
  const weekReports = reportsForWeek(reports, ws)

  const chartData = weekDates.map(date => {
    const r = reportForDate(reports, date) ?? newEmptyReport(date)
    return {
      day:      getDayNameHe(date) + ' ' + formatDateShortHe(date),
      'לידים':  r.jobs.reduce((s, j) => s + j.leadsIn, 0),
      'פניות':  r.outreachSent,
    }
  })

  const totals = {
    leads:      weekReports.reduce((s, r) => s + r.jobs.reduce((ss, j) => ss + j.leadsIn, 0), 0),
    relevant:   weekReports.reduce((s, r) => s + r.jobs.reduce((ss, j) => ss + j.relevantLeads, 0), 0),
    cost:       weekReports.reduce((s, r) => s + r.jobs.reduce((ss, j) => ss + j.campaignCost, 0), 0),
    outreach:   sumField(weekReports, 'outreachSent'),
    newClients: sumField(weekReports, 'newClientsSigned'),
    screening:  sumField(weekReports, 'screeningCalls'),
  }
  const weekCPL = calcCostPerLead(totals.cost, totals.leads)
  const funnel  = calcFunnelFromPositions(weekReports, positions)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <button onClick={() => setOffset(o => o - 1)} className="btn-secondary !px-3">← שבוע קודם</button>
        <p className="font-semibold text-slate-700">{formatDateShortHe(weekDates[0])} — {formatDateShortHe(weekDates[4])}</p>
        <button onClick={() => setOffset(o => Math.min(0, o + 1))} disabled={offset === 0} className="btn-secondary !px-3 disabled:opacity-40">שבוע הבא →</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Users size={20}/>}      color="bg-blue-50 text-blue-600"       label="לידים השבוע"   value={String(totals.leads)}    sub={`${totals.relevant} רלוונטיים`} />
        <StatCard icon={<DollarSign size={20}/>} color="bg-amber-50 text-amber-600"     label="עלות לליד"     value={weekCPL > 0 ? formatCurrency(weekCPL) : '—'} sub={formatCurrency(totals.cost)} alert={weekCPL > 30} />
        <StatCard icon={<Activity size={20}/>}   color="bg-violet-50 text-violet-600"   label="פניות יזומות" value={String(totals.outreach)}  sub={`${totals.newClients} לקוחות חדשים`} />
        <StatCard icon={<Users size={20}/>}      color="bg-emerald-50 text-emerald-600" label="שיחות סינון"  value={String(totals.screening)} sub="שיחות השבוע" />
      </div>

      {/* Conversion funnel from positions */}
      <div className="card">
        <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Percent size={15} className="text-brand-600" /> משפך המרה — כל המשרות (מצטבר)
        </h3>
        <div className="flex flex-col gap-3">
          <FunnelBar label="לידים → רלוונטיים"  value={funnel.relevant}   total={funnel.leads}      pct={funnel.leadsToRelevant}   color="bg-blue-500" />
          <FunnelBar label="רלוונטיים → נשלחו"  value={funnel.sent}       total={funnel.relevant}   pct={funnel.relevantToSent}    color="bg-violet-500" />
          <FunnelBar label="נשלחו → ראיונות"    value={funnel.interviews} total={funnel.sent}       pct={funnel.sentToInterview}   color="bg-amber-500" />
          <FunnelBar label="ראיונות → התחילו"   value={funnel.accepted}   total={funnel.interviews} pct={funnel.interviewToAccept} color="bg-orange-500" />
          <FunnelBar label="התחילו → אושרו ✓"   value={funnel.confirmed}  total={funnel.accepted}   pct={funnel.acceptToConfirmed} color="bg-emerald-500" />
        </div>
        {funnel.leads > 0 && (
          <p className="text-xs text-slate-500 mt-3 text-center">
            המרה כוללת: <strong className="text-slate-700">{funnel.overallConversion}%</strong>{' '}(ליד → אושר)
          </p>
        )}
      </div>

      {/* Chart */}
      <div className="card">
        <h3 className="font-semibold text-slate-700 mb-4">לידים ופניות לפי יום</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="לידים" fill={COLORS.blue}   radius={[5,5,0,0]} />
            <Bar dataKey="פניות" fill={COLORS.violet} radius={[5,5,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Day-by-day table */}
      <div className="card overflow-x-auto">
        <h3 className="font-semibold text-slate-700 mb-4">פירוט יומי</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-100">
              {['יום','לידים','רלוונטיים','עלות/ליד','פניות','לקוחות חדשים'].map(h => (
                <th key={h} className="text-right pb-2 pl-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekDates.map(date => {
              const r        = reportForDate(reports, date)
              const leads    = r ? r.jobs.reduce((s, j) => s + j.leadsIn, 0) : null
              const relevant = r ? r.jobs.reduce((s, j) => s + j.relevantLeads, 0) : null
              const cost     = r ? r.jobs.reduce((s, j) => s + j.campaignCost, 0) : null
              const cpl      = leads != null && cost != null ? calcCostPerLead(cost, leads) : null
              return (
                <tr key={date} className={`border-b border-slate-50 ${!r ? 'opacity-40' : ''}`}>
                  <td className="py-2 font-medium text-slate-700">{getDayNameHe(date)} {formatDateShortHe(date)}</td>
                  <td className="py-2 pl-3">{leads ?? '—'}</td>
                  <td className="py-2 pl-3 text-emerald-700">{relevant ?? '—'}</td>
                  <td className={`py-2 pl-3 ${cpl != null && cpl > 30 ? 'text-red-600 font-medium' : ''}`}>{cpl != null && cpl > 0 ? formatCurrency(cpl) : '—'}</td>
                  <td className="py-2 pl-3">{r?.outreachSent ?? '—'}</td>
                  <td className="py-2 pl-3">{r?.newClientsSigned ?? '—'}</td>
                </tr>
              )
            })}
            <tr className="font-semibold text-slate-800 bg-slate-50">
              <td className="py-2">סה״כ</td>
              <td className="py-2 pl-3">{totals.leads}</td>
              <td className="py-2 pl-3 text-emerald-700">{totals.relevant}</td>
              <td className={`py-2 pl-3 ${weekCPL > 30 ? 'text-red-600' : ''}`}>{weekCPL > 0 ? formatCurrency(weekCPL) : '—'}</td>
              <td className="py-2 pl-3">{totals.outreach}</td>
              <td className="py-2 pl-3">{totals.newClients}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ════════════════════════════════════════
// MONTHLY VIEW
// ════════════════════════════════════════
function MonthlyView({ reports, positions, year, month }: {
  reports: DailyReport[]; positions: SavedPosition[]; year: number; month: number
}) {
  const [offset, setOffset] = useState(0)
  const targetDate   = new Date(year, month + offset, 1)
  const y            = targetDate.getFullYear()
  const m            = targetDate.getMonth()
  const monthReports = reportsForMonth(reports, y, m)
  const trend        = trendDirection(positions)
  const TrendIcon    = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus

  const confirmedTotal = positions.reduce((s, p) => s + p.funnelConfirmed, 0)
  const goalPct        = Math.round((confirmedTotal / 12) * 100)

  const totals = {
    leads:      monthReports.reduce((s, r) => s + r.jobs.reduce((ss, j) => ss + j.leadsIn, 0), 0),
    relevant:   monthReports.reduce((s, r) => s + r.jobs.reduce((ss, j) => ss + j.relevantLeads, 0), 0),
    cost:       monthReports.reduce((s, r) => s + r.jobs.reduce((ss, j) => ss + j.campaignCost, 0), 0),
    outreach:   sumField(monthReports, 'outreachSent'),
    newClients: sumField(monthReports, 'newClientsSigned'),
  }

  const cpl          = calcCostPerLead(totals.cost, totals.leads)
  const forecast     = calcMonthForecast(positions, y, m)
  const roi          = calcRoi(monthReports, positions)
  const funnel       = calcFunnelFromPositions(monthReports, positions)
  const dailyRateStr = forecast.daysElapsed > 0
    ? (forecast.confirmedTotal / forecast.daysElapsed).toFixed(1)
    : '0'

  const chartData = sortedReports(monthReports).reverse().map(r => ({
    date:     formatDateShortHe(r.date),
    'לידים':  r.jobs.reduce((s, j) => s + j.leadsIn, 0),
    'פניות':  r.outreachSent,
  }))

  const months = [0,1,2,3].map(i => {
    const d   = new Date(y, m - i, 1)
    const mrs = reportsForMonth(reports, d.getFullYear(), d.getMonth())
    return {
      label:   d.toLocaleDateString('he-IL', { month: 'short' }),
      'לידים': mrs.reduce((s, r) => s + r.jobs.reduce((ss, j) => ss + j.leadsIn, 0), 0),
      'פניות': sumField(mrs, 'outreachSent'),
    }
  }).reverse()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <button onClick={() => setOffset(o => o - 1)} className="btn-secondary !px-3">← חודש קודם</button>
        <p className="font-bold text-slate-700">{formatMonthHe(y, m)}</p>
        <button onClick={() => setOffset(o => Math.min(0, o + 1))} disabled={offset === 0} className="btn-secondary !px-3 disabled:opacity-40">חודש הבא →</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Award size={20}/>}      color="bg-emerald-50 text-emerald-600" label="הצבות (סה״כ)"  value={`${confirmedTotal} / 12`} sub={`${goalPct}% מהיעד · ${formatCurrency(roi.totalRevenue)}`} alert={confirmedTotal < 8 && monthReports.length >= 10} />
        <StatCard icon={<Users size={20}/>}      color="bg-blue-50 text-blue-600"       label="לידים החודש"  value={String(totals.leads)}     sub={`${totals.relevant} רלוונטיים`} />
        <StatCard icon={<DollarSign size={20}/>} color="bg-amber-50 text-amber-600"     label="עלות לליד"    value={cpl > 0 ? formatCurrency(cpl) : '—'} sub={formatCurrency(totals.cost)} alert={cpl > 30} />
        <StatCard icon={<TrendIcon size={20}/>}  color="bg-violet-50 text-violet-600"   label="מגמה"         value={trend === 'up' ? 'עלייה' : trend === 'down' ? 'ירידה' : 'יציב'} sub={`${totals.outreach} פניות · ${totals.newClients} לקוחות`} />
      </div>

      {/* Forecast + ROI */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`card border-r-4 ${forecast.onTrack ? 'border-r-emerald-400' : 'border-r-red-400'}`}>
          <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Target size={15} className={forecast.onTrack ? 'text-emerald-600' : 'text-red-500'} />
            תחזית סוף חודש
          </h3>
          <div className="flex items-end gap-3 mb-3">
            <p className={`text-4xl font-black ${forecast.onTrack ? 'text-emerald-600' : 'text-red-500'}`}>
              {forecast.projected}
            </p>
            <div className="mb-1">
              <p className="text-sm text-slate-500">הצבות צפויות</p>
              <p className={`text-xs font-semibold ${forecast.onTrack ? 'text-emerald-600' : 'text-red-500'}`}>
                {forecast.onTrack ? '✓ בדרך ליעד' : '✗ מתחת ליעד'}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1 text-sm text-slate-600">
            <p>עברו <strong>{forecast.daysElapsed}</strong> מתוך {forecast.daysInMonth} ימים</p>
            <p>קצב יומי נוכחי: <strong>{dailyRateStr}</strong> הצבות/יום</p>
            {!forecast.onTrack && forecast.daysRemaining > 0 && (
              <p className="text-red-600 font-medium">
                צריך <strong>{forecast.neededPerDay}</strong> הצבות/יום לשאר החודש
              </p>
            )}
          </div>
        </div>

        <div className="card border-r-4 border-r-violet-400">
          <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <DollarSign size={15} className="text-violet-600" /> ROI קמפיינים
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-400">הכנסות</p>
              <p className="font-bold text-emerald-700">{formatCurrency(roi.totalRevenue)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">עלות קמפיינים</p>
              <p className="font-bold text-red-600">{formatCurrency(roi.totalCampaignCost)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">רווח נקי</p>
              <p className={`font-bold text-lg ${roi.netProfit >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                {formatCurrency(roi.netProfit)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">ROI</p>
              <p className={`font-bold text-lg ${roi.roi >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {roi.roi}%
              </p>
            </div>
            {roi.costPerPlacement > 0 && (
              <div className="col-span-2 pt-2 border-t border-slate-100">
                <p className="text-xs text-slate-400">עלות ממוצעת להשמה</p>
                <p className="font-semibold text-slate-700">{formatCurrency(roi.costPerPlacement)}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  על כל ₪1 שהושקע — {roi.revenuePerCostShekels}₪ הכנסה
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Conversion funnel */}
      <div className="card">
        <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Percent size={15} className="text-brand-600" /> משפך המרה — כל המשרות
        </h3>
        <div className="flex flex-col gap-3">
          <FunnelBar label="לידים → רלוונטיים"  value={funnel.relevant}   total={funnel.leads}      pct={funnel.leadsToRelevant}   color="bg-blue-500" />
          <FunnelBar label="רלוונטיים → נשלחו"  value={funnel.sent}       total={funnel.relevant}   pct={funnel.relevantToSent}    color="bg-violet-500" />
          <FunnelBar label="נשלחו → ראיונות"    value={funnel.interviews} total={funnel.sent}       pct={funnel.sentToInterview}   color="bg-amber-500" />
          <FunnelBar label="ראיונות → התחילו"   value={funnel.accepted}   total={funnel.interviews} pct={funnel.interviewToAccept} color="bg-orange-500" />
          <FunnelBar label="התחילו → אושרו ✓"   value={funnel.confirmed}  total={funnel.accepted}   pct={funnel.acceptToConfirmed} color="bg-emerald-500" />
        </div>
        {funnel.leads > 0 && (
          <p className="text-xs text-slate-500 mt-3 text-center">
            המרה כוללת (ליד → אושר): <strong className="text-slate-700">{funnel.overallConversion}%</strong>
          </p>
        )}
      </div>

      {/* Goal bar */}
      <div className="card">
        <div className="flex justify-between text-sm font-medium text-slate-700 mb-2">
          <span>התקדמות לעבר יעד 12 הצבות</span>
          <span>{confirmedTotal} / 12</span>
        </div>
        <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-4 rounded-full transition-all ${confirmedTotal >= 12 ? 'bg-emerald-500' : confirmedTotal >= 6 ? 'bg-brand-500' : 'bg-amber-400'}`}
            style={{ width: `${Math.min(100, goalPct)}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-slate-400">
          <span>{goalPct}% הושג</span>
          <span>נותרו {Math.max(0, 12 - confirmedTotal)} להשלמת יעד</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold text-slate-700 mb-4">פעילות יומית החודש</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="לידים" fill={COLORS.blue}   radius={[4,4,0,0]} />
              <Bar dataKey="פניות" fill={COLORS.violet} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3 className="font-semibold text-slate-700 mb-4">השוואה 4 חודשים</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={months}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="לידים" fill={COLORS.blue}   radius={[4,4,0,0]} />
              <Bar dataKey="פניות" fill={COLORS.violet} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════
// COMPANY VIEW
// ════════════════════════════════════════
function CompanyView({ reports, selected, onSelect }: {
  reports: DailyReport[]; selected: string | null; onSelect: (n: string | null) => void
}) {
  const companies = aggregateByCompany(reports)
  if (companies.length === 0) {
    return (
      <div className="card text-center py-12 text-slate-400">
        <p className="font-semibold">אין נתוני חברות עדיין</p>
        <p className="text-sm mt-1">הוסף משרות בדיווח היומי</p>
      </div>
    )
  }

  if (selected) {
    const company = companies.find(c => c.companyName === selected)
    if (!company) { onSelect(null); return null }
    const compReports = sortedReports(reports).filter(r => r.jobs.some(j => j.companyName === selected))
    const timeline    = [...compReports].reverse().map(r => {
      const jobs = r.jobs.filter(j => j.companyName === selected)
      return {
        date:        formatDateShortHe(r.date),
        'לידים':     jobs.reduce((s, j) => s + j.leadsIn, 0),
        'רלוונטיים': jobs.reduce((s, j) => s + j.relevantLeads, 0),
        'עלות (₪)':  jobs.reduce((s, j) => s + j.campaignCost, 0),
      }
    })

    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <button onClick={() => onSelect(null)} className="btn-secondary !px-3 !py-2 text-sm">← חזרה</button>
          <h2 className="text-xl font-bold text-slate-800">{selected}</h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={<Users size={20}/>}      color="bg-blue-50 text-blue-600"       label="סה״כ לידים"  value={String(company.totalLeads)}    sub={`${company.totalRelevant} רלוונטיים`} />
          <StatCard icon={<DollarSign size={20}/>} color="bg-amber-50 text-amber-600"     label="סה״כ הוצאה"  value={formatCurrency(company.totalCost)} sub={`עלות לליד: ${company.costPerLead > 0 ? formatCurrency(company.costPerLead) : '—'}`} alert={company.costPerLead > 30} />
          <StatCard icon={<Activity size={20}/>}   color="bg-emerald-50 text-emerald-600" label="ימי פעילות"  value={String(company.daysActive)}    sub="" />
          <StatCard icon={<Building2 size={20}/>}  color="bg-violet-50 text-violet-600"   label="תפקידים"     value={String(company.positions.length)} sub={company.positions.join(', ') || '—'} />
        </div>

        <div className="card">
          <h3 className="font-semibold text-slate-700 mb-4">התקדמות לאורך זמן</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="l" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="r" orientation="right" tickFormatter={v => `₪${v}`} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="l" type="monotone" dataKey="לידים"      stroke={COLORS.blue}    strokeWidth={2} dot={{ r: 4 }} />
              <Line yAxisId="l" type="monotone" dataKey="רלוונטיים"  stroke={COLORS.emerald} strokeWidth={2} dot={{ r: 4 }} />
              <Line yAxisId="r" type="monotone" dataKey="עלות (₪)"   stroke={COLORS.amber}   strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">לחץ על חברה לפירוט מלא + גרף התקדמות</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {companies.map(c => (
          <button key={c.companyName} onClick={() => onSelect(c.companyName)}
            className="card text-right hover:border-brand-200 hover:shadow-md transition cursor-pointer !p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="text-lg font-bold text-slate-800">{c.companyName}</span>
              <span className="badge badge-blue">{c.daysActive} ימים</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><p className="text-xs text-slate-400">לידים</p><p className="font-bold text-brand-700">{c.totalLeads}</p></div>
              <div><p className="text-xs text-slate-400">רלוונטיים</p><p className="font-bold text-emerald-700">{c.totalRelevant}</p></div>
              <div>
                <p className="text-xs text-slate-400">עלות/ליד</p>
                <p className={`font-bold ${c.costPerLead > 30 ? 'text-red-600' : 'text-slate-700'}`}>
                  {c.costPerLead > 0 ? formatCurrency(c.costPerLead) : '—'}
                </p>
              </div>
            </div>
            {c.positions.length > 0 && <p className="text-xs text-slate-400 mt-3 truncate">{c.positions.join(' · ')}</p>}
          </button>
        ))}
      </div>
    </div>
  )
}

function BlockRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{text}</p>
    </div>
  )
}
