import { useState, useMemo, useRef, useCallback } from 'react'
import { Search, Phone, X, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, ClipboardPaste, ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import * as XLSX from 'xlsx'
import * as pdfjsLib from 'pdfjs-dist'
import type { Candidate, SavedPosition } from '../types'
import { CANDIDATE_STATUS_LABELS, CANDIDATE_STATUS_COLORS } from '../types'

// PDF worker — resolve local file via Vite's asset URL handling
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

interface Props {
  candidates: Candidate[]
  positions:  SavedPosition[]
  onChange:   (candidates: Candidate[]) => void
}

// ── column → field mapping ─────────────────────────────────────────────────
const COL_MAP: Record<string, keyof Candidate> = {
  // name
  'שם': 'name', 'שם מלא': 'name', 'שם פרטי ושם משפחה': 'name', 'שם פרטי': 'name',
  'full name': 'name', 'name': 'name', 'שם הלקוח': 'name', 'שם המועמד': 'name',
  'first name': 'name', 'firstname': 'name', 'שם + משפחה': 'name',
  // phone
  'טלפון': 'phone', 'נייד': 'phone', 'מספר טלפון': 'phone', 'טל': 'phone',
  'phone': 'phone', 'mobile': 'phone', 'cell': 'phone', 'phone number': 'phone',
  'מספר פלאפון': 'phone', 'פלאפון': 'phone', 'מס טלפון': 'phone', 'מס׳ טלפון': 'phone',
  // age
  'גיל': 'age', 'age': 'age', 'בן כמה': 'age',
  // city
  'עיר': 'city', 'עיר מגורים': 'city', 'יישוב': 'city', 'מקום מגורים': 'city',
  'city': 'city', 'location': 'city', 'כתובת': 'city', 'אזור': 'city', 'ישוב': 'city',
  // source
  'מקור': 'source', 'מקור הגעה': 'source', 'source': 'source', 'קמפיין': 'source',
  'campaign': 'source', 'ad set name': 'source', 'ad name': 'source',
  // position type
  'סוג משרה': 'positionType', 'תפקיד': 'positionType', 'משרה': 'positionType',
  'position': 'positionType', 'role': 'positionType', 'job': 'positionType',
  'התמחות': 'positionType', 'תחום': 'positionType', 'תחום עיסוק': 'positionType',
  // notes
  'הערות': 'notes', 'הערה': 'notes', 'notes': 'notes', 'comment': 'notes',
  'comments': 'notes', 'remarks': 'notes', 'מידע נוסף': 'notes', 'פרטים': 'notes',
}

function resolveCol(raw: string): keyof Candidate | null {
  const k = raw.trim()
  return COL_MAP[k] ?? COL_MAP[k.toLowerCase()] ?? null
}

function newCandidate(): Candidate {
  return {
    id: crypto.randomUUID(), name: '', phone: '', status: 'new',
    positionType: '', source: '', nonaStatus: '', notes: '',
    savedPositionIds: [], noteHistory: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
}

function formatDate(iso: string) {
  if (!iso) return ''
  return new Date(iso.split('T')[0] + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: '2-digit' })
}

// ── PDF → rows extraction ─────────────────────────────────────────────────
async function extractRowsFromPDF(file: File): Promise<Record<string, string>[]> {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const allLines: string[][] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p)
    const content = await page.getTextContent()
    // Group text items by Y position (row = same Y ± 4pt)
    const byY: Map<number, { x: number; text: string }[]> = new Map()
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const y   = Math.round((item as { transform: number[] }).transform[5] / 4) * 4
      const x   = (item as { transform: number[] }).transform[4]
      if (!byY.has(y)) byY.set(y, [])
      byY.get(y)!.push({ x, text: item.str })
    }
    // Sort rows top→bottom (descending Y in PDF coords), sort cells left→right
    const sorted = [...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, cells]) => cells.sort((a, b) => a.x - b.x).map(c => c.text))
    allLines.push(...sorted)
  }

  if (allLines.length < 2) return []
  // First non-empty line = headers
  const headers = allLines[0]
  return allLines.slice(1).map(cells =>
    Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']))
  )
}

// ── parse pasted text (TSV from Google Sheets / CSV) ─────────────────────
function parsePastedText(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const delim    = lines[0].includes('\t') ? '\t' : ','
  const headers  = lines[0].split(delim).map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const cells = line.split(delim).map(c => c.trim().replace(/^"|"$/g, ''))
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']))
  })
}

export default function DataView({ candidates, positions, onChange }: Props) {
  const [query,      setQuery]      = useState('')
  const [dragging,   setDragging]   = useState(false)
  const [importRows, setImportRows] = useState<Record<string, string>[]>([])
  const [showImport, setShowImport] = useState(false)
  const [importSrc,  setImportSrc]  = useState('')
  const [pasteText,  setPasteText]  = useState('')
  const [tab,        setTab]        = useState<'file' | 'paste'>('file')
  const [pdfLoading, setPdfLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  type SortKey = 'name' | 'age' | 'city' | 'status' | 'company' | 'positionType' | 'source' | 'createdAt'
  const [sortBy,  setSortBy]  = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSort(col: SortKey) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  const posMap = useMemo(() => Object.fromEntries(positions.map(p => [p.id, p])), [positions])

  const getLastNote = (c: Candidate) =>
    c.noteHistory?.length ? c.noteHistory[c.noteHistory.length - 1].text : (c.notes ?? '')

  const getCompanies = (c: Candidate) => {
    const ids = c.savedPositionIds?.length ? c.savedPositionIds : c.savedPositionId ? [c.savedPositionId] : []
    return ids.map(id => posMap[id]?.companyName ?? '').filter(Boolean).join(' ')
  }

  const filtered = useMemo(() => {
    const base = !query.trim() ? candidates : (() => {
      const q = query.trim().toLowerCase()
      return candidates.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.city ?? '').toLowerCase().includes(q) ||
        c.positionType.toLowerCase().includes(q) ||
        c.source.toLowerCase().includes(q) ||
        CANDIDATE_STATUS_LABELS[c.status].toLowerCase().includes(q) ||
        getCompanies(c).toLowerCase().includes(q) ||
        getLastNote(c).toLowerCase().includes(q) ||
        (c.age ? String(c.age).includes(q) : false)
      )
    })()

    if (!sortBy) return base
    return [...base].sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      switch (sortBy) {
        case 'name':         av = a.name;              bv = b.name;              break
        case 'age':          av = a.age ?? 0;          bv = b.age ?? 0;          break
        case 'city':         av = a.city ?? '';        bv = b.city ?? '';        break
        case 'status':       av = a.status;            bv = b.status;            break
        case 'company':      av = getCompanies(a);     bv = getCompanies(b);     break
        case 'positionType': av = a.positionType;      bv = b.positionType;      break
        case 'source':       av = a.source;            bv = b.source;            break
        case 'createdAt':    av = a.createdAt;         bv = b.createdAt;         break
      }
      if (typeof av === 'number' && typeof bv === 'number')
        return sortDir === 'asc' ? av - bv : bv - av
      const cmp = String(av).localeCompare(String(bv), 'he')
      return sortDir === 'asc' ? cmp : -cmp
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, query, positions, sortBy, sortDir])

  // ── open preview ──
  const openPreview = useCallback((rows: Record<string, string>[]) => {
    setImportRows(rows)
    setImportSrc('')
    setShowImport(true)
  }, [])

  // ── read file ──
  const readFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'pdf') {
      setPdfLoading(true)
      try {
        const rows = await extractRowsFromPDF(file)
        if (rows.length === 0) alert('לא נמצאו שורות בPDF. נסה לייצא את הקובץ כ-CSV.')
        else openPreview(rows)
      } catch {
        alert('שגיאה בקריאת ה-PDF. נסה לייצא כ-CSV.')
      } finally {
        setPdfLoading(false)
      }
    } else {
      const reader = new FileReader()
      reader.onload = ev => {
        const wb  = XLSX.read(ev.target?.result, { type: 'binary' })
        const ws  = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })
        openPreview(raw)
      }
      reader.readAsBinaryString(file)
    }
  }, [openPreview])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) readFile(f)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) readFile(f)
  }

  const handlePasteParse = () => {
    if (!pasteText.trim()) return
    const rows = parsePastedText(pasteText)
    if (rows.length === 0) { alert('לא זוהתה טבלה. ודא שהעמודות מופרדות בטאב או בפסיקים.'); return }
    openPreview(rows)
  }

  // ── confirm import ──
  const confirmImport = () => {
    const dupes = new Set(candidates.map(c => c.phone.replace(/\D/g, '')))
    let skipped = 0
    const incoming = importRows.map(row => {
      const c = newCandidate()
      for (const [col, val] of Object.entries(row)) {
        const field = resolveCol(col)
        if (!field || !val) continue
        if (field === 'age') c.age = Number(val) || undefined
        else (c as unknown as Record<string, string>)[field] = String(val)
      }
      if (importSrc && !c.source) c.source = importSrc
      return c
    }).filter(c => {
      if (!c.name.trim() && !c.phone.trim()) return false
      const n = c.phone.replace(/\D/g, '')
      if (n && dupes.has(n)) { skipped++; return false }
      if (n) dupes.add(n)
      return true
    })
    onChange([...candidates, ...incoming])
    setShowImport(false); setImportRows([]); setPasteText('')
    if (skipped > 0) alert(`יובאו ${incoming.length} מועמדים. ${skipped} כפילויות דולגו.`)
  }

  const colStats = importRows[0]
    ? Object.keys(importRows[0]).map(col => ({ col, field: resolveCol(col) }))
    : []
  const recognized = colStats.filter(c => c.field).length

  return (
    <div className="space-y-5" dir="rtl">

      {/* ── import zone ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">

        {/* tabs */}
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setTab('file')}
            className={`flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 transition
              ${tab === 'file' ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <FileSpreadsheet size={16} /> ייבוא קובץ
          </button>
          <button
            onClick={() => setTab('paste')}
            className={`flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 transition
              ${tab === 'paste' ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <ClipboardPaste size={16} /> הדבקה מגוגל שיטס
          </button>
        </div>

        {/* file tab */}
        {tab === 'file' && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`p-8 text-center cursor-pointer transition-all select-none
              ${dragging ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
          >
            {pdfLoading
              ? <>
                  <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-slate-500">קורא קובץ PDF...</p>
                </>
              : <>
                  <FileSpreadsheet size={36} className={`mx-auto mb-3 ${dragging ? 'text-brand-500' : 'text-slate-300'}`} />
                  <p className="font-semibold text-slate-700 text-base mb-1">גרור קובץ לכאן — או לחץ לבחירה</p>
                  <p className="text-xs text-slate-400 mt-2">
                    Excel (.xlsx .xls) · CSV · Google Sheets export · ODS · PDF
                  </p>
                </>
            }
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.ods,.tsv,.pdf,.numbers"
              className="hidden"
              onChange={handleFileInput}
            />
          </div>
        )}

        {/* paste tab */}
        {tab === 'paste' && (
          <div className="p-5 space-y-3">
            <p className="text-sm text-slate-600">
              <span className="font-semibold">גוגל שיטס:</span> סמן את כל הטבלה (כולל כותרות) → Ctrl+C → הדבק כאן
            </p>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="הדבק כאן את הנתונים שהעתקת..."
              className="input w-full resize-none text-sm font-mono"
              rows={6}
              dir="ltr"
            />
            <button
              onClick={handlePasteParse}
              disabled={!pasteText.trim()}
              className="btn-primary disabled:opacity-40 flex items-center gap-2"
            >
              <Upload size={15} /> נתח נתונים
            </button>
          </div>
        )}
      </div>

      {/* ── search bar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-64">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="חפש לפי שם, טלפון, עיר, סטטוס, חברה, התמחות, מקור, הערות..."
            className="input w-full pr-10 text-sm"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="text-sm text-slate-500 shrink-0">
          {query
            ? <><span className="font-bold text-brand-700">{filtered.length}</span> תוצאות מתוך {candidates.length}</>
            : <><span className="font-bold text-slate-700">{candidates.length}</span> מועמדים בסה״כ</>
          }
        </div>
      </div>

      {/* ── table ── */}
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <SortTh label="שם"      col="name"         sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th className="text-right px-4 py-3 font-semibold text-slate-600">טלפון</th>
              <SortTh label="גיל"     col="age"          sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="עיר"     col="city"         sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="סטטוס"   col="status"       sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="חברה"    col="company"      sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th className="text-right px-4 py-3 font-semibold text-slate-600">משרה</th>
              <SortTh label="התמחות"  col="positionType" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="מקור"    col="source"       sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <th className="text-right px-4 py-3 font-semibold text-slate-600">הערה</th>
              <SortTh label="נכנס"    col="createdAt"    sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(c => {
              const ids = c.savedPositionIds?.length ? c.savedPositionIds : c.savedPositionId ? [c.savedPositionId] : []
              const linkedPos = ids.map(id => posMap[id]).filter(Boolean)
              const lastNote  = getLastNote(c)
              return (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{c.name}</td>
                  <td className="px-4 py-3">
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-brand-600 font-mono text-xs hover:underline">
                      <Phone size={11} />{c.phone}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs text-center">{c.age ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">{c.city ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full w-fit ${CANDIDATE_STATUS_COLORS[c.status]}`}>
                      {CANDIDATE_STATUS_LABELS[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {linkedPos.length > 0
                      ? linkedPos.map(p => (
                          <span key={p.id} className="text-brand-700 font-medium bg-brand-50 px-1.5 py-0.5 rounded block w-fit mb-0.5">
                            {p.companyName}
                          </span>
                        ))
                      : <span className="text-slate-300">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {linkedPos.length > 0
                      ? linkedPos.map(p => (
                          <span key={p.id} className="block mb-0.5">{p.positionTitle || <span className="text-slate-300">—</span>}</span>
                        ))
                      : <span className="text-slate-300">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{c.positionType || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{c.source}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-[180px]">
                    {lastNote ? <span className="line-clamp-2">{lastNote}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{formatDate(c.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && candidates.length > 0 && (
          <div className="text-center py-16 text-slate-400">
            <Search size={32} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">לא נמצאו מועמדים</p>
          </div>
        )}
        {candidates.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Upload size={32} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">עדיין אין מועמדים — העלה קובץ למעלה</p>
          </div>
        )}
      </div>

      {/* ── import preview modal ── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh]" dir="rtl">

            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-800">בדיקת נתונים לפני ייבוא</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {importRows.length} שורות ·{' '}
                  <span className="text-emerald-600 font-medium">{recognized} עמודות מזוהות</span>
                  {colStats.length - recognized > 0 && <span className="text-slate-400"> · {colStats.length - recognized} מדולגות</span>}
                </p>
              </div>
              <button onClick={() => { setShowImport(false); setImportRows([]) }} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>

            {/* column mapping chips */}
            <div className="px-6 py-3 border-b border-slate-100 shrink-0 flex flex-wrap gap-2">
              {colStats.map(({ col, field }) => (
                <span key={col} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium
                  ${field ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  {field ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                  {col}
                </span>
              ))}
            </div>

            {/* source input */}
            <div className="px-6 py-3 border-b border-slate-100 shrink-0 flex items-center gap-3">
              <label className="text-sm font-medium text-slate-700 whitespace-nowrap">מקור / קמפיין:</label>
              <input
                value={importSrc}
                onChange={e => setImportSrc(e.target.value)}
                placeholder="Meta ינואר 2025, רשימת לידים ישנה..."
                className="input flex-1 text-sm"
              />
            </div>

            {/* preview rows */}
            <div className="overflow-auto flex-1 p-4">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 sticky top-0">
                    {importRows[0] && Object.keys(importRows[0]).map(col => (
                      <th key={col} className="text-right px-3 py-2 font-semibold text-slate-600 border border-slate-200 whitespace-nowrap">
                        {col} {resolveCol(col) ? <span className="text-emerald-500">✓</span> : <span className="text-slate-300 text-[10px]">(מדולג)</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importRows.slice(0, 8).map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-3 py-1.5 text-slate-700 border border-slate-100 max-w-[160px] truncate">{String(val)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {importRows.length > 8 && <p className="text-xs text-slate-400 mt-2 text-center">ועוד {importRows.length - 8} שורות...</p>}
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
              <p className="text-xs text-slate-500">כפילויות לפי מספר טלפון ידולגו · סטטוס ברירת מחדל: חדש</p>
              <div className="flex gap-3">
                <button onClick={() => { setShowImport(false); setImportRows([]) }} className="btn-secondary">ביטול</button>
                <button onClick={confirmImport} className="btn-primary flex items-center gap-2">
                  <Upload size={15} /> ייבא {importRows.length} מועמדים
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SortTh — sortable column header ──────────────────────────────────────────

interface SortThProps {
  label:   string
  col:     string
  sortBy:  string | null
  sortDir: 'asc' | 'desc'
  onSort:  (col: any) => void
}

function SortTh({ label, col, sortBy, sortDir, onSort }: SortThProps) {
  const active = sortBy === col
  return (
    <th
      onClick={() => onSort(col)}
      className="text-right px-4 py-3 font-semibold text-slate-600 cursor-pointer select-none hover:bg-slate-100 transition group whitespace-nowrap"
    >
      <div className="flex items-center justify-end gap-1">
        {label}
        <span className="text-slate-400">
          {active
            ? sortDir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
            : <ChevronsUpDown size={13} className="opacity-0 group-hover:opacity-40 transition" />
          }
        </span>
      </div>
    </th>
  )
}
