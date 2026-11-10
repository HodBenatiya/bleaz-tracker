import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Search, Upload, X } from 'lucide-react'
import { cvStorageKey } from '../utils/storageKey'
import { signedStorageUrl } from '../utils/storageUrl'
import { supabase } from '../utils/supabase'
import { inferCampaign, isGenericSource, type CampaignInference } from '../utils/metaAds/inferCampaign'
import { loadCampaignChoices, loadCampaignPositionMaps, type CampaignChoice } from '../utils/metaAdsStore'
import type { Candidate, CandidateStatus, NonaStatus, SavedPosition, WaMessage } from '../types'
import { CANDIDATE_STATUS_LABELS } from '../types'
import { shouldApplyNoteDraft, withMyUpdateCue } from '../utils/noteDraft'
import AttributionMonthField from './AttributionMonthField'

const NONA_STATUSES: { value: NonaStatus; label: string; color: string }[] = [
  { value: '', label: 'לא הוגדר', color: 'bg-slate-100 text-slate-500' },
  { value: 'קיים', label: 'קיים', color: 'bg-green-100 text-green-700' },
  { value: 'לא קיים', label: 'לא קיים', color: 'bg-red-100 text-red-700' },
  { value: 'ממתין לסרטון', label: 'ממתין לסרטון', color: 'bg-amber-100 text-amber-700' },
]

const STATUS_ORDER: CandidateStatus[] = [
  'new', 'screening', 'call_scheduled', 'called', 'relevant', 'future_relevant',
  'sent_to_client', 'interview_scheduled', 'started_working', 'placement_complete', 'irrelevant',
]

interface NoteSeed {
  text: string
  token: number
  leadKey: string
  force?: boolean
}

interface Props {
  initial: Candidate
  editing: boolean
  positions: SavedPosition[]
  onClose: () => void
  onSubmit: (candidate: Candidate) => void
  noteSeed?: NoteSeed | null
  noteDrafting?: boolean
  /** Lead this modal was opened for. A draft for any other lead is ignored. */
  leadKey?: string
  onRegenerateNote?: () => void
  leadMessages?: WaMessage[]
}

export default function CandidateFormModal({ initial, editing, positions, onClose, onSubmit, noteSeed, noteDrafting, leadKey, onRegenerateNote, leadMessages }: Props) {
  const [form, setForm] = useState<Candidate>(initial)
  const [choices, setChoices] = useState<CampaignChoice[]>([])
  const [maps, setMaps] = useState<{ accountId: string; campaignId: string; positionId: string }[]>([])
  const [picking, setPicking] = useState(!!initial.metaCampaignId)
  const [campaignQuery, setCampaignQuery] = useState('')
  const [suggestion, setSuggestion] = useState<CampaignInference | null>(null)
  const [autoPicked, setAutoPicked] = useState(false)
  const [positionSearch, setPositionSearch] = useState('')
  const [cvUploading, setCvUploading] = useState(false)
  const [noteDirty, setNoteDirty] = useState(false)
  const cvFileRef = useRef<HTMLInputElement>(null)
  const sourceTouched = useRef(false)
  const inferredOnce = useRef(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadCampaignChoices(), loadCampaignPositionMaps()]).then(([nextChoices, nextMaps]) => {
      if (cancelled) return
      setChoices(nextChoices)
      setMaps(nextMaps)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (sourceTouched.current || inferredOnce.current || form.metaCampaignId || !choices.length) return
    const referrals = [...(leadMessages ?? []), ...(form.waMessages ?? [])].flatMap(message => message.adReferral ? [message.adReferral] : [])
    const positionIds = form.savedPositionIds ?? (form.savedPositionId ? [form.savedPositionId] : [])
    const hit = inferCampaign({ campaigns: choices, maps, referrals, source: form.source, positionIds })
    if (!hit) return
    const sameName = hit.campaignName && form.source && form.source.trim() === hit.campaignName
    if (!isGenericSource(form.source) && !sameName) {
      setSuggestion(hit)
      return
    }
    inferredOnce.current = true
    setAutoPicked(true)
    setPicking(true)
    setForm(current => ({
      ...current,
      source: hit.campaignName,
      metaAccountId: hit.accountId,
      metaCampaignId: hit.campaignId,
    }))
  }, [choices, maps, leadMessages, form.metaCampaignId, form.source, form.savedPositionId, form.savedPositionIds, form.waMessages])

  useEffect(() => {
    if (!noteSeed?.text) return
    if (!shouldApplyNoteDraft({
      responseKey: noteSeed.leadKey,
      currentKey: leadKey || '',
      userEdited: noteDirty,
      force: !!noteSeed.force,
    })) return
    const notes = withMyUpdateCue(noteSeed.text)
    if (!notes) return
    setForm(current => ({ ...current, notes }))
    if (noteSeed.force) setNoteDirty(false)
  }, [noteSeed?.token, noteSeed?.leadKey, leadKey])

  const handleCvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCvUploading(true)
    try {
      const path = cvStorageKey(form.id, file.name)
      const { error } = await supabase.storage.from('cvs').upload(path, file, { upsert: true })
      if (error) throw error
      setForm(current => ({ ...current, cvUrl: `cvs:${path}`, cvFileName: file.name }))
    } catch {
      alert('שגיאה בהעלאת הקובץ. ודא שיש bucket בשם "cvs" ב-Supabase Storage.')
    } finally {
      setCvUploading(false)
      e.target.value = ''
    }
  }

  const submit = () => {
    if (!form.name.trim() || !form.phone.trim()) return
    onSubmit(form)
  }

  const singleMode = form.status === 'started_working' || form.status === 'placement_complete'
  const posIds = form.savedPositionIds ?? (form.savedPositionId ? [form.savedPositionId] : [])
  const activePositions = positions.filter(item => item.isActive)
  const lbl = (txt: string) => (
    <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{txt}</label>
  )

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-6"
      onClick={onClose}
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
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
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
            <div className="col-span-4">
              {lbl('מקור הגעה')}
              <SourcePicker
                form={form}
                choices={choices}
                picking={picking}
                query={campaignQuery}
                suggestion={suggestion}
                autoPicked={autoPicked}
                onQuery={setCampaignQuery}
                onOrganic={() => {
                  sourceTouched.current = true
                  setAutoPicked(false)
                  setSuggestion(null)
                  setPicking(false)
                  setForm(current => {
                    const next = { ...current, source: 'אורגני' }
                    delete next.metaAccountId
                    delete next.metaCampaignId
                    return next
                  })
                }}
                onStartCampaign={() => setPicking(true)}
                onPick={choice => {
                  sourceTouched.current = true
                  setAutoPicked(false)
                  setSuggestion(null)
                  setPicking(true)
                  setForm(current => ({
                    ...current,
                    source: choice.campaignName,
                    metaAccountId: choice.accountId,
                    metaCampaignId: choice.campaignId,
                  }))
                }}
                onApplySuggestion={() => {
                  if (!suggestion) return
                  sourceTouched.current = true
                  setAutoPicked(false)
                  setPicking(true)
                  setForm(current => ({
                    ...current,
                    source: suggestion.campaignName,
                    metaAccountId: suggestion.accountId,
                    metaCampaignId: suggestion.campaignId,
                  }))
                  setSuggestion(null)
                }}
              />
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

          {/* הערות — full width, same screening note as the candidate card */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-sm font-bold text-slate-800">הערה</label>
              {onRegenerateNote && (
                <button type="button" onClick={onRegenerateNote} disabled={noteDrafting} className="text-[11px] font-semibold text-indigo-700 disabled:opacity-50">
                  {noteDrafting ? 'מכין טיוטה…' : 'נתח שוב'}
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mb-1">פרטי שיחת הסינון. טיוטה אוטומטית לא נשמרת עד שלוחצים שמור.</p>
            <textarea
              value={form.notes}
              onChange={e => { setNoteDirty(true); setForm(f => ({ ...f, notes: e.target.value })) }}
              className="input w-full text-sm leading-relaxed min-h-[9.5rem] resize-y"
              rows={8}
              placeholder={noteDrafting && !form.notes.trim() ? 'מכין טיוטה…' : 'ניסיון, זמינות, מה עלה בשיחה...'}
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

            {/* חיפוש משרה */}
            {activePositions.length > 3 && (
              <div className="px-2 pt-2 pb-1 bg-white border-b border-slate-100">
                <div className="relative">
                  <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="חיפוש משרה..."
                    value={positionSearch}
                    onChange={e => setPositionSearch(e.target.value)}
                    className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg pr-8 pl-3 py-1.5 outline-none focus:border-brand-400 focus:bg-white transition"
                  />
                </div>
              </div>
            )}

            {/* Checkbox / radio list — enlarged */}
            <div className="min-h-[110px] max-h-48 overflow-y-auto p-2 space-y-0.5 bg-white">
              {activePositions.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">אין משרות פעילות</p>
              )}
              {activePositions.filter(p => {
                if (!positionSearch.trim()) return true
                const q = positionSearch.toLowerCase()
                return (
                  p.companyName.toLowerCase().includes(q) ||
                  p.positionTitle.toLowerCase().includes(q) ||
                  (p.city ?? '').toLowerCase().includes(q) ||
                  (p.positionNumber ?? '').includes(q)
                )
              }).map(p => {
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
                      {p.city && <span className="text-slate-300 mr-1 text-xs"> · {p.city}</span>}
                    </div>
                  </label>
                )
              })}
              {positionSearch.trim() && activePositions.filter(p => {
                const q = positionSearch.toLowerCase()
                return p.companyName.toLowerCase().includes(q) || p.positionTitle.toLowerCase().includes(q) || (p.city ?? '').toLowerCase().includes(q) || (p.positionNumber ?? '').includes(q)
              }).length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">לא נמצאו משרות תואמות</p>
              )}
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

          {(form.status === 'started_working' || form.status === 'placement_complete') && (
            <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl px-3 py-2">
              <AttributionMonthField candidate={form} onPick={setForm} />
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
              <button
                type="button"
                title={form.cvFileName || 'קורות חיים'}
                onClick={() => {
                  signedStorageUrl(form.cvUrl || '', form.cvFileName)
                    .then(url => window.open(url, '_blank', 'noopener'))
                    .catch(() => alert('לא הצלחנו לפתוח את הקובץ'))
                }}
                className="text-sm text-slate-700 truncate flex-1 text-right hover:underline"
              >
                {form.cvFileName || 'קורות חיים'}
              </button>
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
            <button onClick={submit} disabled={!form.name.trim() || !form.phone.trim()} className="btn-primary flex-1 disabled:opacity-40">
              {editing ? 'עדכן' : 'הוסף מועמד'}
            </button>
            <button onClick={onClose} className="btn-secondary px-8">ביטול</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SourcePicker({ form, choices, picking, query, suggestion, autoPicked, onQuery, onOrganic, onStartCampaign, onPick, onApplySuggestion }: {
  form: Candidate
  choices: CampaignChoice[]
  picking: boolean
  query: string
  suggestion: CampaignInference | null
  autoPicked: boolean
  onQuery: (value: string) => void
  onOrganic: () => void
  onStartCampaign: () => void
  onPick: (choice: CampaignChoice) => void
  onApplySuggestion: () => void
}) {
  const campaignMode = picking || !!form.metaCampaignId
  const organic = form.source === 'אורגני' && !form.metaCampaignId && !picking
  const selected = choices.find(choice => choice.accountId === form.metaAccountId && choice.campaignId === form.metaCampaignId)
  const needle = query.trim().toLowerCase()
  const visible = choices.filter(choice => {
    const selected = choice.accountId === form.metaAccountId && choice.campaignId === form.metaCampaignId
    if (selected) return !needle || `${choice.accountName} ${choice.campaignName}`.toLowerCase().includes(needle)
    if (!needle) return choice.active
    return `${choice.accountName} ${choice.campaignName}`.toLowerCase().includes(needle)
  })
  const legacy = form.source && form.source !== 'אורגני' && !form.metaCampaignId ? form.source : ''
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button type="button" onClick={onOrganic} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${organic ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>אורגני</button>
        <button type="button" onClick={onStartCampaign} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${campaignMode ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>קמפיין</button>
      </div>
      {legacy && <p className="text-[11px] text-slate-500">נשמר כמו שהיה: {legacy}</p>}
      {autoPicked && form.metaCampaignId && <p className="text-[11px] text-slate-500">נבחר אוטומטית. אפשר לשנות.</p>}
      {suggestion && !form.metaCampaignId && (
        <button type="button" onClick={onApplySuggestion} className="text-[11px] font-semibold text-blue-700">
          הצעה: {suggestion.campaignName}. לחצו כדי לשייך
        </button>
      )}
      {campaignMode && (
        <div className="rounded-xl border border-slate-200 p-2 space-y-2">
          {(selected || form.metaCampaignId) && (
            <p className="text-xs font-semibold text-slate-800">{selected ? `${selected.accountName} · ${selected.campaignName}` : form.source}</p>
          )}
          <input value={query} onChange={event => onQuery(event.target.value)} placeholder="חיפוש קמפיין, גם אם לא באוויר" className="input w-full text-sm" />
          <ul className="max-h-40 overflow-y-auto">
            {visible.map(choice => {
              const on = choice.accountId === form.metaAccountId && choice.campaignId === form.metaCampaignId
              return (
                <li key={`${choice.accountId}:${choice.campaignId}`}>
                  <button type="button" onClick={() => onPick(choice)} className={`w-full text-right rounded-lg px-2 py-1.5 text-sm ${on ? 'bg-slate-800 text-white' : 'hover:bg-slate-50 text-slate-700'}`}>
                    <span className="block">{choice.accountName} · {choice.campaignName}</span>
                    {!choice.active && <span className={`text-[10px] ${on ? 'text-slate-200' : 'text-slate-400'}`}>לא באוויר</span>}
                  </button>
                </li>
              )
            })}
            {visible.length === 0 && <li className="px-2 py-2 text-[11px] text-slate-400">{!choices.length ? 'עדיין אין קמפיינים. הם יופיעו אחרי הסנכרון ממטא.' : needle ? 'אין קמפיין בשם הזה' : 'אין קמפיין באוויר. חפשו שם כדי למצוא קמפיין ישן.'}</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
