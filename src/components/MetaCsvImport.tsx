import { useState, useRef } from 'react'
import { X, Upload, CheckCircle, AlertCircle, FileText } from 'lucide-react'
import type { JobPosition, SavedPosition } from '../types'
import { generateId } from '../utils/helpers'

interface Props {
  savedPositions: SavedPosition[]
  currentJobs:    JobPosition[]
  onApply:        (jobs: JobPosition[]) => void
  onClose:        () => void
}

interface ParsedRow {
  campaignName: string
  spend:        number
  leads:        number
  checked:      boolean
  selectedJobId: string
}

// Try to find a column by several possible header names
function findCol(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(c.toLowerCase()))
    if (idx >= 0) return idx
  }
  return -1
}

function parseMetaCsv(text: string): ParsedRow[] | string {
  // Meta sometimes wraps the whole thing in quotes or has a BOM
  const clean = text.replace(/^﻿/, '').trim()
  const lines  = clean.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return 'הקובץ ריק או לא תקין'

  // Parse CSV properly (handles quoted fields)
  function parseLine(line: string): string[] {
    const result: string[] = []
    let cur = '', inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    result.push(cur.trim())
    return result
  }

  const headers = parseLine(lines[0])

  const colCampaign = findCol(headers, ['campaign name', 'שם קמפיין', 'campaign'])
  const colSpend    = findCol(headers, ['amount spent', 'סכום שהוצא', 'spend', 'cost', 'הוצאה'])
  const colLeads    = findCol(headers, ['results', 'leads', 'תוצאות', 'לידים'])

  if (colCampaign < 0) return 'לא נמצאה עמודת שם קמפיין. ייצא דוח ברמת קמפיין עם העמודות: שם קמפיין, סכום שהוצא, תוצאות.'
  if (colSpend < 0)    return 'לא נמצאה עמודת הוצאה. ודא שהדוח כולל "Amount spent".'

  const rows: ParsedRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i])
    if (cols.length < 2) continue

    const name  = cols[colCampaign]?.replace(/^"|"$/g, '').trim()
    const spend = parseFloat((cols[colSpend] ?? '0').replace(/[^\d.]/g, '')) || 0
    const leads = colLeads >= 0 ? parseInt((cols[colLeads] ?? '0').replace(/[^\d]/g, '')) || 0 : 0

    // Skip totals rows and empty rows
    if (!name || name.toLowerCase().includes('total') || name === 'סה"כ') continue
    if (spend === 0 && leads === 0) continue

    rows.push({ campaignName: name, spend, leads, checked: true, selectedJobId: 'new' })
  }

  if (rows.length === 0) return 'לא נמצאו שורות עם נתונים. ודא שהדוח ברמת קמפיין ויש נתוני הוצאה.'
  return rows
}

export default function MetaCsvImport({ savedPositions, currentJobs, onApply, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows,   setRows]   = useState<ParsedRow[] | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const activePositions = savedPositions.filter(p => p.isActive)

  function handleFile(file: File) {
    if (!file.name.endsWith('.csv')) { setError('יש לבחור קובץ CSV בלבד'); return }
    const reader = new FileReader()
    reader.onload = e => {
      const text   = e.target?.result as string
      const result = parseMetaCsv(text)
      if (typeof result === 'string') { setError(result); setRows(null) }
      else {
        // Try to auto-match to saved positions
        const matched = result.map(r => {
          const match = activePositions.find(p =>
            r.campaignName.toLowerCase().includes(p.positionTitle.toLowerCase()) ||
            r.campaignName.toLowerCase().includes(p.companyName.toLowerCase())
          )
          return { ...r, selectedJobId: match?.id ?? 'new' }
        })
        setRows(matched)
        setError(null)
      }
    }
    reader.readAsText(file, 'UTF-8')
  }

  function updateRow(i: number, patch: Partial<ParsedRow>) {
    setRows(prev => prev ? prev.map((r, idx) => idx === i ? { ...r, ...patch } : r) : null)
  }

  function applyToForm() {
    if (!rows) return
    const checked = rows.filter(r => r.checked)
    let jobs = [...currentJobs]

    for (const row of checked) {
      if (row.selectedJobId !== 'new') {
        const idx = jobs.findIndex(j => j.savedPositionId === row.selectedJobId)
        if (idx >= 0) {
          jobs[idx] = { ...jobs[idx], campaignCost: row.spend, leadsIn: row.leads }
        } else {
          const pos = activePositions.find(p => p.id === row.selectedJobId)
          if (pos) {
            jobs.push({
              id: generateId(), savedPositionId: pos.id,
              companyName: pos.companyName, positionTitle: pos.positionTitle, city: pos.city,
              campaignCost: row.spend, leadsIn: row.leads, relevantLeads: 0,
            })
          }
        }
      } else {
        jobs.push({
          id: generateId(), companyName: row.campaignName, positionTitle: '', city: '',
          campaignCost: row.spend, leadsIn: row.leads, relevantLeads: 0,
        })
      }
    }

    onApply(jobs)
    onClose()
  }

  const checkedCount = rows?.filter(r => r.checked).length ?? 0

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col" dir="rtl">

        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <FileText size={15} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-slate-800 leading-none">ייבוא CSV מ-Meta</p>
              <p className="text-xs text-slate-400 mt-0.5">מנהל המודעות → ייצוא → העלה כאן</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">

          {/* instructions */}
          {!rows && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-sm text-indigo-800 space-y-1">
              <p className="font-semibold">איך מייצאים מ-Meta Ads Manager:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
                <li>כנס למנהל המודעות ← בחר טווח תאריכים (היום)</li>
                <li>ודא שהתצוגה ברמת <strong>קמפיין</strong></li>
                <li>לחץ <strong>ייצוא</strong> (פינה ימנית למעלה) ← <strong>ייצא טבלה כ-CSV</strong></li>
                <li>העלה את הקובץ כאן</li>
              </ol>
            </div>
          )}

          {/* drop zone */}
          {!rows && (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition ${
                dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 hover:border-indigo-300 hover:bg-slate-50'
              }`}
            >
              <Upload size={32} className="mx-auto text-slate-400 mb-3" />
              <p className="text-sm font-medium text-slate-600">גרור CSV לכאן או לחץ לבחירה</p>
              <p className="text-xs text-slate-400 mt-1">קובץ CSV מ-Meta Ads Manager בלבד</p>
              <input ref={fileRef} type="file" accept=".csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            </div>
          )}

          {/* error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* results */}
          {rows && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">נמצאו {rows.length} קמפיינים — שייך לכל אחד משרה:</p>
                <button
                  onClick={() => { setRows(null); setError(null) }}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  בחר קובץ אחר
                </button>
              </div>

              <div className="space-y-2">
                {rows.map((row, i) => (
                  <div
                    key={i}
                    className={`rounded-xl border p-3 transition-all ${
                      row.checked ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-slate-50 opacity-50'
                    }`}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <input type="checkbox" checked={row.checked}
                        onChange={e => updateRow(i, { checked: e.target.checked })}
                        className="mt-1 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate" title={row.campaignName}>
                          {row.campaignName}
                        </p>
                        <div className="flex flex-wrap gap-3 mt-1 text-xs">
                          <span className="text-slate-700">
                            הוצאה: <strong className="text-red-600">₪{row.spend.toLocaleString()}</strong>
                          </span>
                          <span className="text-slate-700">
                            לידים: <strong className="text-blue-700">{row.leads}</strong>
                          </span>
                          {row.spend > 0 && row.leads > 0 && (
                            <span className="text-slate-400">CPL: ₪{(row.spend / row.leads).toFixed(0)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {row.checked && (
                      <select
                        value={row.selectedJobId}
                        onChange={e => updateRow(i, { selectedJobId: e.target.value })}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-full bg-white text-slate-700"
                      >
                        <option value="new">+ הוסף כמשרה חדשה</option>
                        {activePositions.map(p => (
                          <option key={p.id} value={p.id}>{p.positionTitle} — {p.companyName}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {rows && (
          <div className="px-5 pb-5 border-t border-slate-100 pt-4 flex gap-3">
            <button
              onClick={applyToForm}
              disabled={checkedCount === 0}
              className="btn-primary flex-1 flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <CheckCircle size={16} />
              עדכן דיווח ({checkedCount} קמפיינים)
            </button>
            <button onClick={onClose} className="btn-secondary px-4">בטל</button>
          </div>
        )}
      </div>
    </div>
  )
}
