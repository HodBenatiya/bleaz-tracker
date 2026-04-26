import { useState } from 'react'
import { Plus, Edit2, Trash2, Save, X, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react'
import type { PipelineCompany, PipelineStage } from '../types'
import { PIPELINE_STAGE_LABELS, PIPELINE_STAGE_COLORS } from '../types'
import { generateId } from '../utils/helpers'

interface Props {
  pipeline: PipelineCompany[]
  onChange: (pipeline: PipelineCompany[]) => void
}

const STAGES = Object.keys(PIPELINE_STAGE_LABELS) as PipelineStage[]

const STAGE_ORDER: PipelineStage[] = [
  'first_contact', 'meeting_scheduled', 'offer_sent', 'negotiating', 'signed', 'lost',
]

const EMPTY_FORM = {
  name: '', contactPerson: '', stage: 'first_contact' as PipelineStage,
  nextAction: '', notes: '',
}

export default function Pipeline({ pipeline, onChange }: Props) {
  const [isAdding,  setIsAdding]  = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form,      setForm]      = useState({ ...EMPTY_FORM })
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [filter,    setFilter]    = useState<PipelineStage | 'all'>('all')

  function startAdd() {
    setForm({ ...EMPTY_FORM })
    setIsAdding(true)
    setEditingId(null)
  }

  function startEdit(c: PipelineCompany) {
    setForm({ name: c.name, contactPerson: c.contactPerson, stage: c.stage, nextAction: c.nextAction, notes: c.notes })
    setEditingId(c.id)
    setIsAdding(false)
    setExpanded(c.id)
  }

  function cancelEdit() { setIsAdding(false); setEditingId(null) }

  function handleAdd() {
    if (!form.name.trim()) return
    const now = new Date().toISOString()
    onChange([...pipeline, { id: generateId(), ...form, createdAt: now, updatedAt: now }])
    setIsAdding(false)
    setForm({ ...EMPTY_FORM })
  }

  function handleEdit() {
    if (!form.name.trim()) return
    onChange(pipeline.map(c => c.id === editingId
      ? { ...c, ...form, updatedAt: new Date().toISOString() } : c))
    setEditingId(null)
  }

  function advanceStage(id: string) {
    onChange(pipeline.map(c => {
      if (c.id !== id) return c
      const idx  = STAGE_ORDER.indexOf(c.stage)
      const next = STAGE_ORDER[Math.min(idx + 1, STAGE_ORDER.length - 1)]
      return { ...c, stage: next, updatedAt: new Date().toISOString() }
    }))
  }

  function remove(id: string) {
    onChange(pipeline.filter(c => c.id !== id))
  }

  const filtered = pipeline.filter(c => filter === 'all' || c.stage === filter)
  const sorted   = [...filtered].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))

  const counts = STAGES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = pipeline.filter(c => c.stage === s).length
    return acc
  }, {})

  return (
    <div className="max-w-3xl mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-800">פייפליין לקוחות — צחי</h2>
          <p className="text-sm text-slate-500 mt-0.5">מעקב אחרי חברות בתהליך גיוס לקוחות</p>
        </div>
        <button onClick={startAdd} className="btn-primary"><Plus size={16} /> הוסף חברה</button>
      </div>

      {/* Stage summary pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => setFilter('all')}
          className={`badge text-xs px-3 py-1.5 cursor-pointer ${filter === 'all' ? 'bg-brand-600 text-white' : 'badge-gray'}`}
        >
          הכל ({pipeline.length})
        </button>
        {STAGES.filter(s => counts[s] > 0).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`badge text-xs px-3 py-1.5 cursor-pointer ${filter === s ? 'bg-brand-600 text-white' : PIPELINE_STAGE_COLORS[s]}`}
          >
            {PIPELINE_STAGE_LABELS[s]} ({counts[s]})
          </button>
        ))}
      </div>

      {/* Add form */}
      {isAdding && (
        <CompanyForm form={form} onChange={setForm} onSave={handleAdd} onCancel={cancelEdit} title="חברה חדשה" />
      )}

      {/* Empty state */}
      {pipeline.length === 0 && !isAdding && (
        <div className="card text-center py-12 text-slate-400">
          <p className="font-semibold">אין חברות בפייפליין עדיין</p>
          <p className="text-sm mt-1">לחץ "הוסף חברה" כדי להתחיל לעקוב</p>
        </div>
      )}

      {/* Companies list */}
      <div className="flex flex-col gap-3">
        {sorted.map(c => {
          const isOpen    = expanded === c.id
          const isEditing = editingId === c.id
          const stageIdx  = STAGE_ORDER.indexOf(c.stage)
          const canAdvance = c.stage !== 'signed' && c.stage !== 'lost'

          return (
            <div key={c.id} className={`card !p-0 overflow-hidden border-r-4 ${
              c.stage === 'signed' ? 'border-r-emerald-400' :
              c.stage === 'lost'   ? 'border-r-red-300' :
              c.stage === 'negotiating' ? 'border-r-orange-400' :
              'border-r-brand-400'
            }`}>
              {/* Card header */}
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition"
                onClick={() => setExpanded(isOpen ? null : c.id)}
              >
                <div className="flex items-center gap-3">
                  <span className={`badge text-xs ${PIPELINE_STAGE_COLORS[c.stage]}`}>
                    {PIPELINE_STAGE_LABELS[c.stage]}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-800">{c.name}</p>
                    {c.contactPerson && <p className="text-xs text-slate-400">{c.contactPerson}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {c.nextAction && (
                    <p className="text-xs text-slate-400 hidden sm:block max-w-[160px] truncate">→ {c.nextAction}</p>
                  )}
                  {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </div>
              </div>

              {/* Expanded */}
              {isOpen && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                  {isEditing ? (
                    <CompanyForm form={form} onChange={setForm} onSave={handleEdit} onCancel={cancelEdit} title="עריכה" />
                  ) : (
                    <>
                      {/* Stage progress bar */}
                      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
                        {STAGE_ORDER.filter(s => s !== 'lost').map((s, i) => (
                          <div key={s} className="flex items-center gap-1 shrink-0">
                            <div className={`text-[10px] px-2 py-1 rounded-full font-medium ${
                              s === c.stage ? PIPELINE_STAGE_COLORS[s] + ' ring-2 ring-offset-1 ring-brand-400' :
                              i < stageIdx  ? 'bg-slate-200 text-slate-500' : 'bg-slate-100 text-slate-400'
                            }`}>
                              {PIPELINE_STAGE_LABELS[s]}
                            </div>
                            {i < STAGE_ORDER.filter(s => s !== 'lost').length - 1 && (
                              <ArrowLeft size={10} className="text-slate-300 shrink-0" />
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                        {c.contactPerson && (
                          <div>
                            <p className="text-xs text-slate-400">איש קשר</p>
                            <p className="text-sm font-medium text-slate-700">{c.contactPerson}</p>
                          </div>
                        )}
                        {c.nextAction && (
                          <div>
                            <p className="text-xs text-slate-400">פעולה הבאה</p>
                            <p className="text-sm font-medium text-slate-700">{c.nextAction}</p>
                          </div>
                        )}
                        {c.notes && (
                          <div className="sm:col-span-2">
                            <p className="text-xs text-slate-400">הערות</p>
                            <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mt-0.5">{c.notes}</p>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {canAdvance && (
                          <button onClick={() => advanceStage(c.id)} className="btn-primary text-sm !px-4 !py-2">
                            קדם שלב ← {PIPELINE_STAGE_LABELS[STAGE_ORDER[stageIdx + 1]]}
                          </button>
                        )}
                        <button onClick={() => startEdit(c)} className="btn-secondary text-sm !px-4 !py-2">
                          <Edit2 size={14} /> ערוך
                        </button>
                        <button onClick={() => remove(c.id)} className="btn-danger">
                          <Trash2 size={14} /> מחק
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Form ──
interface FormProps {
  form:     typeof EMPTY_FORM
  onChange: (f: typeof EMPTY_FORM) => void
  onSave:   () => void
  onCancel: () => void
  title:    string
}

function CompanyForm({ form, onChange, onSave, onCancel, title }: FormProps) {
  return (
    <div className="card border border-brand-200 bg-brand-50/30 mb-4">
      <p className="font-semibold text-slate-700 mb-3">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="label">שם החברה *</label>
          <input type="text" className="input-field" placeholder="לדוגמה: בזק" autoFocus
            value={form.name} onChange={e => onChange({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">איש קשר</label>
          <input type="text" className="input-field" placeholder="שם + תפקיד"
            value={form.contactPerson} onChange={e => onChange({ ...form, contactPerson: e.target.value })} />
        </div>
        <div>
          <label className="label">שלב בתהליך</label>
          <select className="input-field" value={form.stage}
            onChange={e => onChange({ ...form, stage: e.target.value as PipelineStage })}>
            {STAGES.map(s => <option key={s} value={s}>{PIPELINE_STAGE_LABELS[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">פעולה הבאה</label>
          <input type="text" className="input-field" placeholder="מה צריך לעשות עכשיו?"
            value={form.nextAction} onChange={e => onChange({ ...form, nextAction: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">הערות</label>
          <textarea className="input-field resize-none min-h-[64px]" placeholder="פרטים נוספים..."
            value={form.notes} onChange={e => onChange({ ...form, notes: e.target.value })} />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} disabled={!form.name.trim()} className="btn-primary">
          <Save size={15} /> שמור
        </button>
        <button onClick={onCancel} className="btn-secondary"><X size={15} /> ביטול</button>
      </div>
    </div>
  )
}
