import { useState, useEffect } from 'react'
import {
  ChevronRight, ChevronLeft, Save, CheckCircle2,
  Plus, Trash2, Users, StickyNote, Megaphone, Briefcase,
  Settings, Building2,
} from 'lucide-react'
import type { DailyReport, ActiveClient, ClientStatus, JobPosition, SavedPosition, PipelineCompany } from '../types'
import { CLIENT_STATUS_LABELS, PIPELINE_STAGE_LABELS, PIPELINE_STAGE_COLORS } from '../types'
import {
  todayISO, toISODate, formatDateHe, calcCostPerLead, formatCurrency,
  generateId, newEmptyReport, reportForDate,
} from '../utils/helpers'

interface Props {
  reports:         DailyReport[]
  savedPositions:  SavedPosition[]
  pipeline:        PipelineCompany[]
  editingReport:   DailyReport | null
  onSave:          (report: DailyReport) => void
  onGoToPositions: () => void
}

const STATUS_OPTIONS = Object.entries(CLIENT_STATUS_LABELS) as [ClientStatus, string][]

function buildJobsForDate(savedPositions: SavedPosition[], existingJobs: JobPosition[]): JobPosition[] {
  return savedPositions
    .filter(p => p.isActive)
    .map(pos => {
      const existing = existingJobs.find(j => j.savedPositionId === pos.id)
      if (existing) return existing
      return {
        id: generateId(), savedPositionId: pos.id,
        companyName: pos.companyName, positionTitle: pos.positionTitle, city: pos.city,
        campaignCost: 0, leadsIn: 0, relevantLeads: 0,
      }
    })
}

function numInput(value: number, onChange: (v: number) => void, label: string, sub?: string) {
  return (
    <div>
      <label className="label">{label}</label>
      {sub && <p className="text-[11px] text-slate-400 mb-1">{sub}</p>}
      <input
        type="number" min={0} className="input-field"
        value={value || ''} placeholder="0"
        onChange={e => onChange(Math.max(0, Number(e.target.value)))}
      />
    </div>
  )
}

export default function DailyForm({ reports, savedPositions, pipeline, editingReport, onSave, onGoToPositions }: Props) {

  function initForm(): DailyReport {
    // Fix: if no editingReport, load today's saved report (not empty)
    const base = editingReport ?? reportForDate(reports, todayISO()) ?? newEmptyReport()
    return { ...base, jobs: buildJobsForDate(savedPositions, base.jobs) }
  }

  const [form,  setForm]  = useState<DailyReport>(initForm)
  const [saved, setSaved] = useState(false)

  // Re-init when editingReport changes
  useEffect(() => {
    const base = editingReport ?? reportForDate(reports, todayISO()) ?? newEmptyReport()
    setForm({ ...base, jobs: buildJobsForDate(savedPositions, base.jobs) })
    setSaved(false)
  }, [editingReport])

  // Re-merge when positions change (don't reset existing numbers)
  useEffect(() => {
    setForm(prev => ({ ...prev, jobs: buildJobsForDate(savedPositions, prev.jobs) }))
  }, [savedPositions])

  function set<K extends keyof DailyReport>(key: K, value: DailyReport[K]) {
    setForm(prev => ({ ...prev, [key]: value, updatedAt: new Date().toISOString() }))
    setSaved(false)
  }

  function shiftDay(delta: number) {
    const d = new Date(form.date + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    const newDate = toISODate(d)
    const base    = reportForDate(reports, newDate) ?? newEmptyReport(newDate)
    setForm({ ...base, jobs: buildJobsForDate(savedPositions, base.jobs) })
    setSaved(false)
  }

  const isToday = form.date === todayISO()

  const totalCost     = form.jobs.reduce((s, j) => s + j.campaignCost, 0)
  const totalLeads    = form.jobs.reduce((s, j) => s + j.leadsIn, 0)
  const totalRelevant = form.jobs.reduce((s, j) => s + j.relevantLeads, 0)

  function updateJob(id: string, patch: Partial<JobPosition>) {
    set('jobs', form.jobs.map(j => j.id === id ? { ...j, ...patch } : j))
  }

  function addAdHocJob() {
    set('jobs', [...form.jobs, {
      id: generateId(), companyName: '', positionTitle: '', city: '',
      campaignCost: 0, leadsIn: 0, relevantLeads: 0,
    }])
  }

  function removeAdHocJob(id: string) {
    set('jobs', form.jobs.filter(j => j.id !== id))
  }

  function addClient() {
    set('activeClients', [...form.activeClients, { id: generateId(), name: '', status: 'active' as ClientStatus, notes: '' }])
  }
  function updateClient(id: string, patch: Partial<ActiveClient>) {
    set('activeClients', form.activeClients.map(c => c.id === id ? { ...c, ...patch } : c))
  }
  function removeClient(id: string) {
    set('activeClients', form.activeClients.filter(c => c.id !== id))
  }

  function handleSave() {
    onSave({ ...form, updatedAt: new Date().toISOString() })
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const savedJobs  = form.jobs.filter(j =>  j.savedPositionId)
  const adHocJobs  = form.jobs.filter(j => !j.savedPositionId)
  const avgCPL     = calcCostPerLead(totalCost, totalLeads)

  // Pipeline companies that are near close — quick reference
  const nearClose = pipeline.filter(c => c.stage === 'negotiating' || c.stage === 'offer_sent')

  return (
    <div className="max-w-3xl mx-auto pb-12">

      {/* Day selector */}
      <div className="card mb-6 flex items-center justify-between">
        <button onClick={() => shiftDay(-1)} className="btn-secondary !px-3">
          <ChevronRight size={18} />
          <span className="hidden sm:inline">יום קודם</span>
        </button>
        <div className="text-center">
          <p className="text-xs text-slate-500 mb-0.5">יום מדווח</p>
          <p className="font-bold text-slate-800">{formatDateHe(form.date)}</p>
          {isToday && <span className="badge badge-green mt-1">היום</span>}
        </div>
        <button onClick={() => shiftDay(1)} disabled={isToday} className="btn-secondary !px-3 disabled:opacity-40">
          <span className="hidden sm:inline">יום הבא</span>
          <ChevronLeft size={18} />
        </button>
      </div>

      {/* ── הוד — משרות קמפיינים ── */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title !mb-0">
            <span className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700">
              <Megaphone size={16} />
            </span>
            הוד — שיווק וגיוס מועמדים
          </h2>
          <button onClick={onGoToPositions} className="btn-secondary !px-3 !py-1.5 text-xs">
            <Settings size={13} /> ניהול משרות
          </button>
        </div>

        {/* Saved positions */}
        {savedJobs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 border border-dashed border-slate-200 rounded-xl text-slate-400 text-sm mb-4">
            <Building2 size={32} className="opacity-30" />
            <p className="font-medium">אין משרות קבועות מוגדרות</p>
            <button onClick={onGoToPositions} className="btn-primary text-sm"><Plus size={14} /> הגדר משרות</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 mb-4">
            {savedJobs.map(job => {
              const cpl = calcCostPerLead(job.campaignCost, job.leadsIn)
              return (
                <div key={job.id} className="rounded-xl border border-slate-100 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                    <Building2 size={14} className="text-brand-500 shrink-0" />
                    <span className="font-semibold text-slate-800">{job.companyName}</span>
                    {job.positionTitle && <span className="text-slate-500 text-sm">· {job.positionTitle}</span>}
                    {job.city && <span className="text-slate-400 text-xs">({job.city})</span>}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 p-3 items-end bg-white">
                    <div>
                      <label className="label text-xs">עלות קמפיין (₪)</label>
                      <input type="number" min={0} className="input-field text-sm" placeholder="0"
                        value={job.campaignCost || ''}
                        onChange={e => updateJob(job.id, { campaignCost: Math.max(0, Number(e.target.value)) })} />
                    </div>
                    <div>
                      <label className="label text-xs">לידים שנכנסו</label>
                      <input type="number" min={0} className="input-field text-sm" placeholder="0"
                        value={job.leadsIn || ''}
                        onChange={e => updateJob(job.id, { leadsIn: Math.max(0, Number(e.target.value)) })} />
                    </div>
                    <div>
                      <label className="label text-xs">רלוונטיים</label>
                      <input type="number" min={0} className="input-field text-sm" placeholder="0"
                        value={job.relevantLeads || ''}
                        onChange={e => updateJob(job.id, { relevantLeads: Math.max(0, Number(e.target.value)) })} />
                    </div>
                    <div className="bg-brand-50 rounded-lg px-3 py-2 border border-brand-100 text-center">
                      <p className="text-[10px] text-brand-600">עלות לליד</p>
                      <p className={`font-bold text-sm ${cpl > 30 ? 'text-red-600' : 'text-brand-800'}`}>
                        {cpl > 0 ? formatCurrency(cpl) : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Ad-hoc jobs */}
        {adHocJobs.length > 0 && (
          <div className="flex flex-col gap-3 mb-4">
            <p className="text-xs font-semibold text-slate-500">משרות חד-פעמיות להיום</p>
            {adHocJobs.map(job => {
              const cpl = calcCostPerLead(job.campaignCost, job.leadsIn)
              return (
                <div key={job.id} className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                    <input type="text" className="input-field text-sm" placeholder="שם החברה"
                      value={job.companyName} onChange={e => updateJob(job.id, { companyName: e.target.value })} />
                    <input type="text" className="input-field text-sm" placeholder="תפקיד"
                      value={job.positionTitle} onChange={e => updateJob(job.id, { positionTitle: e.target.value })} />
                    <input type="text" className="input-field text-sm" placeholder="עיר"
                      value={job.city} onChange={e => updateJob(job.id, { city: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 items-end">
                    <div>
                      <label className="label text-xs">עלות (₪)</label>
                      <input type="number" min={0} className="input-field text-sm" placeholder="0"
                        value={job.campaignCost || ''} onChange={e => updateJob(job.id, { campaignCost: Math.max(0, Number(e.target.value)) })} />
                    </div>
                    <div>
                      <label className="label text-xs">לידים</label>
                      <input type="number" min={0} className="input-field text-sm" placeholder="0"
                        value={job.leadsIn || ''} onChange={e => updateJob(job.id, { leadsIn: Math.max(0, Number(e.target.value)) })} />
                    </div>
                    <div>
                      <label className="label text-xs">רלוונטיים</label>
                      <input type="number" min={0} className="input-field text-sm" placeholder="0"
                        value={job.relevantLeads || ''} onChange={e => updateJob(job.id, { relevantLeads: Math.max(0, Number(e.target.value)) })} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="bg-white rounded-lg px-2 py-1.5 border border-amber-200 text-center">
                        <p className="text-[10px] text-amber-600">עלות/ליד</p>
                        <p className={`font-bold text-sm ${cpl > 30 ? 'text-red-600' : 'text-slate-700'}`}>
                          {cpl > 0 ? formatCurrency(cpl) : '—'}
                        </p>
                      </div>
                      <button onClick={() => removeAdHocJob(job.id)} className="btn-danger text-xs flex items-center justify-center gap-1">
                        <Trash2 size={12} /> הסר
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <button onClick={addAdHocJob} className="btn-secondary w-full !justify-center text-sm">
          <Plus size={14} /> הוסף משרה חד-פעמית
        </button>

        {/* Daily totals bar */}
        {(totalLeads > 0 || totalCost > 0) && (
          <div className="grid grid-cols-3 gap-3 mt-4 p-3 bg-slate-100 rounded-xl">
            <div className="text-center">
              <p className="text-xs text-slate-500">סה״כ לידים</p>
              <p className="font-bold text-slate-800">{totalLeads}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-500">עלות ממוצעת לליד</p>
              <p className={`font-bold ${avgCPL > 30 ? 'text-red-600' : 'text-slate-800'}`}>
                {totalLeads > 0 ? formatCurrency(avgCPL) : '—'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-500">רלוונטיים</p>
              <p className="font-bold text-emerald-700">{totalRelevant}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mt-4 mb-4">
          {numInput(form.screeningCalls,      v => set('screeningCalls', v),      'שיחות סינון')}
          {numInput(form.nonaUsersRegistered, v => set('nonaUsersRegistered', v), 'יוזרי נונה שנרשמו')}
        </div>
        <div>
          <label className="label">מה עצר אותי היום</label>
          <textarea className="input-field min-h-[68px] resize-none" placeholder="חסמים, אתגרים..."
            value={form.hodBlockers} onChange={e => set('hodBlockers', e.target.value)} />
        </div>
      </div>

      {/* ── צחי — גיוס לקוחות ── */}
      <div className="card mb-6">
        <h2 className="section-title">
          <span className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
            <Briefcase size={16} />
          </span>
          צחי — גיוס לקוחות עסקיים
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
          {numInput(form.outreachSent,       v => set('outreachSent', v),       'פניות יזומות שיצאו')}
          {numInput(form.companiesNearClose, v => set('companiesNearClose', v), 'חברות קרובות לסגירה')}
          {numInput(form.newClientsSigned,   v => set('newClientsSigned', v),   'לקוחות חדשים שנחתמו')}
        </div>

        {/* Pipeline quick-view */}
        {nearClose.length > 0 && (
          <div className="mb-4 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
            <p className="text-xs font-semibold text-emerald-700 mb-2">חברות בשלב מתקדם (מהפייפליין)</p>
            {nearClose.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-sm py-1">
                <span className={`badge ${PIPELINE_STAGE_COLORS[c.stage]}`}>{PIPELINE_STAGE_LABELS[c.stage]}</span>
                <span className="font-medium text-slate-700">{c.name}</span>
                {c.nextAction && <span className="text-slate-400 text-xs truncate">→ {c.nextAction}</span>}
              </div>
            ))}
          </div>
        )}

        <div>
          <label className="label">מה עצר אותי היום</label>
          <textarea className="input-field min-h-[68px] resize-none" placeholder="חסמים, אתגרים..."
            value={form.tzachiBlockers} onChange={e => set('tzachiBlockers', e.target.value)} />
        </div>
      </div>

      {/* ── לקוחות פעילים ── */}
      <div className="card mb-6">
        <h2 className="section-title">
          <span className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-violet-700">
            <Users size={16} />
          </span>
          לקוחות פעילים — מעקב סטטוס
        </h2>

        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="label !mb-0">לקוחות פעילים — סטטוס</label>
            <button onClick={addClient} className="btn-secondary !px-3 !py-1.5 text-xs">
              <Plus size={14} /> הוסף
            </button>
          </div>
          {form.activeClients.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4 border border-dashed border-slate-200 rounded-xl">אין לקוחות פעילים</p>
          ) : (
            <div className="flex flex-col gap-2">
              {form.activeClients.map(c => (
                <div key={c.id} className="flex gap-2 items-center p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input type="text" className="input-field text-sm" placeholder="שם החברה"
                      value={c.name} onChange={e => updateClient(c.id, { name: e.target.value })} />
                    <select className="input-field text-sm" value={c.status}
                      onChange={e => updateClient(c.id, { status: e.target.value as ClientStatus })}>
                      {STATUS_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                    </select>
                    <input type="text" className="input-field text-sm" placeholder="הערה"
                      value={c.notes} onChange={e => updateClient(c.id, { notes: e.target.value })} />
                  </div>
                  <button onClick={() => removeClient(c.id)} className="btn-danger shrink-0"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="card mb-6">
        <label className="label flex items-center gap-1.5 mb-2"><StickyNote size={14} /> הערות כלליות</label>
        <textarea className="input-field min-h-[80px] resize-none" placeholder="כל מה שחשוב לתעד היום..."
          value={form.generalNotes} onChange={e => set('generalNotes', e.target.value)} />
      </div>

      <div className="flex justify-center">
        <button onClick={handleSave} className="btn-primary text-base px-8 py-3">
          {saved
            ? <><CheckCircle2 size={20} /> נשמר בהצלחה!</>
            : <><Save size={20} /> שמור דיווח יומי</>}
        </button>
      </div>
    </div>
  )
}
