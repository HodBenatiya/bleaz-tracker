import { useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { CANDIDATE_STATUS_COLORS, CANDIDATE_STATUS_LABELS, type CandidateStatus } from '../types'

interface MatchRow {
  id: string
  name: string
  phone: string
  city: string
  status: string
  statusLabel?: string
  score: number
  snippet: string
  highlights: string[]
  reasons: string[]
  waUrl?: string
}

interface MatchResponse {
  ok?: boolean
  error?: string
  detail?: string
  scanned?: number
  method?: string
  matches?: MatchRow[]
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const unique = [...new Set(terms.map(term => term.trim()).filter(term => term.length >= 2))]
    .sort((a, b) => b.length - a.length)
  if (!text || !unique.length) return <>{text}</>
  const parts = text.split(new RegExp(`(${unique.map(escapeReg).join('|')})`, 'ig'))
  return (
    <>
      {parts.map((part, index) => unique.some(term => part.toLowerCase() === term.toLowerCase())
        ? <mark key={index} className="bg-amber-200 text-slate-900 rounded px-0.5">{part}</mark>
        : <span key={index}>{part}</span>)}
    </>
  )
}

export default function MatchCandidatesButton({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scanned, setScanned] = useState(0)
  const [method, setMethod] = useState('')
  const [matches, setMatches] = useState<MatchRow[]>([])

  const search = async (event: React.MouseEvent) => {
    event.stopPropagation()
    setOpen(true)
    setLoading(true)
    setError('')
    setMatches([])
    try {
      const res = await fetch('/api/match-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const data = await res.json().catch(() => ({})) as MatchResponse
      if (!res.ok || data.ok === false) {
        setError(data.detail || data.error || 'חיפוש המועמדים נכשל')
        return
      }
      setScanned(data.scanned || 0)
      setMethod(data.method || 'keywords')
      setMatches(data.matches || [])
    } catch {
      setError('חיפוש המועמדים נכשל')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={search}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition"
      >
        <Search size={12} /> מצא מועמדים
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center p-3"
          onClick={() => setOpen(false)}
        >
          <div
            dir="rtl"
            className="bg-white w-full max-w-lg max-h-[85vh] rounded-2xl shadow-xl flex flex-col"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div>
                <p className="font-bold text-slate-800">מועמדים מתאימים</p>
                <p className="text-[11px] text-slate-400">
                  {loading ? 'סורק את כל המועמדים…' : `נסרקו ${scanned.toLocaleString('he-IL')} · ${method === 'keywords+llm' ? 'דירוג מקומי + מודל' : 'דירוג לפי מילות מפתח'}`}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400" aria-label="סגור"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto p-3 space-y-2">
              {loading && <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-10"><Loader2 size={16} className="animate-spin" /> מחפש</div>}
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              {!loading && !error && matches.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-10">לא נמצאו מועמדים פנויים שתואמים למשרה.</p>
              )}
              {matches.map(match => {
                const status = match.status as CandidateStatus
                return (
                  <article key={match.id} className="border border-slate-100 rounded-xl px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">{match.name}</p>
                        <p className="text-xs text-slate-500">{match.city || 'אזור לא צוין'}</p>
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${CANDIDATE_STATUS_COLORS[status] || 'bg-slate-100 text-slate-600'}`}>
                        {match.statusLabel || CANDIDATE_STATUS_LABELS[status] || match.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs">
                      {match.waUrl
                        ? <a href={match.waUrl} target="_blank" rel="noreferrer" className="text-emerald-700 font-medium hover:underline">{match.phone}</a>
                        : <span className="text-slate-500">{match.phone}</span>}
                    </div>
                    {match.reasons.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {match.reasons.slice(0, 4).map(reason => (
                          <span key={reason} className="text-[10px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{reason}</span>
                        ))}
                      </div>
                    )}
                    {match.snippet && (
                      <p className="text-xs text-slate-700 mt-2 leading-relaxed">
                        <Highlight text={match.snippet} terms={match.highlights} />
                      </p>
                    )}
                  </article>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
