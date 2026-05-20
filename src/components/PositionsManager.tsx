import { useState } from 'react'
import { Plus, Edit2, Trash2, CheckCircle2, ToggleLeft, ToggleRight, Save, X, ChevronDown, ChevronUp, Phone } from 'lucide-react'
import type { SavedPosition, Candidate, CandidateStatus } from '../types'
import { CANDIDATE_STATUS_LABELS, CANDIDATE_STATUS_COLORS } from '../types'
import { generateId, formatCurrency, calcCostPerLead } from '../utils/helpers'

interface Props {
  positions:  SavedPosition[]
  reports:    { jobs: { savedPositionId?: string; leadsIn: number; relevantLeads: number; campaignCost: number }[] }[]
  candidates: Candidate[]
  onChange:   (positions: SavedPosition[]) => void
}

const POSITION_RELEVANT_STATUSES: CandidateStatus[] = [
  'sent_to_client', 'interview_scheduled', 'started_working', 'placement_complete',
]

const EMPTY: Omit<SavedPosition, 'id' | 'createdAt' | 'isActive' | 'funnelSentToClient' | 'funnelInterviews' | 'funnelAccepted' | 'funnelConfirmed'> = {
  companyName: '', positionTitle: '', city: '',
}

function numField(label: string, value: number, onChange: (v: number) => void, sub?: string) {
  return (
    <div>
      <label className="label text-xs">{label}</label>
      {sub && <p className="text-[10px] text-slate-400 mb-1">{sub}</p>}
      <input type="number" min={0} className="input-field text-sm"
        value={value || ''} placeholder="0"
        onChange={e => onChange(Math.max(0, Number(e.target.value)))} />
    </div>
  )
}

export default function PositionsManager({ positions, reports, candidates, onChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding,  setIsAdding]  = useState(false)
  const [form,      setForm]      = useState({ ...EMPTY })
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [saved,     setSaved]     = useState(false)

  function startAdd() {
    setForm({ ...EMPTY })
    setIsAdding(true)
    setEditingId(null)
  }

  function startEdit(pos: SavedPosition) {
    setForm({ companyName: pos.companyName, positionTitle: pos.positionTitle, city: pos.city })
    setEditingId(pos.id)
    setIsAdding(false)
  }

  function cancelEdit() { setEditingId(null); setIsAdding(false) }

  function handleSaveNew() {
    if (!form.companyName.trim()) return
    const newPos: SavedPosition = {
      id: generateId(), ...form,
      isActive: true,
      createdAt: new Date().toISOString(),
      funnelSentToClient: 0, funnelInterviews: 0,
      funnelAccepted: 0, funnelConfirmed: 0,
    }
    onChange([...positions, newPos])
    setIsAdding(false)
    setForm({ ...EMPTY })
    flash()
  }

  function handleSaveEdit() {
    if (!form.companyName.trim()) return
    onChange(positions.map(p => p.id === editingId ? { ...p, ...form } : p))
    setEditingId(null)
    flash()
  }

  function updateFunnel(id: string, field: keyof Pick<SavedPosition, 'funnelSentToClient' | 'funnelInterviews' | 'funnelAccepted' | 'funnelConfirmed'>, value: number) {
    onChange(positions.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  function toggleActive(id: string) {
    onChange(positions.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p))
  }

  function remove(id: string) { onChange(positions.filter(p => p.id !== id)) }

  function flash() { setSaved(true); setTimeout(() => setSaved(false), 2000) }

  // Calculate campaign totals per position from reports
  function getCampaignStats(posId: string) {
    let leads = 0, relevant = 0, cost = 0
    for (const r of reports) {
      for (const j of r.jobs) {
        if (j.savedPositionId === posId) {
          leads    += j.leadsIn
          relevant += j.relevantLeads
          cost     += j.campaignCost
        }
      }
    }
    return { leads, relevant, cost, cpl: calcCostPerLead(cost, leads) }
  }

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-800">משרות קבועות</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            עדכן את הפאנל לכל משרה כשמשהו קורה — ללא תלות בתאריך ספציפי
          </p>
        </div>
        <button onClick={startAdd} className="btn-primary"><Plus size={16} /> הוסף משרה</button>
      </div>

      {saved && (
        <div className="alert-blue mb-4"><CheckCircle2 size={16} /> <span className="text-sm font-medium">נשמר</span></div>
      )}

      {isAdding && (
        <PositionForm form={form} onChange={setForm} onSave={handleSaveNew} onCancel={cancelEdit} title="משרה חדשה" />
      )}

      {positions.length === 0 && !isAdding ? (
        <div className="card text-center py-12 text-slate-400">
          <p className="font-semibold">אין משרות מוגדרות</p>
          <p className="text-sm mt-1">לחץ "הוסף משרה" להוספת המשרה הראשונה</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {positions.map(pos => {
            const isOpen    = expanded === pos.id
            const isEditing = editingId === pos.id
            const stats     = getCampaignStats(pos.id)
            const revenue   = pos.funnelConfirmed * 5000

            return (
              <div key={pos.id}
                className={`card !p-0 overflow-hidden border-r-4 ${pos.isActive ? 'border-r-brand-500' : 'border-r-slate-200'}`}>

                {/* Header */}
                <div
                  className={`flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50 transition ${!pos.isActive ? 'opacity-50' : ''}`}
                  onClick={() => setExpanded(isOpen ? null : pos.id)}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800">{pos.companyName}</span>
                      {!pos.isActive && <span className="badge badge-gray text-xs">מושהית</span>}
                    </div>
                    <p className="text-xs text-slate-500">{pos.positionTitle}{pos.city ? ` · ${pos.city}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Quick stats */}
                    <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
                      <span className="text-blue-700 font-medium">{stats.leads} לידים</span>
                      <span className="text-emerald-700 font-medium">{pos.funnelConfirmed} אושרו</span>
                      {revenue > 0 && <span className="text-violet-700 font-medium">{formatCurrency(revenue)}</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={e => { e.stopPropagation(); toggleActive(pos.id) }} className="p-1 text-slate-400 hover:text-brand-600 transition">
                        {pos.isActive ? <ToggleRight size={20} className="text-brand-600" /> : <ToggleLeft size={20} />}
                      </button>
                      <button onClick={e => { e.stopPropagation(); startEdit(pos) }} className="p-1 text-slate-400 hover:text-slate-700 transition">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); remove(pos.id) }} className="p-1 text-slate-400 hover:text-red-500 transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                  </div>
                </div>

                {/* Expanded */}
                {isOpen && (
                  <div className="border-t border-slate-100 p-4">
                    {isEditing ? (
                      <PositionForm form={form} onChange={setForm} onSave={handleSaveEdit} onCancel={cancelEdit} title="עריכה" />
                    ) : (
                      <>
                        {/* Linked candidates */}
                        {(() => {
                          const linked = candidates.filter(c => c.savedPositionId === pos.id)
                          if (linked.length === 0) return null
                          const byStatus = POSITION_RELEVANT_STATUSES.map(s => ({
                            status: s,
                            items: linked.filter(c => c.status === s),
                          })).filter(g => g.items.length > 0)
                          const otherItems = linked.filter(c => !POSITION_RELEVANT_STATUSES.includes(c.status))
                          return (
                            <div className="mb-4">
                              <p className="text-xs font-semibold text-slate-500 mb-2">
                                מועמדים משויכים ({linked.length})
                              </p>
                              <div className="space-y-2">
                                {byStatus.map(group => (
                                  <div key={group.status}>
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CANDIDATE_STATUS_COLORS[group.status]}`}>
                                        {CANDIDATE_STATUS_LABELS[group.status]}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2 pr-2">
                                      {group.items.map(c => (
                                        <div key={c.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-200">
                                          <span className="text-sm font-medium text-slate-800">{c.name}</span>
                                          <a href={`tel:${c.phone}`} className="flex items-center gap-0.5 text-xs text-brand-600 hover:underline">
                                            <Phone size={10} />{c.phone}
                                          </a>
                                          {c.interviewDate && (
                                            <span className="text-xs text-indigo-600">
                                              ראיון: {new Date(c.interviewDate + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                                            </span>
                                          )}
                                          {c.startDate && (
                                            <span className="text-xs text-emerald-600">
                                              התחיל: {new Date(c.startDate + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                                {otherItems.length > 0 && (
                                  <div>
                                    <p className="text-xs text-slate-400 mb-1">בתהליך</p>
                                    <div className="flex flex-wrap gap-2 pr-2">
                                      {otherItems.map(c => (
                                        <div key={c.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-200">
                                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${CANDIDATE_STATUS_COLORS[c.status]}`}>
                                            {CANDIDATE_STATUS_LABELS[c.status]}
                                          </span>
                                          <span className="text-sm font-medium text-slate-800">{c.name}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="border-t border-slate-100 mt-3" />
                            </div>
                          )
                        })()}

                        {/* Campaign stats (read-only, from daily reports) */}
                        <div className="mb-4">
                          <p className="text-xs font-semibold text-slate-500 mb-2">נתוני קמפיין (מהדיווחים היומיים)</p>
                          <div className="grid grid-cols-4 gap-3 p-3 bg-slate-50 rounded-xl text-center">
                            <div>
                              <p className="text-xs text-slate-400">עלות סה״כ</p>
                              <p className="font-bold text-slate-700 text-sm">{stats.cost > 0 ? formatCurrency(stats.cost) : '—'}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-400">לידים</p>
                              <p className="font-bold text-blue-700 text-sm">{stats.leads}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-400">רלוונטיים</p>
                              <p className="font-bold text-emerald-700 text-sm">{stats.relevant}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-400">עלות/ליד</p>
                              <p className={`font-bold text-sm ${stats.cpl > 30 ? 'text-red-600' : 'text-slate-700'}`}>
                                {stats.cpl > 0 ? formatCurrency(stats.cpl) : '—'}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Funnel — manual update */}
                        <div>
                          <p className="text-xs font-semibold text-slate-500 mb-2">
                            פאנל מועמדים — עדכן כשמשהו קורה בפועל
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                            {numField('נשלחו ללקוח', pos.funnelSentToClient,
                              v => updateFunnel(pos.id, 'funnelSentToClient', v),
                              'פרופילים שנשלחו לאישור')}
                            {numField('ראיונות', pos.funnelInterviews,
                              v => updateFunnel(pos.id, 'funnelInterviews', v),
                              'ראיונות שנקיימו')}
                            {numField('התחילו לעבוד', pos.funnelAccepted,
                              v => updateFunnel(pos.id, 'funnelAccepted', v),
                              'התקבלו והתחילו')}
                            {numField('עברו אחריות ✓', pos.funnelConfirmed,
                              v => updateFunnel(pos.id, 'funnelConfirmed', v),
                              'הכנסה מאושרת')}
                          </div>

                          {/* Funnel visualization */}
                          {stats.leads > 0 && (
                            <div className="flex items-center gap-1 mt-3 text-xs text-center overflow-x-auto">
                              {[
                                { label: 'לידים',        value: stats.leads,            color: 'bg-blue-100 text-blue-800' },
                                { label: 'רלוונטיים',    value: stats.relevant,         color: 'bg-indigo-100 text-indigo-800' },
                                { label: 'נשלחו',        value: pos.funnelSentToClient, color: 'bg-violet-100 text-violet-800' },
                                { label: 'ראיונות',      value: pos.funnelInterviews,   color: 'bg-amber-100 text-amber-800' },
                                { label: 'התחילו',       value: pos.funnelAccepted,     color: 'bg-orange-100 text-orange-800' },
                                { label: 'אושרו ✓',      value: pos.funnelConfirmed,    color: 'bg-emerald-100 text-emerald-800' },
                              ].map((step, i, arr) => (
                                <div key={step.label} className="flex items-center gap-1 shrink-0">
                                  <div className={`px-2 py-1 rounded-lg ${step.color}`}>
                                    <p className="font-bold">{step.value}</p>
                                    <p className="text-[9px]">{step.label}</p>
                                  </div>
                                  {i < arr.length - 1 && (
                                    <span className="text-slate-300">→</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Revenue summary */}
                          {pos.funnelConfirmed > 0 && (
                            <div className="mt-3 p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
                              <div>
                                <p className="text-xs text-emerald-600">הכנסה מאושרת מהמשרה</p>
                                <p className="text-lg font-black text-emerald-700">{formatCurrency(revenue)}</p>
                              </div>
                              {stats.cost > 0 && (
                                <div className="text-left">
                                  <p className="text-xs text-slate-500">רווח נקי</p>
                                  <p className={`font-bold ${revenue - stats.cost >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                    {formatCurrency(revenue - stats.cost)}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
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

      {positions.length > 0 && (
        <p className="text-xs text-slate-400 mt-4 text-center">
          {positions.filter(p => p.isActive).length} פעילות · {positions.length} סה״כ
        </p>
      )}
    </div>
  )
}

interface FormProps {
  form:     typeof EMPTY
  onChange: (f: typeof EMPTY) => void
  onSave:   () => void
  onCancel: () => void
  title:    string
}

function PositionForm({ form, onChange, onSave, onCancel, title }: FormProps) {
  return (
    <div className="card border border-brand-200 bg-brand-50/40 mb-4">
      <p className="font-semibold text-slate-700 mb-3">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="label">שם החברה *</label>
          <input type="text" className="input-field" placeholder="לדוגמה: TAG" autoFocus
            value={form.companyName} onChange={e => onChange({ ...form, companyName: e.target.value })} />
        </div>
        <div>
          <label className="label">תפקיד</label>
          <input type="text" className="input-field" placeholder="לדוגמה: נציג מכירות"
            value={form.positionTitle} onChange={e => onChange({ ...form, positionTitle: e.target.value })} />
        </div>
        <div>
          <label className="label">עיר</label>
          <input type="text" className="input-field" placeholder="לדוגמה: תל אביב"
            value={form.city} onChange={e => onChange({ ...form, city: e.target.value })} />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} disabled={!form.companyName.trim()} className="btn-primary">
          <Save size={15} /> שמור
        </button>
        <button onClick={onCancel} className="btn-secondary"><X size={15} /> ביטול</button>
      </div>
    </div>
  )
}
