import { useState, useRef, useMemo, useEffect } from 'react'
import { Plus, Phone, X, Trash2, Edit2, Search, Calendar, MapPin, Briefcase, User, Download, Upload, Send, FileText, ExternalLink, Loader2, ChevronDown } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../utils/supabase'
import type { Candidate, CandidateStatus, CandidateNote, NonaStatus, SavedPosition } from '../types'
import { CANDIDATE_STATUS_LABELS, CANDIDATE_STATUS_COLORS } from '../types'

const NONA_STATUSES: { value: NonaStatus; label: string; color: string }[] = [
  { value: '',                label: 'לא הוגדר',        color: 'bg-slate-100 text-slate-500' },
  { value: 'קיים',           label: 'קיים',             color: 'bg-green-100 text-green-700' },
  { value: 'לא קיים',        label: 'לא קיים',          color: 'bg-red-100   text-red-700'   },
  { value: 'ממתין לסרטון',   label: 'ממתין לסרטון',     color: 'bg-amber-100 text-amber-700' },
]

interface Props {
  candidates: Candidate[]
  positions:  SavedPosition[]
  onChange:   (candidates: Candidate[]) => void
}

const STATUS_ORDER: CandidateStatus[] = [
  'new', 'screening', 'call_scheduled', 'called', 'relevant', 'future_relevant',
  'sent_to_client', 'interview_scheduled', 'started_working', 'placement_complete', 'irrelevant',
]

const SOURCES = ['Meta', 'אורגני', 'שיתוף / המלצה']

const STATUS_FILTER_OPTIONS: CandidateStatus[] = [
  'screening', 'call_scheduled', 'relevant', 'future_relevant',
  'sent_to_client', 'interview_scheduled', 'started_working',
  'placement_complete', 'irrelevant',
]

// ── Geographic proximity ───────────────────────────────────────────
const CITY_COORDS: Record<string, [number, number]> = {
  'תל אביב':       [32.0853, 34.7818],  'יפו':            [32.0504, 34.7503],
  'ירושלים':       [31.7683, 35.2137],  'חיפה':           [32.7940, 34.9896],
  'נתניה':         [32.3215, 34.8532],  'כפר יונה':       [32.3191, 34.9332],
  'תל מונד':       [32.2576, 34.9174],  'הוד השרון':      [32.1529, 34.8895],
  'רעננה':         [32.1843, 34.8707],  'כפר סבא':        [32.1789, 34.9077],
  'אבן יהודה':     [32.2804, 34.8930],  'צור יצחק':       [32.2661, 34.9397],
  'ראש העין':      [32.0954, 34.9577],  'פתח תקווה':      [32.0871, 34.8878],
  'בני ברק':       [32.0839, 34.8336],  'רמת גן':         [32.0824, 34.8130],
  'גבעתיים':       [32.0706, 34.8108],  'חולון':          [32.0116, 34.7799],
  'בת ים':         [32.0230, 34.7503],  'ראשון לציון':    [31.9730, 34.7925],
  'נס ציונה':      [31.9285, 34.7993],  'רחובות':         [31.8941, 34.8077],
  'לוד':           [31.9497, 34.8969],  'רמלה':           [31.9313, 34.8713],
  'מודיעין':       [31.8966, 35.0099],  'יהוד':           [32.0305, 34.8885],
  'אור יהודה':     [32.0281, 34.8584],  'קריית אונו':     [32.0645, 34.8597],
  'גבעת שמואל':    [32.0755, 34.8472],  'אשדוד':          [31.8044, 34.6553],
  'אשקלון':        [31.6686, 34.5743],  'באר שבע':        [31.2518, 34.7913],
  'אילת':          [29.5577, 34.9519],  'עכו':            [32.9231, 35.0769],
  'נהריה':         [33.0036, 35.0986],  'כרמיאל':         [32.9153, 35.2978],
  'טבריה':         [32.7922, 35.5312],  'נצרת':           [32.7021, 35.2979],
  'אום אל פחם':    [32.5201, 35.1547],  'חדרה':           [32.4342, 34.9198],
  'זכרון יעקב':    [32.5711, 34.9541],  'פרדס חנה':       [32.4678, 34.9697],
  'בנימינה':       [32.5144, 34.9475],  'עפולה':          [32.6068, 35.2893],
  'בית שאן':       [32.5002, 35.4965],  'צפת':            [32.9646, 35.4961],
  'קריית שמונה':   [33.2074, 35.5695],  'מגדל העמק':      [32.6740, 35.2374],
  'שדרות':         [31.5239, 34.5965],  'דימונה':         [31.0672, 35.0333],
  'אופקים':        [31.3144, 34.6208],  'נתיבות':         [31.4204, 34.5895],
  'ערד':           [31.2558, 35.2121],  'מצפה רמון':      [30.6107, 34.8023],
  'גן יבנה':       [31.7892, 34.7105],  'יבנה':           [31.8770, 34.7414],
  'גדרה':          [31.8117, 34.7771],  'קריית גת':       [31.6100, 34.7642],
  'ירוחם':         [30.9864, 34.9285],  'באר יעקב':       [31.9367, 34.8378],
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function nearbyCityMatches(searchCity: string, candidateCity: string): number | null {
  const c1 = CITY_COORDS[searchCity]
  const c2 = CITY_COORDS[candidateCity]
  if (!c1 || !c2) return null
  const d = haversineKm(c1[0], c1[1], c2[0], c2[1])
  return d <= 35 ? Math.round(d) : null
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function newCandidate(): Candidate {
  return {
    id:              crypto.randomUUID(),
    name:            '',
    phone:           '',
    status:          'new',
    positionType:    '',
    source:          '',
    nonaStatus:      '',
    cvUrl:           '',
    cvFileName:      '',
    notes:           '',
    savedPositionIds: [],
    noteHistory:     [],
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
  }
}

function formatDateHe(iso: string): string {
  if (!iso) return ''
  return new Date(iso + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: '2-digit' })
}

export default function Candidates({ candidates, positions, onChange }: Props) {
  const [showForm,        setShowForm]       = useState(false)
  const [editing,         setEditing]        = useState<Candidate | null>(null)
  const [viewing,         setViewing]        = useState<Candidate | null>(null)
  const [openStatusMenu,  setOpenStatusMenu] = useState<string | null>(null)
  const [filterPosition,  setFilterPosition] = useState('')
  const [search,         setSearch]         = useState('')
  const [viewMode,       setViewMode]       = useState<'list' | 'nona'>('list')
  const [form,           setForm]           = useState<Candidate>(newCandidate())
  const [newNote,             setNewNote]             = useState('')
  const [showImport,          setShowImport]          = useState(false)
  const [cvUploading,         setCvUploading]         = useState(false)
  const [filterPositionTypes, setFilterPositionTypes] = useState<string[]>([])
  const [showPosTypeDropdown, setShowPosTypeDropdown] = useState(false)
  const [filterStatuses,      setFilterStatuses]      = useState<CandidateStatus[]>([])
  const [showStatusFilter,    setShowStatusFilter]    = useState(false)
  const chatEndRef         = useRef<HTMLDivElement>(null)
  const posTypeDropdownRef = useRef<HTMLDivElement>(null)
  const statusFilterRef    = useRef<HTMLDivElement>(null)
  const [importRows,     setImportRows]     = useState<Record<string, string>[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cvFileRef    = useRef<HTMLInputElement>(null)

  const allPositionTypes = useMemo(() => {
    const types = new Set(candidates.map(c => c.positionType).filter(Boolean))
    return [...types].sort()
  }, [candidates])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (posTypeDropdownRef.current && !posTypeDropdownRef.current.contains(e.target as Node))
        setShowPosTypeDropdown(false)
      if (statusFilterRef.current && !statusFilterRef.current.contains(e.target as Node))
        setShowStatusFilter(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const searchedCity = Object.keys(CITY_COORDS).find(
    city => city === search.trim() || city.includes(search.trim()) && search.trim().length >= 2
  ) ?? null

  const getPositionIds = (c: Candidate) =>
    c.savedPositionIds?.length ? c.savedPositionIds : c.savedPositionId ? [c.savedPositionId] : []

  const filtered = candidates.filter(c => {
    if (filterStatuses.length > 0 && !filterStatuses.includes(c.status)) return false
    if (filterPosition && !getPositionIds(c).includes(filterPosition)) return false
    if (filterPositionTypes.length > 0 && !filterPositionTypes.includes(c.positionType)) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.city ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // מועמדים קרובים גיאוגרפית — רק כשמחפשים עיר ואין התאמה מדויקת לאותה עיר
  const nearbyWithDist: { candidate: Candidate; km: number }[] = (() => {
    if (!searchedCity || !search.trim()) return []
    const exactIds = new Set(filtered.map(c => c.id))
    return candidates
      .filter(c => {
        if (exactIds.has(c.id)) return false
        if (!c.city) return false
        return true
      })
      .flatMap(c => {
        const km = nearbyCityMatches(searchedCity, c.city!)
        return km !== null ? [{ candidate: c, km }] : []
      })
      .sort((a, b) => a.km - b.km)
  })()

  // ── stats ──
  const today = new Date().toISOString().split('T')[0]
  const newToday    = candidates.filter(c => c.createdAt.startsWith(today)).length
  const inProcess   = candidates.filter(c => ['screening','call_scheduled','called'].includes(c.status)).length
  const relevant    = candidates.filter(c => ['relevant','sent_to_client','interview_scheduled','started_working'].includes(c.status)).length
  const placed      = candidates.filter(c => c.status === 'placement_complete').length
  const irrelevant  = candidates.filter(c => c.status === 'irrelevant').length

  // ── helpers ──
  const save = (c: Candidate) => {
    const todayStr = new Date().toISOString().split('T')[0]
    const prev     = candidates.find(x => x.id === c.id)
    let candidate  = { ...c }

    // אוטומטי — רשום תאריך ראיון כשסטטוס משתנה ל"נקבע ראיון"
    if (prev?.status !== candidate.status) {
      if (candidate.status === 'interview_scheduled' && !candidate.interviewDate)
        candidate = { ...candidate, interviewDate: todayStr }
      if (candidate.status === 'started_working' && !candidate.startDate)
        candidate = { ...candidate, startDate: todayStr }
    }

    // ארכיב ראיון קודם — כשחברה משתנה או סטטוס עוזב "נקבע ראיון"
    if (prev?.status === 'interview_scheduled' && prev.interviewDate) {
      const prevIds = [...(prev.savedPositionIds ?? (prev.savedPositionId ? [prev.savedPositionId] : []))].sort()
      const newIds  = [...(candidate.savedPositionIds ?? (candidate.savedPositionId ? [candidate.savedPositionId] : []))].sort()
      const companyChanged = JSON.stringify(prevIds) !== JSON.stringify(newIds)
      const statusLeft     = candidate.status !== 'interview_scheduled'
      if (companyChanged || statusLeft) {
        const prevPos = prevIds.map(id => positions.find(p => p.id === id)).find(Boolean)
        const record: import('../types').InterviewRecord = {
          id:             crypto.randomUUID(),
          date:           prev.interviewDate,
          time:           prev.interviewTime,
          companyName:    prevPos?.companyName ?? prev.positionType ?? 'לא ידוע',
          positionTitle:  prevPos?.positionTitle,
          savedPositionId: prevIds[0],
          createdAt:      new Date().toISOString(),
        }
        candidate = { ...candidate, interviewHistory: [...(prev.interviewHistory ?? []), record] }
      }
    }

    const updated = { ...candidate, updatedAt: new Date().toISOString() }
    const exists  = candidates.find(x => x.id === updated.id)
    const next    = exists
      ? candidates.map(x => x.id === updated.id ? updated : x)
      : [...candidates, updated]
    onChange(next)
  }

  const remove = (id: string) => {
    if (!confirm('למחוק את המועמד?')) return
    onChange(candidates.filter(c => c.id !== id))
  }

  const openNew = () => { setForm(newCandidate()); setEditing(null); setShowForm(true) }
  const openEdit = (c: Candidate) => { setForm({ ...c }); setEditing(c); setShowForm(true) }

  const handleCvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCvUploading(true)
    try {
      const path = `${form.id}-${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('cvs').upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('cvs').getPublicUrl(path)
      setForm(f => ({ ...f, cvUrl: data.publicUrl, cvFileName: file.name }))
    } catch {
      alert('שגיאה בהעלאת הקובץ. ודא שיש bucket בשם "cvs" ב-Supabase Storage.')
    } finally {
      setCvUploading(false)
      e.target.value = ''
    }
  }

  const submitForm = () => {
    if (!form.name.trim() || !form.phone.trim()) return
    save(form)
    setShowForm(false)
  }

  // ── Export ──
  const exportToExcel = () => {
    const rows = filtered.map(c => ({
      'שם':           c.name,
      'טלפון':        c.phone,
      'גיל':          c.age ?? '',
      'עיר':          c.city ?? '',
      'סטטוס':        CANDIDATE_STATUS_LABELS[c.status],
      'סוג משרה':     c.positionType,
      'חברה משויכת':  positions.find(p => p.id === c.savedPositionId)?.companyName ?? '',
      'מקור':         c.source,
      'תאריך ראיון':  c.interviewDate ?? '',
      'תאריך התחלה':  c.startDate ?? '',
      'נונה':         c.nonaStatus,
      'הערות':        c.notes,
      'תאריך כניסה':  c.createdAt.split('T')[0],
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'מועמדים')
    XLSX.writeFile(wb, `מועמדים_כל_${new Date().toLocaleDateString('he-IL').replace(/\//g,'-')}.xlsx`)
  }

  // ── Import ──
  const IMPORT_COL_MAP: Record<string, keyof Candidate> = {
    'שם': 'name', 'name': 'name', 'full name': 'name', 'שם מלא': 'name',
    'טלפון': 'phone', 'phone': 'phone', 'mobile': 'phone', 'נייד': 'phone',
    'גיל': 'age', 'age': 'age',
    'עיר': 'city', 'city': 'city', 'עיר מגורים': 'city',
    'מקור': 'source', 'source': 'source',
    'סוג משרה': 'positionType', 'position': 'positionType', 'תפקיד': 'positionType',
    'הערות': 'notes', 'notes': 'notes', 'comment': 'notes',
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const wb = XLSX.read(ev.target?.result, { type: 'binary' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })
      setImportRows(raw)
      setShowImport(true)
    }
    reader.readAsBinaryString(file)
    e.target.value = ''
  }

  const confirmImport = () => {
    const newCandidates: Candidate[] = importRows.map(row => {
      const c = newCandidate()
      for (const [col, val] of Object.entries(row)) {
        const field = IMPORT_COL_MAP[col.trim().toLowerCase()] ?? IMPORT_COL_MAP[col.trim()]
        if (!field || !val) continue
        if (field === 'age') c.age = Number(val) || undefined
        else (c as unknown as Record<string, string>)[field] = String(val)
      }
      return c
    }).filter(c => c.name.trim() || c.phone.trim())

    onChange([...candidates, ...newCandidates])
    setShowImport(false)
    setImportRows([])
  }

  return (
    <div className="space-y-4">

      {/* ── stats bar ── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <StatChip label="סה״כ"       value={candidates.length} color="text-slate-700" bg="bg-white" />
        <StatChip label="היום"        value={newToday}          color="text-blue-600"    bg="bg-blue-50" />
        <StatChip label="בתהליך"      value={inProcess}         color="text-yellow-700"  bg="bg-yellow-50" />
        <StatChip label="רלוונטיים"   value={relevant}          color="text-green-700"   bg="bg-green-50" />
        <StatChip label="הושלמו"      value={placed}            color="text-emerald-700" bg="bg-emerald-50" />
        <StatChip label="לא רלוונטי"  value={irrelevant}        color="text-red-600"     bg="bg-red-50" />
      </div>

      {/* ── toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* search — wide & prominent */}
        <div className="relative flex-1 min-w-72">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם, טלפון או עיר..."
            className="input w-full pr-10 py-2 text-sm shadow-sm"
          />
        </div>

        {/* filter by position */}
        <select
          value={filterPosition}
          onChange={e => setFilterPosition(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="">כל המשרות</option>
          {positions.filter(p => p.isActive).map(p => (
            <option key={p.id} value={p.id}>
              {p.companyName}{p.positionTitle ? ` · ${p.positionTitle}` : ''}
            </option>
          ))}
        </select>

        {/* status filter */}
        <div className="relative" ref={statusFilterRef}>
          <button
            onClick={() => setShowStatusFilter(f => !f)}
            className={`text-sm border rounded-lg px-3 py-1.5 bg-white flex items-center gap-1.5 transition ${filterStatuses.length > 0 ? 'border-brand-400 text-brand-700 font-medium' : 'border-slate-200 text-slate-600'}`}
          >
            {filterStatuses.length === 0 ? 'כל הסטטוסים' : `${filterStatuses.length} סטטוסים`}
            <ChevronDown size={13} />
          </button>
          {showStatusFilter && (
            <div className="absolute top-full mt-1 right-0 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[210px] max-h-72 overflow-y-auto" dir="rtl">
              {filterStatuses.length > 0 && (
                <button
                  onClick={() => setFilterStatuses([])}
                  className="w-full text-right text-xs text-red-500 hover:text-red-700 px-3 py-1.5 hover:bg-red-50 border-b border-slate-100"
                >
                  נקה הכל ×
                </button>
              )}
              {STATUS_FILTER_OPTIONS.map(s => (
                <label key={s} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-sm text-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={filterStatuses.includes(s)}
                    onChange={() =>
                      setFilterStatuses(prev =>
                        prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
                      )
                    }
                    className="accent-brand-600"
                  />
                  <span className={`w-2 h-2 rounded-full shrink-0 ${CANDIDATE_STATUS_COLORS[s].split(' ')[0]}`} />
                  {CANDIDATE_STATUS_LABELS[s]}
                  <span className="mr-auto text-xs text-slate-400">
                    ({candidates.filter(c => c.status === s).length})
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* multi-select positionType filter */}
        {allPositionTypes.length > 0 && (
          <div className="relative" ref={posTypeDropdownRef}>
            <button
              onClick={() => setShowPosTypeDropdown(f => !f)}
              className={`text-sm border rounded-lg px-3 py-1.5 bg-white flex items-center gap-1.5 transition ${filterPositionTypes.length > 0 ? 'border-brand-400 text-brand-700 font-medium' : 'border-slate-200 text-slate-600'}`}
            >
              {filterPositionTypes.length === 0 ? 'כל התפקידים' : `${filterPositionTypes.length} תפקידים`}
              <ChevronDown size={13} />
            </button>
            {showPosTypeDropdown && (
              <div className="absolute top-full mt-1 right-0 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[200px] max-h-60 overflow-y-auto">
                {filterPositionTypes.length > 0 && (
                  <button
                    onClick={() => setFilterPositionTypes([])}
                    className="w-full text-right text-xs text-red-500 hover:text-red-700 px-3 py-1.5 hover:bg-red-50 border-b border-slate-100"
                  >
                    נקה הכל ×
                  </button>
                )}
                {allPositionTypes.map(type => (
                  <label key={type} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-sm text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={filterPositionTypes.includes(type)}
                      onChange={() =>
                        setFilterPositionTypes(prev =>
                          prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                        )
                      }
                      className="accent-brand-600"
                    />
                    {type}
                    <span className="mr-auto text-xs text-slate-400">
                      ({candidates.filter(c => c.positionType === type).length})
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* view toggle */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-sm font-medium ${viewMode === 'list' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600'}`}
          >
            רשימה
          </button>
          <button
            onClick={() => setViewMode('nona')}
            className={`px-3 py-1.5 text-sm font-medium ${viewMode === 'nona' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600'}`}
          >
            🟣 נונה
          </button>
        </div>

        <button
          onClick={exportToExcel}
          title="ייצוא לאקסל"
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition"
        >
          <Download size={15} />
          ייצוא
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition"
        >
          <Upload size={15} />
          ייבוא
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />

        <button onClick={openNew} className="btn-primary flex items-center gap-1.5">
          <Plus size={16} /> מועמד חדש
        </button>
      </div>

      {/* ── list view ── */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* overlay for closing status menu */}
          {openStatusMenu && (
            <div className="fixed inset-0 z-30" onClick={() => setOpenStatusMenu(null)} />
          )}
          <table className="w-full text-sm">
            <thead className="bg-[#F8F9FA] border-b border-slate-200">
              <tr>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">שם</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">טלפון</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">גיל / עיר</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">סטטוס</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">חברות / משרה</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">מקור</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">הערות</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">נכנס</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(c => {
                const daysIn    = daysSince(c.createdAt)
                const daysStage = daysSince(c.updatedAt)
                const noteText  = c.noteHistory?.length
                  ? c.noteHistory[c.noteHistory.length - 1].text
                  : (c.notes || '')
                return (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">

                    {/* Name — click opens edit drawer */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEdit(c)}
                        className="font-semibold text-slate-800 hover:text-brand-700 hover:underline text-right leading-tight"
                      >
                        {c.name}
                      </button>
                    </td>

                    <td className="px-4 py-3">
                      <a href={`tel:${c.phone}`} className="text-brand-600 font-mono hover:underline flex items-center gap-1 text-xs">
                        <Phone size={12} />{c.phone}
                      </a>
                    </td>

                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {c.age ? `גיל ${c.age}` : ''}{c.age && c.city ? ' · ' : ''}{c.city || ''}
                    </td>

                    {/* Status — badge click opens WhatsApp timeline; chevron click opens inline status picker */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <div>
                          <button
                            onClick={() => setViewing(c)}
                            className={`text-xs font-semibold px-2 py-1 rounded-full hover:opacity-80 transition ${CANDIDATE_STATUS_COLORS[c.status]}`}
                          >
                            {CANDIDATE_STATUS_LABELS[c.status]}
                          </button>
                          {c.status === 'interview_scheduled' && c.interviewDate && (
                            <div className="text-xs text-indigo-500 mt-0.5">
                              📅 {formatDateHe(c.interviewDate)}{c.interviewTime ? ` · ${c.interviewTime}` : ''}
                            </div>
                          )}
                          {c.status === 'started_working' && c.startDate && (
                            <div className="text-xs text-emerald-500 mt-0.5">✅ {formatDateHe(c.startDate)}</div>
                          )}
                        </div>
                        <div className="relative">
                          <button
                            onClick={e => { e.stopPropagation(); setOpenStatusMenu(openStatusMenu === c.id ? null : c.id) }}
                            className="p-1 text-slate-300 hover:text-slate-500 rounded hover:bg-slate-100 transition"
                          >
                            <ChevronDown size={11} />
                          </button>
                          {openStatusMenu === c.id && (
                            <div className="absolute right-0 top-8 z-40 bg-white border border-slate-200 rounded-xl shadow-xl py-1 min-w-[190px]">
                              {STATUS_ORDER.map(s => (
                                <button
                                  key={s}
                                  onClick={() => { save({ ...c, status: s }); setOpenStatusMenu(null) }}
                                  className={`w-full text-right px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2.5 transition ${c.status === s ? 'font-semibold text-brand-700 bg-brand-50' : 'text-slate-700'}`}
                                >
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${CANDIDATE_STATUS_COLORS[s].split(' ')[0]}`} />
                                  {CANDIDATE_STATUS_LABELS[s]}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs">
                      <div className="flex flex-col gap-0.5">
                        {getPositionIds(c).map(pid => {
                          const pos = positions.find(p => p.id === pid)
                          return pos ? (
                            <span key={pid} className="text-brand-700 font-medium bg-brand-50 px-1.5 py-0.5 rounded w-fit">
                              {pos.companyName}
                            </span>
                          ) : null
                        })}
                        {c.positionType && <span className="text-slate-400">{c.positionType}</span>}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-slate-500 text-xs">{c.source}</td>

                    {/* Notes with hover tooltip */}
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px] relative group">
                      <span className="line-clamp-2 cursor-default">{noteText || '—'}</span>
                      {noteText.length > 40 && (
                        <div className="pointer-events-none absolute z-50 hidden group-hover:block bottom-full right-0 mb-2 w-80 bg-slate-900 text-white text-xs rounded-xl p-3.5 shadow-2xl leading-relaxed whitespace-pre-wrap">
                          {noteText}
                          <div className="absolute top-full right-4 border-[6px] border-transparent border-t-slate-900" />
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {daysIn === 0 ? 'היום' : `לפני ${daysIn}י׳`}
                      <span className={`block ${daysStage > 7 ? 'text-orange-500 font-semibold' : 'text-slate-300'}`}>
                        {daysStage === 0 ? 'עדכון היום' : `${daysStage}י׳ בשלב`}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <button onClick={() => remove(c.id)} className="p-1 text-slate-300 hover:text-red-500 transition">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-14 text-slate-400">אין מועמדים להצגה</div>
          )}
        </div>
      )}

      {/* ── nearby candidates ── */}
      {nearbyWithDist.length > 0 && viewMode !== 'nona' && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
            <span className="text-sm font-semibold text-amber-800">📍 מועמדים קרובים גיאוגרפית ל{searchedCity}</span>
            <span className="text-xs text-amber-600">— עד 35 ק״מ</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-amber-50 border-b border-amber-100">
              <tr>
                <th className="text-right px-4 py-2 font-semibold text-amber-800">שם</th>
                <th className="text-right px-4 py-2 font-semibold text-amber-800">טלפון</th>
                <th className="text-right px-4 py-2 font-semibold text-amber-800">עיר</th>
                <th className="text-right px-4 py-2 font-semibold text-amber-800">מרחק</th>
                <th className="text-right px-4 py-2 font-semibold text-amber-800">סטטוס</th>
                <th className="text-right px-4 py-2 font-semibold text-amber-800">משרה</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-50">
              {nearbyWithDist.map(({ candidate: c, km }) => (
                <tr key={c.id} className="hover:bg-amber-50 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-2.5">
                    <a href={`tel:${c.phone}`} className="text-brand-600 font-mono hover:underline flex items-center gap-1 text-xs">
                      <Phone size={11}/>{c.phone}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{c.city}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                      {km} ק״מ
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CANDIDATE_STATUS_COLORS[c.status]}`}>
                      {CANDIDATE_STATUS_LABELS[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{c.positionType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── nona view ── */}
      {viewMode === 'nona' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">🟣 הקמת משתמש נונה</span>
            <span className="text-xs text-slate-400">— עדכן סטטוס לכל מועמד</span>
          </div>

          {/* summary chips */}
          <div className="flex gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
            {NONA_STATUSES.filter(s => s.value).map(s => {
              const count = candidates.filter(c => (c.nonaStatus ?? '') === s.value).length
              return (
                <span key={s.value} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${s.color}`}>
                  {s.label}: {count}
                </span>
              )
            })}
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">
              לא הוגדר: {candidates.filter(c => !c.nonaStatus).length}
            </span>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-500 border-b border-slate-100">
                <th className="px-4 py-2 font-semibold">שם</th>
                <th className="px-4 py-2 font-semibold">טלפון</th>
                <th className="px-4 py-2 font-semibold">שלב בתהליך</th>
                <th className="px-4 py-2 font-semibold">סטטוס נונה</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(c => {
                const nonaOpt = NONA_STATUSES.find(s => s.value === (c.nonaStatus ?? '')) ?? NONA_STATUSES[0]
                return (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                    <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{c.phone}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CANDIDATE_STATUS_COLORS[c.status]}`}>
                        {CANDIDATE_STATUS_LABELS[c.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={c.nonaStatus ?? ''}
                        onChange={e => {
                          const updated = { ...c, nonaStatus: e.target.value as NonaStatus, updatedAt: new Date().toISOString() }
                          onChange(candidates.map(x => x.id === c.id ? updated : x))
                        }}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border-0 cursor-pointer ${nonaOpt.color}`}
                      >
                        {NONA_STATUSES.map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
              {candidates.length === 0 && (
                <tr><td colSpan={4} className="text-center py-8 text-slate-400">אין מועמדים</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── edit modal (centered, darkens entire screen including sidebar) ── */}
      {showForm && (() => {
        const singleMode      = form.status === 'started_working' || form.status === 'placement_complete'
        const posIds          = form.savedPositionIds ?? (form.savedPositionId ? [form.savedPositionId] : [])
        const activePositions = positions.filter(p => p.isActive)
        const lbl             = (txt: string) => (
          <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{txt}</label>
        )
        return (
          <div
            className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-6"
            onClick={() => setShowForm(false)}
          >
            <div
              className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
              dir="rtl"
              onClick={e => e.stopPropagation()}
            >
              {/* ── Header ── */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">{editing ? 'עריכת מועמד' : 'מועמד חדש'}</h2>
                  {editing && <p className="text-xs text-slate-400 font-mono mt-0.5">{form.phone}</p>}
                </div>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
                  <X size={18} />
                </button>
              </div>

              {/* ── Body ── */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">

                {/* Row 1: שם (2 cols) + טלפון + גיל + עיר */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-2">
                    {lbl('שם מלא *')}
                    <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="input w-full text-sm" placeholder="ישראל ישראלי" />
                  </div>
                  <div>
                    {lbl('טלפון *')}
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      className="input w-full font-mono text-sm" placeholder="050-0000000" type="tel" />
                  </div>
                  <div>
                    {lbl('גיל')}
                    <input value={form.age ?? ''} onChange={e => setForm(f => ({ ...f, age: e.target.value ? Number(e.target.value) : undefined }))}
                      className="input w-full text-sm" placeholder="35" type="number" min="18" max="70" />
                  </div>
                </div>

                {/* Row 2: עיר + מקור + סטטוס + סוג משרה */}
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    {lbl('עיר מגורים')}
                    <input value={form.city ?? ''} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                      className="input w-full text-sm" placeholder="תל אביב..." />
                  </div>
                  <div>
                    {lbl('מקור הגעה')}
                    <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} className="input w-full text-sm">
                      <option value="">בחר...</option>
                      {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    {lbl('סטטוס')}
                    <select
                      value={form.status}
                      onChange={e => {
                        const next = e.target.value as CandidateStatus
                        if (next === 'started_working' || next === 'placement_complete') {
                          const ids = form.savedPositionIds ?? (form.savedPositionId ? [form.savedPositionId] : [])
                          const single = ids.slice(0, 1)
                          setForm(f => ({ ...f, status: next, savedPositionIds: single, savedPositionId: single[0] }))
                        } else {
                          setForm(f => ({ ...f, status: next }))
                        }
                      }}
                      className="input w-full text-sm"
                    >
                      {STATUS_ORDER.map(s => <option key={s} value={s}>{CANDIDATE_STATUS_LABELS[s]}</option>)}
                    </select>
                  </div>
                  <div>
                    {lbl('נונה')}
                    <select value={form.nonaStatus ?? ''} onChange={e => setForm(f => ({ ...f, nonaStatus: e.target.value as NonaStatus }))} className="input w-full text-sm">
                      {NONA_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    {lbl('שכר משוער (₪/חודש)')}
                    <input
                      type="number" min="0"
                      value={form.estimatedSalary ?? ''}
                      onChange={e => setForm(f => ({ ...f, estimatedSalary: e.target.value ? Number(e.target.value) : undefined }))}
                      className="input w-full text-sm" placeholder="6,000..."
                    />
                  </div>
                </div>

                {/* הערות — full width */}
                <div>
                  {lbl('הערות')}
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="input w-full resize-none text-sm"
                    rows={3}
                    placeholder="ניסיון, זמינות, הערות כלליות..."
                  />
                </div>

                {/* שיוך לחברות / משרות — enlarged, most prominent section */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                    <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                      {singleMode ? '📍 מקום עבודה — 1 בלבד' : '🔗 שיוך לחברות / משרות'}
                    </span>
                    {!singleMode && posIds.length > 0 && (
                      <span className="text-xs font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">{posIds.length} נבחרו</span>
                    )}
                  </div>

                  {/* Checkbox / radio list — enlarged */}
                  <div className="min-h-[110px] max-h-48 overflow-y-auto p-2 space-y-0.5 bg-white">
                    {activePositions.length === 0 && (
                      <p className="text-xs text-slate-400 text-center py-4">אין משרות פעילות</p>
                    )}
                    {activePositions.map(p => {
                      const checked = posIds.includes(p.id)
                      return (
                        <label key={p.id} className={`flex items-center gap-3 cursor-pointer rounded-lg px-3 py-2 transition border ${checked ? 'bg-brand-50 border-brand-200' : 'border-transparent hover:bg-slate-50'}`}>
                          <input
                            type={singleMode ? 'radio' : 'checkbox'}
                            name="position-select"
                            checked={checked}
                            onChange={() => {
                              if (singleMode) {
                                setForm(f => ({ ...f, savedPositionIds: [p.id], savedPositionId: p.id }))
                              } else {
                                const next = checked ? posIds.filter(id => id !== p.id) : [...posIds, p.id]
                                setForm(f => ({ ...f, savedPositionIds: next, savedPositionId: next[0] }))
                              }
                            }}
                            className="accent-brand-600 w-4 h-4 shrink-0"
                          />
                          <div className="text-sm">
                            <span className="font-medium text-slate-800">{p.companyName}</span>
                            {p.positionTitle && <span className="text-slate-400 mr-1"> · {p.positionTitle}</span>}
                          </div>
                        </label>
                      )
                    })}
                  </div>

                  {/* הוסף משרה ידנית */}
                  <div className="border-t border-slate-200 px-4 py-3 bg-white">
                    {lbl('הוסף משרה ידנית')}
                    <input
                      value={form.positionType}
                      onChange={e => setForm(f => ({ ...f, positionType: e.target.value }))}
                      className="input w-full text-sm"
                      placeholder="הכנס שם תפקיד / חברה..."
                      list="position-types"
                    />
                    <datalist id="position-types">
                      {positions.map(p => <option key={p.id} value={p.positionTitle} />)}
                    </datalist>
                  </div>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    {lbl('תאריך ראיון')}
                    <input type="date" value={form.interviewDate ?? ''} onChange={e => setForm(f => ({ ...f, interviewDate: e.target.value || undefined, interviewReminderSent: undefined }))} className="input w-full text-sm" />
                  </div>
                  <div>
                    {lbl('שעת ראיון')}
                    <input
                      type="time"
                      value={form.interviewTime ?? ''}
                      onChange={e => setForm(f => ({ ...f, interviewTime: e.target.value || undefined, interviewReminderSent: undefined }))}
                      className="input w-full text-sm"
                      disabled={!form.interviewDate}
                    />
                  </div>
                  <div>
                    {lbl('תאריך התחלה')}
                    <input type="date" value={form.startDate ?? ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value || undefined }))} className="input w-full text-sm" />
                  </div>
                </div>

                {/* Interview history — read only */}
                {(form.interviewHistory?.length ?? 0) > 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">היסטוריית ראיונות</p>
                    <div className="space-y-1.5">
                      {form.interviewHistory!.map(h => (
                        <div key={h.id} className="flex items-center gap-2 text-xs text-slate-600 bg-white border border-slate-100 rounded-lg px-3 py-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                          <span className="font-semibold">{h.companyName}</span>
                          {h.positionTitle && <span className="text-slate-400">· {h.positionTitle}</span>}
                          <span className="mr-auto text-slate-400 shrink-0">
                            {new Date(h.date + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                            {h.time ? ` ${h.time}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Invoice status — only for placed candidates */}
                {(form.status === 'started_working' || form.status === 'placement_complete') && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                    <p className="text-xs font-bold text-emerald-700 mb-2 uppercase tracking-wide">גבייה — ₪5,000</p>
                    <div className="flex gap-2">
                      {(['none', 'sent', 'paid'] as const).map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setForm(f => ({
                            ...f,
                            invoiceStatus: s,
                            invoiceSentDate: s === 'sent' && !f.invoiceSentDate ? new Date().toISOString().split('T')[0] : f.invoiceSentDate,
                            paidDate:        s === 'paid' && !f.paidDate        ? new Date().toISOString().split('T')[0] : f.paidDate,
                          }))}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition font-medium ${
                            (form.invoiceStatus ?? 'none') === s
                              ? s === 'none' ? 'bg-slate-200 border-slate-400 text-slate-700'
                              : s === 'sent' ? 'bg-amber-200 border-amber-400 text-amber-800'
                              :               'bg-green-200 border-green-400 text-green-800'
                              : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
                          }`}
                        >
                          {s === 'none' ? 'לא נשלחה' : s === 'sent' ? 'נשלחה' : 'שולם ✓'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Footer ── */}
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0 space-y-3">
                {form.cvUrl ? (
                  <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
                    <FileText size={14} className="text-brand-600 shrink-0" />
                    <span className="text-sm text-slate-700 truncate flex-1">{form.cvFileName || 'קורות חיים'}</span>
                    <button type="button" onClick={() => setForm(f => ({ ...f, cvUrl: '', cvFileName: '' }))} className="text-slate-400 hover:text-red-500 shrink-0"><X size={14} /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => cvFileRef.current?.click()} disabled={cvUploading}
                    className="flex items-center gap-2 w-full px-3 py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:bg-white justify-center disabled:opacity-50 transition">
                    {cvUploading ? <><Loader2 size={14} className="animate-spin" /> מעלה קובץ...</> : <><Upload size={14} /> קורות חיים (PDF, Word, כל קובץ)</>}
                  </button>
                )}
                <input ref={cvFileRef} type="file" className="hidden" onChange={handleCvUpload} />
                <div className="flex gap-3">
                  <button onClick={submitForm} disabled={!form.name.trim() || !form.phone.trim()} className="btn-primary flex-1 disabled:opacity-40">
                    {editing ? 'עדכן' : 'הוסף מועמד'}
                  </button>
                  <button onClick={() => setShowForm(false)} className="btn-secondary px-8">ביטול</button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── import modal ── */}
      {showImport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden" dir="rtl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-800">ייבוא מועמדים מאקסל</h2>
                <p className="text-sm text-slate-500 mt-0.5">{importRows.length} שורות זוהו — בדוק לפני ייבוא</p>
              </div>
              <button onClick={() => { setShowImport(false); setImportRows([]) }} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="overflow-auto max-h-96 p-4">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50">
                    {importRows[0] && Object.keys(importRows[0]).map(col => (
                      <th key={col} className="text-right px-3 py-2 font-semibold text-slate-600 border border-slate-200 whitespace-nowrap">
                        {col}
                        {IMPORT_COL_MAP[col.trim().toLowerCase()] || IMPORT_COL_MAP[col.trim()]
                          ? <span className="text-brand-500 mr-1">✓</span>
                          : <span className="text-slate-300 mr-1 text-[10px]">(מדולג)</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importRows.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-3 py-1.5 text-slate-700 border border-slate-100 max-w-[150px] truncate">
                          {String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {importRows.length > 10 && (
                <p className="text-xs text-slate-400 mt-2 text-center">ועוד {importRows.length - 10} שורות...</p>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <p className="text-xs text-slate-500">
                עמודות עם ✓ יתמפו אוטומטית לשדות המועמד. סטטוס ברירת מחדל: חדש.
              </p>
              <div className="flex gap-3">
                <button onClick={() => { setShowImport(false); setImportRows([]) }} className="btn-secondary">
                  ביטול
                </button>
                <button onClick={confirmImport} className="btn-primary">
                  <Upload size={15} /> ייבא {importRows.length} מועמדים
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── floating add button (mobile) ── */}
      <button
        onClick={openNew}
        className="fixed bottom-6 left-6 w-14 h-14 bg-brand-600 text-white rounded-full shadow-xl flex items-center justify-center hover:bg-brand-700 transition-colors sm:hidden z-40"
      >
        <Plus size={24} />
      </button>

      {/* ── candidate detail modal ── */}
      {viewing && (() => {
        const linkedPositions = getPositionIds(viewing).map(id => positions.find(p => p.id === id)).filter(Boolean) as typeof positions

        const addNote = () => {
          if (!newNote.trim()) return
          const note: CandidateNote = { id: crypto.randomUUID(), text: newNote.trim(), createdAt: new Date().toISOString() }
          const updated = { ...viewing, noteHistory: [...(viewing.noteHistory ?? []), note] }
          setViewing(updated)
          save(updated)
          setNewNote('')
          setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
        }

        // group notes by calendar day (oldest → newest)
        const notes = viewing.noteHistory ?? []
        type DayGroup = { day: string; notes: typeof notes }
        const groups: DayGroup[] = []
        for (const n of notes) {
          const day = n.createdAt.split('T')[0]
          const last = groups[groups.length - 1]
          if (last && last.day === day) last.notes.push(n)
          else groups.push({ day, notes: [n] })
        }
        const todayStr     = new Date().toISOString().split('T')[0]
        const yesterdayStr = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]
        const dayLabel     = (d: string) =>
          d === todayStr ? 'היום' : d === yesterdayStr ? 'אתמול' : formatDateHe(d)

        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
            <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[92vh]" dir="rtl" onClick={e => e.stopPropagation()}>

              {/* ── header ── */}
              <div className="px-5 py-4 flex items-center justify-between bg-slate-800 rounded-t-2xl shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-white">{viewing.name}</h2>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full mt-1 inline-block ${CANDIDATE_STATUS_COLORS[viewing.status]}`}>
                    {CANDIDATE_STATUS_LABELS[viewing.status]}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setViewing(null); openEdit(viewing) }} className="p-2 rounded-lg bg-white/15 text-white hover:bg-white/25">
                    <Edit2 size={16} />
                  </button>
                  <button onClick={() => setViewing(null)} className="p-2 rounded-lg bg-white/15 text-white hover:bg-white/25">
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* ── info strip (compact, no scroll) ── */}
              <div className="px-5 py-3 border-b border-slate-100 shrink-0 space-y-2 bg-white">
                <div className="flex items-center justify-between">
                  <a href={`tel:${viewing.phone}`} className="flex items-center gap-1.5 text-brand-600 hover:underline font-mono font-semibold text-sm">
                    <Phone size={15} />{viewing.phone}
                  </a>
                  <span className="text-xs text-slate-400">נכנס {formatDateHe(viewing.createdAt.split('T')[0])}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  {(viewing.age || viewing.city) && (
                    <span className="flex items-center gap-1"><MapPin size={11} className="text-slate-400" />{viewing.age ? `גיל ${viewing.age}` : ''}{viewing.age && viewing.city ? ' · ' : ''}{viewing.city}</span>
                  )}
                  {viewing.source && <span className="flex items-center gap-1"><User size={11} className="text-slate-400" />{viewing.source}</span>}
                  {viewing.positionType && <span className="flex items-center gap-1"><Briefcase size={11} className="text-slate-400" />{viewing.positionType}</span>}
                  {viewing.cvUrl && (
                    <a href={viewing.cvUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-brand-600 hover:text-brand-800 hover:underline font-medium">
                      <FileText size={11} /> {viewing.cvFileName || 'קורות חיים'} <ExternalLink size={10} />
                    </a>
                  )}
                </div>
                {linkedPositions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {linkedPositions.map(pos => (
                      <span key={pos.id} className="text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded-full">
                        {pos.companyName}{pos.positionTitle ? ` · ${pos.positionTitle}` : ''}
                      </span>
                    ))}
                  </div>
                )}
                {(viewing.interviewDate || viewing.startDate || viewing.nonaStatus) && (
                  <div className="flex flex-wrap gap-2">
                    {viewing.interviewDate && (
                      <span className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                        <Calendar size={10} />ראיון {formatDateHe(viewing.interviewDate)}{viewing.interviewTime ? ` · ${viewing.interviewTime}` : ''}
                      </span>
                    )}
                    {viewing.startDate && (
                      <span className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
                        <Calendar size={10} />התחיל {formatDateHe(viewing.startDate)}
                      </span>
                    )}
                    {viewing.nonaStatus && (() => {
                      const ns = NONA_STATUSES.find(s => s.value === viewing.nonaStatus)
                      return ns ? <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ns.color}`}>נונה: {ns.label}</span> : null
                    })()}
                  </div>
                )}
              </div>

              {/* ── WhatsApp chat area ── */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1 min-h-0" style={{ background: '#E5DDD5' }}>

                {/* legacy note — always show as first bubble if exists */}
                {viewing.notes && (
                  <div className="flex justify-end mb-1">
                    <div className="rounded-2xl rounded-br-sm px-3 py-2 max-w-[85%] shadow-sm" style={{ background: '#DCF8C6' }}>
                      <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{viewing.notes}</p>
                      <p className="text-[10px] text-right mt-0.5" style={{ color: '#4caf82' }}>הערה קודמת</p>
                    </div>
                  </div>
                )}

                {notes.length === 0 && !viewing.notes && (
                  <div className="flex items-center justify-center h-full py-12">
                    <p className="text-slate-500 text-sm bg-white/60 px-4 py-2 rounded-full">אין עדכונים עדיין — הוסף את הראשון</p>
                  </div>
                )}

                {groups.map(group => (
                  <div key={group.day}>
                    {/* date separator */}
                    <div className="flex justify-center my-2">
                      <span className="text-xs px-3 py-0.5 rounded-full shadow-sm" style={{ background: 'rgba(255,255,255,0.75)', color: '#555' }}>
                        {dayLabel(group.day)}
                      </span>
                    </div>
                    {/* bubbles */}
                    {group.notes.map(n => (
                      <div key={n.id} className="flex justify-end mb-1">
                        <div className="rounded-2xl rounded-br-sm px-3 py-2 max-w-[85%] shadow-sm" style={{ background: '#DCF8C6' }}>
                          <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{n.text}</p>
                          <p className="text-[10px] text-right mt-0.5" style={{ color: '#4caf82' }}>
                            {new Date(n.createdAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} ✓✓
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

                <div ref={chatEndRef} />
              </div>

              {/* ── WhatsApp-style input ── */}
              <div className="flex items-end gap-2 px-3 py-2 shrink-0" style={{ background: '#F0F0F0' }}>
                <textarea
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote() }
                  }}
                  placeholder="הוסף עדכון... (Shift+Enter לשורה חדשה)"
                  className="flex-1 rounded-2xl px-4 py-2 text-sm resize-none outline-none border-0 shadow-sm"
                  style={{ background: '#fff', maxHeight: '96px' }}
                  rows={1}
                />
                <button
                  onClick={addNote}
                  disabled={!newNote.trim()}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow shrink-0 transition-opacity disabled:opacity-40"
                  style={{ background: '#25D366' }}
                >
                  <Send size={16} />
                </button>
              </div>

              {/* ── footer ── */}
              <div className="px-5 py-3 border-t border-slate-100 flex gap-3 shrink-0 bg-white rounded-b-2xl">
                <button onClick={() => { setViewing(null); openEdit(viewing) }} className="btn-primary flex-1 text-sm">
                  <Edit2 size={14} /> ערוך פרטים
                </button>
                <button onClick={() => { remove(viewing.id); setViewing(null) }} className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
                  <Trash2 size={14} />
                </button>
              </div>

            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── StatChip ─────────────────────────────────────────────────────────────────

function StatChip({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`${bg} border border-slate-200 rounded-xl px-3 py-2 text-center`}>
      <div className={`text-xl font-black ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

