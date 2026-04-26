import { useState } from 'react'
import { ChevronDown, ChevronUp, Edit2, Trash2, Building2, Users } from 'lucide-react'
import type { DailyReport } from '../types'
import { CLIENT_STATUS_LABELS } from '../types'
import { sortedReports, formatDateHe, formatCurrency, calcCostPerLead } from '../utils/helpers'

interface Props {
  reports: DailyReport[]
  onEdit:   (r: DailyReport) => void
  onDelete: (id: string) => void
}

export default function History({ reports, onEdit, onDelete }: Props) {
  const [expanded,      setExpanded]      = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const sorted = sortedReports(reports)

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p className="text-lg font-semibold">אין דיווחים שמורים</p>
        <p className="text-sm mt-1">צור דיווח יומי ראשון כדי לראות היסטוריה</p>
      </div>
    )
  }

  function toggle(id: string) {
    setExpanded(prev => prev === id ? null : id)
  }

  function handleDelete(id: string) {
    if (confirmDelete === id) {
      onDelete(id)
      setConfirmDelete(null)
      if (expanded === id) setExpanded(null)
    } else {
      setConfirmDelete(id)
    }
  }

  return (
    <div className="max-w-3xl mx-auto pb-12 flex flex-col gap-3">
      {sorted.map(r => {
        const isOpen      = expanded === r.id
        const isPending   = confirmDelete === r.id
        const totalLeads  = r.jobs.reduce((s, j) => s + j.leadsIn, 0)
        const totalCost   = r.jobs.reduce((s, j) => s + j.campaignCost, 0)
        const cpl         = calcCostPerLead(totalCost, totalLeads)

        return (
          <div key={r.id} className="card !p-0 overflow-hidden">
            {/* Header */}
            <button
              className="w-full flex items-center justify-between p-5 text-right hover:bg-slate-50 transition"
              onClick={() => toggle(r.id)}
            >
              <div className="flex items-center gap-3">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  totalLeads > 0 ? 'bg-amber-400' : 'bg-slate-300'
                }`} />
                <span className="font-semibold text-slate-700 text-sm">{formatDateHe(r.date)}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex gap-3">
                  <Pill label="לידים"  value={String(totalLeads)}     color={totalLeads > 0 ? 'blue' : 'gray'} />
                  <Pill label="פניות"  value={String(r.outreachSent)} color="purple" />
                  <Pill label="לקוחות" value={String(r.newClientsSigned)} color={r.newClientsSigned > 0 ? 'green' : 'gray'} />
                </div>
                {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </div>
            </button>

            {/* Expanded */}
            {isOpen && (
              <div className="border-t border-slate-100 px-5 pb-5 pt-4">
                {/* Mobile pills */}
                <div className="flex gap-2 mb-4 sm:hidden">
                  <Pill label="לידים"  value={String(totalLeads)}        color="blue" />
                  <Pill label="פניות"  value={String(r.outreachSent)}    color="purple" />
                  <Pill label="לקוחות" value={String(r.newClientsSigned)} color="green" />
                </div>

                {/* Jobs */}
                {r.jobs.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                      <Building2 size={12} /> משרות
                    </p>
                    <div className="flex flex-col gap-2">
                      {r.jobs.map(j => {
                        const jcpl = calcCostPerLead(j.campaignCost, j.leadsIn)
                        return (
                          <div key={j.id} className="flex flex-wrap items-center gap-2 text-sm p-2.5 bg-slate-50 rounded-lg">
                            <span className="font-medium text-slate-800">{j.companyName}</span>
                            {j.positionTitle && <span className="text-slate-500">· {j.positionTitle}</span>}
                            {j.city && <span className="text-slate-400 text-xs">({j.city})</span>}
                            <div className="flex gap-3 mr-auto text-xs">
                              <span className="text-blue-700">לידים: {j.leadsIn}</span>
                              <span className="text-emerald-700">רלוונטיים: {j.relevantLeads}</span>
                              {jcpl > 0 && <span className={jcpl > 30 ? 'text-red-600' : 'text-slate-600'}>₪{jcpl}/ליד</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Stats grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <MiniStat label="עלות לליד"     value={cpl > 0 ? formatCurrency(cpl) : '—'} alert={cpl > 30} />
                  <MiniStat label="שיחות סינון"   value={String(r.screeningCalls)} />
                  <MiniStat label="פניות יזומות"  value={String(r.outreachSent)} />
                  <MiniStat label="לקוחות חדשים"  value={String(r.newClientsSigned)} />
                </div>

                {/* Active clients */}
                {r.activeClients.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                      <Users size={12} /> לקוחות פעילים
                    </p>
                    {r.activeClients.map(c => (
                      <div key={c.id} className="flex items-center gap-2 text-sm mb-1">
                        <span className={`badge ${c.status==='active'?'badge-green':c.status==='negotiating'?'badge-blue':c.status==='pending'?'badge-yellow':'badge-gray'}`}>
                          {CLIENT_STATUS_LABELS[c.status]}
                        </span>
                        <span className="font-medium">{c.name}</span>
                        {c.notes && <span className="text-slate-400 text-xs">· {c.notes}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {r.hodBlockers    && <BlockRow label="הוד — חסמים"  text={r.hodBlockers} />}
                {r.tzachiBlockers && <BlockRow label="צחי — חסמים" text={r.tzachiBlockers} />}
                {r.generalNotes   && <BlockRow label="הערות כלליות" text={r.generalNotes} />}

                {/* Actions */}
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-100">
                  <button className="btn-secondary text-sm !px-4 !py-2" onClick={() => onEdit(r)}>
                    <Edit2 size={14} /> ערוך
                  </button>
                  <button
                    className={`btn-danger ${isPending ? '!bg-red-600 !text-white' : ''}`}
                    onClick={() => handleDelete(r.id)}
                  >
                    <Trash2 size={14} />
                    {isPending ? 'לחץ שוב לאישור מחיקה' : 'מחק'}
                  </button>
                  {isPending && (
                    <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setConfirmDelete(null)}>
                      ביטול
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Pill({ label, value, color }: { label: string; value: string; color: 'blue' | 'green' | 'gray' | 'purple' }) {
  const cls = { blue: 'bg-blue-50 text-blue-700', green: 'bg-emerald-50 text-emerald-700', gray: 'bg-slate-100 text-slate-500', purple: 'bg-violet-50 text-violet-700' }[color]
  return (
    <span className={`inline-flex flex-col items-center px-3 py-1 rounded-lg text-xs font-medium ${cls}`}>
      <span className="font-bold text-sm">{value}</span>
      <span className="opacity-70">{label}</span>
    </span>
  )
}

function MiniStat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`font-semibold text-sm ${alert ? 'text-red-600' : 'text-slate-700'}`}>{value}</p>
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
