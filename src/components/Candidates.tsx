import { useState } from 'react'
import { Plus, Phone, X, ChevronLeft, ChevronRight, Trash2, Edit2, Search } from 'lucide-react'
import type { Candidate, CandidateStatus, NonaStatus, SavedPosition } from '../types'
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

const COLUMNS: { status: CandidateStatus; color: string; headerColor: string }[] = [
  { status: 'new',                 color: 'bg-blue-50    border-blue-200',   headerColor: 'bg-blue-600'    },
  { status: 'screening',           color: 'bg-yellow-50  border-yellow-200', headerColor: 'bg-yellow-500'  },
  { status: 'call_scheduled',      color: 'bg-orange-50  border-orange-200', headerColor: 'bg-orange-500'  },
  { status: 'called',              color: 'bg-purple-50  border-purple-200', headerColor: 'bg-purple-600'  },
  { status: 'relevant',            color: 'bg-green-50   border-green-200',  headerColor: 'bg-green-600'   },
  { status: 'future_relevant',     color: 'bg-lime-50    border-lime-200',   headerColor: 'bg-lime-600'    },
  { status: 'sent_to_client',      color: 'bg-teal-50    border-teal-200',   headerColor: 'bg-teal-600'    },
  { status: 'interview_scheduled', color: 'bg-indigo-50  border-indigo-200', headerColor: 'bg-indigo-600'  },
  { status: 'started_working',     color: 'bg-emerald-50 border-emerald-200',headerColor: 'bg-emerald-500' },
  { status: 'placement_complete',  color: 'bg-emerald-50 border-emerald-300',headerColor: 'bg-emerald-700' },
  { status: 'irrelevant',          color: 'bg-red-50     border-red-200',    headerColor: 'bg-red-500'     },
]

const STATUS_ORDER = COLUMNS.map(c => c.status)

const SOURCES = ['Meta', 'אורגני', 'שיתוף / המלצה']

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
    id:           crypto.randomUUID(),
    name:         '',
    phone:        '',
    status:       'new',
    positionType: '',
    source:       '',
    nonaStatus:   '',
    notes:        '',
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  }
}

function formatDateHe(iso: string): string {
  if (!iso) return ''
  return new Date(iso + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: '2-digit' })
}

export default function Candidates({ candidates, positions, onChange }: Props) {
  const [showForm,     setShowForm]     = useState(false)
  const [editing,      setEditing]      = useState<Candidate | null>(null)
  const [filterStatus, setFilterStatus] = useState<CandidateStatus | ''>('')
  const [search,       setSearch]       = useState('')
  const [viewMode,     setViewMode]     = useState<'kanban' | 'list' | 'nona'>('kanban')
  const [form,         setForm]         = useState<Candidate>(newCandidate())

  const searchedCity = Object.keys(CITY_COORDS).find(
    city => city === search.trim() || city.includes(search.trim()) && search.trim().length >= 2
  ) ?? null

  const filtered = candidates.filter(c => {
    if (filterStatus && c.status !== filterStatus) return false
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

  const moveStatus = (c: Candidate, dir: 1 | -1) => {
    const idx  = STATUS_ORDER.indexOf(c.status)
    const next = STATUS_ORDER[idx + dir]
    if (next) save({ ...c, status: next })
  }

  const openNew = () => { setForm(newCandidate()); setEditing(null); setShowForm(true) }
  const openEdit = (c: Candidate) => { setForm({ ...c }); setEditing(c); setShowForm(true) }

  const submitForm = () => {
    if (!form.name.trim() || !form.phone.trim()) return
    save(form)
    setShowForm(false)
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
        {/* search */}
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם או טלפון..."
            className="input w-full pr-9 text-sm"
          />
        </div>

        {/* filter by status */}
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as CandidateStatus | '')}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white"
        >
          <option value="">כל הסטטוסים</option>
          {STATUS_ORDER.map(s => {
            const count = candidates.filter(c => c.status === s).length
            return count > 0
              ? <option key={s} value={s}>{CANDIDATE_STATUS_LABELS[s]} ({count})</option>
              : null
          })}
        </select>

        {/* view toggle */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          <button
            onClick={() => setViewMode('kanban')}
            className={`px-3 py-1.5 text-sm font-medium ${viewMode === 'kanban' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600'}`}
          >
            קנבן
          </button>
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

        <button onClick={openNew} className="btn-primary flex items-center gap-1.5">
          <Plus size={16} /> מועמד חדש
        </button>
      </div>

      {/* ── kanban view ── */}
      {viewMode === 'kanban' && (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {COLUMNS.map(col => {
              const colCandidates = filtered.filter(c => c.status === col.status)
              return (
                <div key={col.status} className="w-56 flex-shrink-0">
                  <div className={`${col.headerColor} text-white rounded-t-lg px-3 py-2 flex items-center justify-between`}>
                    <span className="text-sm font-bold">{CANDIDATE_STATUS_LABELS[col.status]}</span>
                    <span className="bg-white bg-opacity-30 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                      {colCandidates.length}
                    </span>
                  </div>
                  <div className={`${col.color} border border-t-0 rounded-b-lg min-h-32 p-2 space-y-2`}>
                    {colCandidates.map(c => (
                      <CandidateCard
                        key={c.id}
                        candidate={c}
                        statusOrder={STATUS_ORDER}
                        onMove={moveStatus}
                        onEdit={openEdit}
                        onDelete={remove}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── list view ── */}
      {viewMode === 'list' && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">שם</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">טלפון</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">גיל</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">עיר</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">משרה</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">מקור</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">סטטוס</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">ראיון</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">התחלה</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">נכנס</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">ימים בשלב</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(c => {
                const daysIn    = daysSince(c.createdAt)
                const daysStage = daysSince(c.updatedAt)
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                    <td className="px-4 py-3">
                      <a href={`tel:${c.phone}`} className="text-brand-600 font-mono hover:underline flex items-center gap-1">
                        <Phone size={12} />{c.phone}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-center">{c.age ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{c.city || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.positionType}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{c.source}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full w-fit ${CANDIDATE_STATUS_COLORS[c.status]}`}>
                          {CANDIDATE_STATUS_LABELS[c.status]}
                        </span>
                        {c.status === 'interview_scheduled' && c.interviewDate && (
                          <span className="text-xs text-indigo-500">📅 {formatDateHe(c.interviewDate)}</span>
                        )}
                        {c.status === 'started_working' && c.startDate && (
                          <span className="text-xs text-emerald-500">✅ {formatDateHe(c.startDate)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {c.interviewDate ? formatDateHe(c.interviewDate) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {c.startDate ? formatDateHe(c.startDate) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {daysIn === 0 ? 'היום' : `לפני ${daysIn} ימים`}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className={`font-medium ${daysStage > 7 ? 'text-orange-600' : 'text-slate-500'}`}>
                        {daysStage === 0 ? 'היום' : `${daysStage} ימים`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(c)} className="p-1 text-slate-400 hover:text-brand-600">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => remove(c.id)} className="p-1 text-slate-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400">אין מועמדים להצגה</div>
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

      {/* ── intake modal ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" dir="rtl">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">
                {editing ? 'עריכת מועמד' : 'מועמד חדש'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">שם מלא *</label>
                  <input
                    autoFocus
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="input w-full"
                    placeholder="ישראל ישראלי"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">טלפון *</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="input w-full font-mono"
                    placeholder="050-0000000"
                    type="tel"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">גיל</label>
                  <input
                    value={form.age ?? ''}
                    onChange={e => setForm(f => ({ ...f, age: e.target.value ? Number(e.target.value) : undefined }))}
                    className="input w-full"
                    placeholder="35"
                    type="number"
                    min="18" max="70"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">עיר מגורים</label>
                  <input
                    value={form.city ?? ''}
                    onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    className="input w-full"
                    placeholder="תל אביב, חיפה..."
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">סוג משרה *</label>
                <input
                  value={form.positionType}
                  onChange={e => setForm(f => ({ ...f, positionType: e.target.value }))}
                  className="input w-full"
                  placeholder="יועץ פנסיוני, מנהל מכירות..."
                  list="position-types"
                />
                <datalist id="position-types">
                  {positions.map(p => (
                    <option key={p.id} value={p.positionTitle} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">שיוך למשרה ספציפית</label>
                <select
                  value={form.savedPositionId ?? ''}
                  onChange={e => setForm(f => ({ ...f, savedPositionId: e.target.value || undefined }))}
                  className="input w-full"
                >
                  <option value="">— ללא שיוך —</option>
                  {positions.filter(p => p.isActive).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.companyName}{p.positionTitle ? ` · ${p.positionTitle}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">מקור הגעה</label>
                <select
                  value={form.source}
                  onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                  className="input w-full"
                >
                  <option value="">בחר מקור...</option>
                  {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">סטטוס</label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as CandidateStatus }))}
                  className="input w-full"
                >
                  {STATUS_ORDER.map(s => (
                    <option key={s} value={s}>{CANDIDATE_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">תאריך ראיון</label>
                  <input
                    type="date"
                    value={form.interviewDate ?? ''}
                    onChange={e => setForm(f => ({ ...f, interviewDate: e.target.value || undefined }))}
                    className="input w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">תאריך התחלה</label>
                  <input
                    type="date"
                    value={form.startDate ?? ''}
                    onChange={e => setForm(f => ({ ...f, startDate: e.target.value || undefined }))}
                    className="input w-full text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">הערות</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="input w-full resize-none"
                  rows={3}
                  placeholder="ניסיון, זמינות, הערות..."
                />
              </div>
            </div>

            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={submitForm}
                disabled={!form.name.trim() || !form.phone.trim()}
                className="btn-primary flex-1 disabled:opacity-40"
              >
                {editing ? 'עדכן' : 'הוסף מועמד'}
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">
                ביטול
              </button>
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

// ── CandidateCard ─────────────────────────────────────────────────────────────

function CandidateCard({
  candidate, statusOrder, onMove, onEdit, onDelete
}: {
  candidate:   Candidate
  statusOrder: CandidateStatus[]
  onMove:      (c: Candidate, dir: 1 | -1) => void
  onEdit:      (c: Candidate) => void
  onDelete:    (id: string) => void
}) {
  const idx      = statusOrder.indexOf(candidate.status)
  const canPrev  = idx > 0
  const canNext  = idx < statusOrder.length - 1
  const daysIn   = daysSince(candidate.createdAt)
  const daysStage = daysSince(candidate.updatedAt)

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-2.5 shadow-sm space-y-1.5">
      {/* name + actions */}
      <div className="flex items-start justify-between gap-1">
        <span className="font-semibold text-slate-800 text-sm leading-tight">{candidate.name}</span>
        <div className="flex gap-0.5 shrink-0">
          <button onClick={() => onEdit(candidate)} className="p-0.5 text-slate-300 hover:text-brand-600">
            <Edit2 size={12} />
          </button>
          <button onClick={() => onDelete(candidate.id)} className="p-0.5 text-slate-300 hover:text-red-500">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* phone */}
      <a href={`tel:${candidate.phone}`} className="flex items-center gap-1 text-xs text-brand-600 hover:underline">
        <Phone size={11} />
        {candidate.phone}
      </a>

      {/* position + source */}
      {candidate.positionType && (
        <div className="text-xs text-slate-600 truncate font-medium">{candidate.positionType}</div>
      )}
      {candidate.source && (
        <div className="text-xs text-slate-400 truncate">📍 {candidate.source}</div>
      )}
      {(candidate.age || candidate.city) && (
        <div className="text-xs text-slate-400 truncate">
          {candidate.age ? `גיל ${candidate.age}` : ''}
          {candidate.age && candidate.city ? ' · ' : ''}
          {candidate.city || ''}
        </div>
      )}

      {/* interview / start date */}
      {candidate.status === 'interview_scheduled' && candidate.interviewDate && (
        <div className="text-xs text-indigo-600 font-semibold">
          📅 ראיון: {new Date(candidate.interviewDate + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
        </div>
      )}
      {candidate.status === 'started_working' && candidate.startDate && (
        <div className="text-xs text-emerald-600 font-semibold">
          ✅ התחיל: {new Date(candidate.startDate + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
        </div>
      )}

      {/* notes */}
      {candidate.notes && (
        <div className="text-xs text-slate-500 bg-slate-50 rounded px-2 py-1 line-clamp-2">
          {candidate.notes}
        </div>
      )}

      {/* time info */}
      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 border-t border-slate-100">
        <span>נכנס {daysIn === 0 ? 'היום' : `לפני ${daysIn}י׳`}</span>
        <span className={daysStage > 7 ? 'text-orange-500 font-semibold' : ''}>
          {daysStage === 0 ? 'שלב היום' : `${daysStage}י׳ בשלב`}
        </span>
      </div>

      {/* move buttons */}
      <div className="flex justify-between">
        <button
          onClick={() => onMove(candidate, -1)}
          disabled={!canPrev}
          className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-20"
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={() => onMove(candidate, 1)}
          disabled={!canNext}
          className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-20"
        >
          <ChevronLeft size={14} />
        </button>
      </div>
    </div>
  )
}
