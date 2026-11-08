import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Camera, CheckCheck, FileText, Loader2, MapPin, Mic, Paperclip, Search, Send, Smile, X } from 'lucide-react'
import type { Candidate, CandidateStatus, SavedPosition, WaInboxLead, WaMessage, WaSessionState } from '../types'
import { CANDIDATE_STATUS_COLORS, CANDIDATE_STATUS_LABELS } from '../types'
import { linkWaInbox, markCandidateWaRead, markWaInboxRead } from '../utils/storage'
import { buildWaThreads, isIsraeliMobile, latestCv, mergeWaMessages, screeningNoteFields, toLocalPhone, type WaThread } from '../utils/wa'

interface Props {
  candidates: Candidate[]
  positions: SavedPosition[]
  inbox: WaInboxLead[]
  session: WaSessionState | null
  inboxError: string | null
  onCandidatesChange: (next: Candidate[]) => Promise<boolean>
  onPatchCandidate: (next: Candidate) => void
  onPatchInbox: (next: WaInboxLead) => void
  onRefreshInbox: () => void
}

const STATUS_ORDER: CandidateStatus[] = [
  'new', 'screening', 'call_scheduled', 'called', 'relevant', 'future_relevant',
  'sent_to_client', 'interview_scheduled', 'started_working', 'placement_complete', 'irrelevant',
]

type ListFilter = 'all' | 'unread' | 'leads' | 'candidates'

function previewOn(): boolean {
  return import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('waPreview')
}

function setupError(error: string | null): string | null {
  if (!error) return null
  if (/wa_inbox|schema cache|does not exist|Could not find the table/i.test(error)) {
    return 'טבלת השיחות עדיין לא קיימת. הריצו את schema_wa.sql ב-Supabase.'
  }
  return 'לא הצלחנו לטעון את השיחות. נסו לרענן.'
}

function sessionNote(status?: string): { tone: 'warn' | 'bad'; text: string } | null {
  if (!status || status === 'WORKING') return null
  if (status === 'SCAN_QR_CODE' || status === 'PASSKEY_REQUIRED' || status === 'PASSKEY_CONFIRMATION_REQUIRED') {
    return { tone: 'warn', text: 'המספר העסקי ממתין לסריקת QR. פתחו את לוח הבקרה של WAHA וסרקו עם הטלפון.' }
  }
  if (status === 'STARTING') return { tone: 'warn', text: 'החיבור לוואטסאפ עולה. זה לוקח כמה שניות.' }
  if (status === 'FAILED') return { tone: 'bad', text: 'החיבור לוואטסאפ נכשל. הפעילו מחדש את הסשן וסרקו QR אם צריך.' }
  if (status === 'STOPPED') return { tone: 'bad', text: 'סשן הוואטסאפ כבוי. הפעילו אותו מלוח הבקרה.' }
  return { tone: 'warn', text: `סטטוס החיבור: ${status}` }
}

function jerusalemDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })
}

function formatListTime(iso: string): string {
  if (!iso) return ''
  const day = jerusalemDay(iso)
  const today = jerusalemDay(new Date().toISOString())
  if (day === today) return formatClock(iso)
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' })
}

function dayLabel(day: string): string {
  const today = jerusalemDay(new Date().toISOString())
  const yesterday = jerusalemDay(new Date(Date.now() - 86_400_000).toISOString())
  if (day === today) return 'היום'
  if (day === yesterday) return 'אתמול'
  return new Date(day + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })
}

function ticks(status?: WaMessage['status']) {
  if (status === 'failed') return <span className="text-red-600">!</span>
  if (status === 'read') return <CheckCheck size={14} className="text-[#53bdeb]" />
  if (status === 'delivered' || status === 'sent') return <CheckCheck size={14} className="text-[#667781]" />
  return <span className="text-[10px] text-[#667781]">✓</span>
}

class WaErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) {
      return (
        <div className="m-6 rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-950" dir="rtl">
          <p className="font-bold">לא הצלחנו להציג את השיחות</p>
          <p className="text-sm mt-1">רעננו את הדף. השיחות הקיימות לא נמחקו.</p>
        </div>
      )
    }
    return this.props.children
  }
}

export default function WaInbox(props: Props) {
  return (
    <WaErrorBoundary>
      <WaInboxScreen {...props} />
    </WaErrorBoundary>
  )
}

function WaInboxScreen({
  candidates, positions, inbox, session, inboxError,
  onCandidatesChange, onPatchCandidate, onPatchInbox, onRefreshInbox,
}: Props) {
  const preview = previewOn()
  const shownCandidates = preview && candidates.length === 0 ? previewCandidates() : candidates
  const shownInbox = preview && inbox.length === 0 ? previewInbox() : inbox
  const shownPositions = preview && positions.length === 0 ? previewPositions() : positions

  const threads = useMemo(() => buildWaThreads(shownCandidates, shownInbox), [shownCandidates, shownInbox])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ListFilter>('all')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [assignOpen, setAssignOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [assignNote, setAssignNote] = useState('')
  const [phoneOverride, setPhoneOverride] = useState('')
  const [status, setStatus] = useState<CandidateStatus>('screening')
  const [chosen, setChosen] = useState<string[]>([])
  const [attachment, setAttachment] = useState<{ file: File; url: string; kind: 'image' | 'video' | 'file' } | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordMs, setRecordMs] = useState(0)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [progress, setProgress] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordStarted = useRef(0)
  const holdTimer = useRef<number | null>(null)
  const recordingLive = useRef(false)
  const skipMicClick = useRef(false)

  const visible = threads.filter(t => {
    if (filter === 'unread' && t.unread <= 0) return false
    if (filter === 'leads' && t.kind !== 'lead') return false
    if (filter === 'candidates' && t.kind !== 'candidate') return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    const hay = `${t.title} ${t.phone} ${t.messages.map(m => `${m.text} ${m.fileName ?? ''}`).join(' ')}`.toLowerCase()
    return hay.includes(q)
  })
  const selected = threads.find(t => t.key === selectedKey) ?? null
  const note = sessionNote(session?.status)
  const tableError = setupError(inboxError)

  useEffect(() => {
    if (preview) return
    let cancelled = false
    ;(async () => {
      try {
        await fetch('/api/wa-resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      } catch { /* the next webhook retries any row that is still missing a phone */ }
      if (!cancelled) onRefreshInbox()
    })()
    return () => { cancelled = true }
  }, [preview, onRefreshInbox])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedKey, selected?.messages.length])

  useEffect(() => {
    if (!selected || selected.unread <= 0 || preview) return
    let cancelled = false
    const run = async () => {
      if (selected.candidate && (selected.candidate.waUnread ?? 0) > 0) {
        const next = await markCandidateWaRead(selected.candidate.id)
        if (!cancelled && next) onPatchCandidate(next)
      }
      if (selected.inbox && !selected.inbox.candidateId && selected.inbox.unread > 0) {
        const next = await markWaInboxRead(selected.inbox.id)
        if (!cancelled && next) onPatchInbox(next)
      }
    }
    run()
    return () => { cancelled = true }
  }, [selectedKey, selected?.unread, preview])

  const appendLocal = (message: WaMessage) => {
    if (!selected) return
    if (selected.candidate) {
      onPatchCandidate({
        ...selected.candidate,
        waMessages: mergeWaMessages(selected.candidate.waMessages, [message]),
        lastWaAt: message.timestamp,
        waChatId: selected.chatId,
      })
      return
    }
    if (selected.inbox) {
      onPatchInbox({
        ...selected.inbox,
        messages: mergeWaMessages(selected.inbox.messages, [message]),
        lastMessageAt: message.timestamp,
      })
    }
  }

  const clearAttachment = () => {
    setAttachment(prev => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
  }

  const pickFile = (file: File, kind: 'image' | 'video' | 'file') => {
    if (file.size > 3 * 1024 * 1024) {
      setSendError('הקובץ גדול מדי. עד 3MB.')
      return
    }
    clearAttachment()
    setAttachment({ file, url: URL.createObjectURL(file), kind })
  }

  const fileToBase64 = (file: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })

  const stopRecorder = () => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }

  const startRecording = async () => {
    if (recordingLive.current || !selected) return
    recordingLive.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!recordingLive.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data) }
      recorderRef.current = rec
      recordStarted.current = Date.now()
      setRecordMs(0)
      setRecording(true)
      rec.start()
    } catch (err) {
      recordingLive.current = false
      setRecording(false)
      throw err
    }
  }

  const cancelRecording = () => {
    recordingLive.current = false
    stopRecorder()
    chunksRef.current = []
    setRecording(false)
    setRecordMs(0)
  }

  const send = async (voiceBlob?: Blob) => {
    const text = draft.trim()
    if (!selected || sending) return
    if (!text && !attachment && !voiceBlob) return
    setSending(true)
    setSendError('')
    setProgress(voiceBlob || attachment ? 'שולח קובץ…' : '')
    try {
      const body: Record<string, unknown> = { phone: selected.phone, text, chatId: selected.chatId }
      if (voiceBlob) {
        body.media = { kind: 'voice', filename: 'voice.webm', mimetype: voiceBlob.type || 'audio/webm', data: await fileToBase64(voiceBlob) }
      } else if (attachment) {
        body.media = {
          kind: attachment.kind,
          filename: attachment.file.name,
          mimetype: attachment.file.type || 'application/octet-stream',
          data: await fileToBase64(attachment.file),
        }
      }
      const res = await fetch('/api/wa-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        if (data.sent) {
          setDraft('')
          clearAttachment()
          if (data.message) appendLocal(data.message)
          return
        }
        const detail = typeof data.detail === 'string' ? data.detail.trim() : ''
        setSendError(detail || (typeof data.error === 'string' ? data.error : 'השליחה נכשלה. נסו שוב.'))
        return
      }
      setDraft('')
      clearAttachment()
      if (data.message) appendLocal(data.message)
    } catch {
      setSendError('השליחה נכשלה. נסו שוב.')
    } finally {
      setSending(false)
      setProgress('')
    }
  }

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => setRecordMs(Date.now() - recordStarted.current), 200)
    return () => window.clearInterval(timer)
  }, [recording])

  const finishRecording = async (sendNow: boolean) => {
    if (!recordingLive.current && !recorderRef.current) return
    recordingLive.current = false
    const rec = recorderRef.current
    recorderRef.current = null
    setRecording(false)
    setRecordMs(0)
    if (!rec) return
    const blob = await new Promise<Blob>(resolve => {
      rec.onstop = () => {
        rec.stream.getTracks().forEach(track => track.stop())
        resolve(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }))
      }
      if (rec.state !== 'inactive') rec.stop()
      else resolve(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }))
    })
    if (sendNow && blob.size > 0) await send(blob)
  }

  const snapFromCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    const video = document.createElement('video')
    video.srcObject = stream
    await video.play()
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    stream.getTracks().forEach(track => track.stop())
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.9))
    if (!blob) return
    pickFile(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }), 'image')
  }

  const openAssign = (thread: WaThread) => {
    const active = shownPositions.filter(p => p.isActive)
    const existing = thread.candidate?.savedPositionIds?.length
      ? thread.candidate.savedPositionIds
      : thread.candidate?.savedPositionId ? [thread.candidate.savedPositionId] : []
    setChosen(existing.length ? existing : (active.length === 1 ? [active[0].id] : []))
    setStatus(thread.candidate?.status ?? 'screening')
    setName('')
    setCity(thread.candidate?.city ?? '')
    const history = thread.candidate?.noteHistory ?? []
    setAssignNote(history.length ? history[history.length - 1].text : (thread.candidate?.notes ?? ''))
    setPhoneOverride('')
    setAssignError('')
    setAssignOpen(true)
  }

  const togglePosition = (id: string) => {
    setChosen(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const saveAssign = async () => {
    if (!selected || assigning) return
    setAssigning(true)
    setAssignError('')
    const now = new Date().toISOString()
    const picked = shownPositions.filter(p => chosen.includes(p.id))
    const positionType = picked.map(p => [p.companyName, p.positionTitle].filter(Boolean).join(' · ')).join(', ')
    const typedPhone = phoneOverride.trim()
    const phone = toLocalPhone(typedPhone || selected.phone) || selected.phone
    const cv = latestCv(selected.messages)
    const displayName = name.trim() || selected.candidate?.name || selected.title
    const noted = screeningNoteFields(selected.candidate, assignNote, now, crypto.randomUUID())
    let ok = false
    if (selected.candidate) {
      const next: Candidate = {
        ...selected.candidate,
        name: name.trim() || selected.candidate.name,
        city: city.trim() || selected.candidate.city,
        phone,
        status,
        notes: noted.notes,
        noteHistory: noted.noteHistory,
        savedPositionIds: chosen,
        savedPositionId: chosen[0],
        positionType: positionType || selected.candidate.positionType,
        waMessages: selected.messages,
        waUnread: 0,
        waChatId: selected.chatId,
        lastWaAt: selected.lastAt || selected.candidate.lastWaAt,
        cvUrl: selected.candidate.cvUrl || cv?.url,
        cvFileName: selected.candidate.cvFileName || cv?.name,
        updatedAt: now,
      }
      ok = await onCandidatesChange(shownCandidates.map(c => c.id === next.id ? next : c))
    } else {
      const created: Candidate = {
        id: crypto.randomUUID(),
        name: displayName,
        phone,
        city: city.trim() || undefined,
        status,
        positionType,
        source: 'WhatsApp',
        savedPositionId: chosen[0],
        savedPositionIds: chosen,
        nonaStatus: '',
        notes: noted.notes,
        noteHistory: noted.noteHistory,
        waMessages: selected.messages,
        waUnread: 0,
        waChatId: selected.chatId,
        lastWaAt: selected.lastAt,
        cvUrl: cv?.url,
        cvFileName: cv?.name,
        createdAt: selected.inbox?.createdAt || now,
        updatedAt: now,
      }
      ok = await onCandidatesChange([...shownCandidates, created])
      if (ok && selected.inbox && !preview) {
        const linked = await linkWaInbox(selected.inbox.id, created.id)
        if (linked) onPatchInbox(linked)
      }
    }
    setAssigning(false)
    if (ok) setAssignOpen(false)
    else setAssignError('השיוך נכשל. נסו שוב.')
  }

  const choices = shownPositions.filter(p => p.isActive || chosen.includes(p.id))

  return (
    <div className="flex h-full min-h-[calc(100vh-4.5rem)] bg-[#efeae2]" dir="rtl">
      <aside className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-[380px] shrink-0 flex-col bg-white border-l border-[#d1d7db]`}>
        <div className="px-4 pt-4 pb-3 bg-[#075e54] text-white">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">שיחות</h2>
            <span className="text-xs text-white/80">{threads.length} שיחות{session?.status === 'WORKING' ? ' · מחובר' : ''}</span>
          </div>
          <div className="mt-3 relative">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="חיפוש לפי שם, טלפון או תוכן"
              className="w-full rounded-lg bg-white text-slate-800 pr-9 pl-3 py-2 text-sm outline-none"
            />
          </div>
        </div>
        <div className="flex gap-1 px-3 py-2 border-b border-slate-100 bg-white overflow-x-auto">
          {([
            ['all', 'הכל'],
            ['unread', 'לא נקראו'],
            ['leads', 'לידים'],
            ['candidates', 'מועמדים'],
          ] as Array<[ListFilter, string]>).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${filter === id ? 'bg-[#075e54] text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tableError && <div className="mx-3 mt-3 rounded-lg bg-amber-50 text-amber-900 text-xs px-3 py-2 border border-amber-200">{tableError}</div>}
        {note && (
          <div className={`mx-3 mt-3 rounded-lg text-xs px-3 py-2 border ${note.tone === 'bad' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-amber-50 text-amber-900 border-amber-200'}`}>
            {note.text}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 && (
            <p className="text-center text-sm text-slate-400 px-6 py-16">
              {threads.length === 0 ? 'אין שיחות עדיין. הודעה חדשה למספר העסקי תופיע כאן.' : 'אין שיחות תואמות.'}
            </p>
          )}
          {visible.map(t => (
            <button
              key={t.key}
              onClick={() => { setSelectedKey(t.key); setAssignOpen(false); setSendError('') }}
              className={`w-full text-right px-3 py-3 flex gap-3 border-b border-slate-100 hover:bg-[#f5f6f6] ${selectedKey === t.key ? 'bg-[#f0f2f5]' : 'bg-white'}`}
            >
              <ContactAvatar name={t.title} url={t.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`truncate ${t.unread > 0 ? 'font-bold text-slate-900' : 'font-medium text-slate-800'}`}>{t.title}</span>
                  <span className="text-[11px] text-slate-500 shrink-0">{t.phoneLabel}</span>
                  <span className="mr-auto text-[11px] text-slate-400 shrink-0">{formatListTime(t.lastAt)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className={`truncate text-sm ${t.unread > 0 ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>{t.preview}</p>
                  {t.unread > 0 && (
                    <span className="mr-auto min-w-5 h-5 px-1 rounded-full bg-[#25d366] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      {t.unread}
                    </span>
                  )}
                </div>
                <div className="mt-1">
                  {t.kind === 'lead'
                    ? <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">ליד</span>
                    : <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${t.candidate ? CANDIDATE_STATUS_COLORS[t.candidate.status] : ''}`}>מועמד</span>}
                  {t.unresolved && <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded mr-1">מאתר מספר…</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col`}>
        {!selected && (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">בחרו שיחה כדי לקרוא ולענות.</div>
        )}
        {selected && (
          <>
            <header className="h-14 px-3 bg-[#075e54] text-white flex items-center gap-2 shrink-0">
              <button className="md:hidden p-1" onClick={() => setSelectedKey(null)} aria-label="חזרה">
                <ArrowRight size={18} />
              </button>
              <ContactAvatar name={selected.title} url={selected.avatarUrl} small />
              <div className="min-w-0 flex-1">
                <p className="font-bold truncate">{selected.title}</p>
                <p className="text-[11px] text-white/80 truncate">{selected.phoneLabel}{selected.candidate?.city ? ` · ${selected.candidate.city}` : ''}</p>
              </div>
              <button onClick={() => openAssign(selected)} className="bg-white text-[#075e54] text-sm font-bold px-3 py-1.5 rounded-lg">
                שיוך
              </button>
            </header>

            {assignOpen && (
              <div className="bg-white border-b border-slate-200 px-4 py-3 space-y-3 shrink-0 max-h-[70vh] overflow-y-auto">
                <div>
                  <p className="font-bold text-slate-800">שיוך שיחה</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selected.candidate
                      ? 'המועמד כבר במערכת. השמירה תעדכן משרות, סטטוס והערה.'
                      : 'הליד ייכנס לרשימת המועמדים עם היסטוריית השיחה.'}
                  </p>
                </div>
                <label className="block">
                  <span className="text-sm font-bold text-slate-800">הערה</span>
                  <span className="block text-[11px] text-slate-500 mb-1">פרטי שיחת הסינון. נשמר כמו הערות בכרטיס המועמד.</span>
                  <textarea
                    value={assignNote}
                    onChange={e => setAssignNote(e.target.value)}
                    rows={8}
                    placeholder="ניסיון, זמינות, מה עלה בשיחה..."
                    className="input-field w-full text-sm leading-relaxed min-h-[9.5rem] resize-y"
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="text-xs text-slate-500">
                    שם (לא חובה)
                    <input value={name} onChange={e => setName(e.target.value)} placeholder={selected.title} className="input-field mt-1" />
                  </label>
                  <label className="text-xs text-slate-500">
                    עיר (לא חובה)
                    <input value={city} onChange={e => setCity(e.target.value)} placeholder="עיר מגורים" className="input-field mt-1" />
                  </label>
                </div>
                {(selected.lid || !isIsraeliMobile(selected.phone)) && (
                  <label className="text-xs text-slate-500 block">
                    טלפון (אם חסר מספר רגיל)
                    <input value={phoneOverride} onChange={e => setPhoneOverride(e.target.value)} placeholder="05XXXXXXXX" className="input-field mt-1" />
                  </label>
                )}
                <div>
                  <p className="text-xs text-slate-500 mb-1">משרות פעילות</p>
                  {choices.length === 0 && <p className="text-xs text-slate-400">אין משרות פעילות כרגע. אפשר לשייך בלי משרה.</p>}
                  <div className="max-h-36 overflow-y-auto space-y-1">
                    {choices.map(p => (
                      <label key={p.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={chosen.includes(p.id)} onChange={() => togglePosition(p.id)} />
                        <span>{p.companyName}{p.positionTitle ? ` · ${p.positionTitle}` : ''}{p.city ? ` · ${p.city}` : ''}</span>
                        {!p.isActive && <span className="text-[10px] text-slate-400">לא פעילה</span>}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="text-xs text-slate-500 block">
                  סטטוס
                  <select value={status} onChange={e => setStatus(e.target.value as CandidateStatus)} className="input-field mt-1">
                    {STATUS_ORDER.map(s => <option key={s} value={s}>{CANDIDATE_STATUS_LABELS[s]}</option>)}
                  </select>
                </label>
                {assignError && <p className="text-xs text-red-600">{assignError}</p>}
                <div className="flex gap-2">
                  <button onClick={saveAssign} disabled={assigning} className="btn-primary text-sm">
                    {assigning ? <Loader2 size={14} className="animate-spin" /> : null}
                    שמירת שיוך
                  </button>
                  <button onClick={() => setAssignOpen(false)} className="btn-secondary text-sm">ביטול</button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0" style={{ background: '#efeae2' }}>
              {selected.candidate && (selected.candidate.city || selected.candidate.positionType) && (
                <div className="flex justify-center mb-2">
                  <span className="text-[11px] bg-white/80 text-slate-600 px-3 py-1 rounded-full flex items-center gap-1">
                    {selected.candidate.city && <><MapPin size={11} />{selected.candidate.city}</>}
                    {selected.candidate.positionType ? ` · ${selected.candidate.positionType}` : ''}
                  </span>
                </div>
              )}
              {groupMessages(selected.messages).map(group => (
                <div key={group.day}>
                  <div className="flex justify-center my-2">
                    <span className="text-[11px] bg-white/80 text-slate-600 px-3 py-0.5 rounded-full shadow-sm">{dayLabel(group.day)}</span>
                  </div>
                  {group.messages.map(m => <Bubble key={m.id} message={m} />)}
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <div className="bg-[#f0f2f5] px-3 py-2 shrink-0">
              {progress && <p className="text-xs text-[#075e54] px-2 pb-1">{progress}</p>}
              {sendError && <p className="text-xs text-red-600 px-2 pb-1">{sendError}</p>}
              {attachment && (
                <div className="mb-2 flex items-center gap-2 bg-white rounded-xl p-2">
                  {attachment.kind === 'image'
                    ? <img src={attachment.url} alt="" className="w-14 h-14 object-cover rounded-lg" />
                    : attachment.kind === 'video'
                      ? <video src={attachment.url} className="w-24 h-14 rounded-lg bg-black" />
                      : <span className="text-xs text-slate-600 truncate flex-1">{attachment.file.name}</span>}
                  <button type="button" onClick={clearAttachment} className="text-slate-400" aria-label="בטל קובץ"><X size={16} /></button>
                </div>
              )}
              {emojiOpen && (
                <div className="mb-2 flex flex-wrap gap-1 bg-white rounded-xl p-2 max-h-24 overflow-y-auto">
                  {['😀','😁','😂','🙂','😉','😍','🙏','👍','👎','❤️','🔥','✅','📞','📎','🎉','😢','🤔','👋'].map(emoji => (
                    <button key={emoji} type="button" className="text-xl" onClick={() => setDraft(value => value + emoji)}>{emoji}</button>
                  ))}
                </div>
              )}
              {recording && (
                <div className="mb-2 flex items-center gap-2 text-sm text-red-600">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  מקליט {Math.floor(recordMs / 1000)} שנ׳
                  <button type="button" className="text-slate-500" onClick={cancelRecording}>ביטול</button>
                  <button type="button" className="font-semibold" onClick={() => finishRecording(true)}>שליחה</button>
                </div>
              )}
              <div className="flex items-end gap-1.5">
                <input ref={fileRef} type="file" accept="image/*,video/*,.pdf,.doc,.docx,application/pdf" className="hidden" onChange={e => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file'
                  pickFile(file, kind)
                }} />
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) pickFile(file, 'image')
                }} />
                <button type="button" className="w-9 h-9 text-slate-500 flex items-center justify-center" aria-label="צרף קובץ" onClick={() => fileRef.current?.click()}><Paperclip size={18} /></button>
                <button type="button" className="w-9 h-9 text-slate-500 flex items-center justify-center" aria-label="מצלמה" onClick={() => {
                  const fine = window.matchMedia('(pointer: coarse)').matches
                  if (fine) cameraRef.current?.click()
                  else snapFromCamera().catch(() => cameraRef.current?.click())
                }}><Camera size={18} /></button>
                <button type="button" className="w-9 h-9 text-slate-500 flex items-center justify-center" aria-label="אימוג׳י" onClick={() => setEmojiOpen(open => !open)}><Smile size={18} /></button>
                <button
                  type="button"
                  className={`w-9 h-9 flex items-center justify-center ${recording ? 'text-red-600' : 'text-slate-500'}`}
                  aria-label="הקלטה"
                  onPointerDown={() => { holdTimer.current = window.setTimeout(() => { startRecording().catch(err => setSendError(err instanceof Error ? err.message : 'אין גישה למיקרופון')) }, 280) }}
                  onPointerUp={() => {
                    if (holdTimer.current) window.clearTimeout(holdTimer.current)
                    if (recordingLive.current && Date.now() - recordStarted.current > 400) {
                      skipMicClick.current = true
                      finishRecording(true)
                    }
                  }}
                  onClick={() => {
                    if (skipMicClick.current) { skipMicClick.current = false; return }
                    if (recordingLive.current) { finishRecording(true); return }
                    startRecording().catch(err => {
                      recordingLive.current = false
                      setSendError(err instanceof Error ? err.message : 'אין גישה למיקרופון')
                    })
                  }}
                ><Mic size={18} /></button>
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  rows={1}
                  placeholder={attachment ? 'כיתוב (לא חובה)' : 'הודעה'}
                  className="flex-1 rounded-2xl px-4 py-2 text-sm resize-none outline-none bg-white max-h-28"
                />
                <button
                  onClick={() => send()}
                  disabled={sending || (!draft.trim() && !attachment)}
                  className="w-10 h-10 rounded-full bg-[#25d366] text-white flex items-center justify-center disabled:opacity-40 shrink-0"
                  aria-label="שליחה"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function ContactAvatar({ name, url, small }: { name: string; url?: string; small?: boolean }) {
  const [failed, setFailed] = useState(false)
  const size = small ? 'w-9 h-9 text-sm' : 'w-11 h-11'
  const initial = name.trim().slice(0, 1) || '?'
  if (url && !failed) {
    return <img src={url} alt="" className={`${size} rounded-full object-cover shrink-0 bg-[#dfe5e7]`} onError={() => setFailed(true)} />
  }
  return <div className={`${size} rounded-full bg-[#dfe5e7] text-[#54656f] flex items-center justify-center font-bold shrink-0`}>{initial}</div>
}

function groupMessages(messages: WaMessage[]): Array<{ day: string; messages: WaMessage[] }> {
  const groups: Array<{ day: string; messages: WaMessage[] }> = []
  for (const m of messages) {
    const day = jerusalemDay(m.timestamp)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.messages.push(m)
    else groups.push({ day, messages: [m] })
  }
  return groups
}

function Bubble({ message }: { message: WaMessage }) {
  const mine = message.direction === 'out'
  return (
    <div className={`flex mb-1 ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`rounded-2xl px-3 py-2 max-w-[80%] shadow-sm ${mine ? 'rounded-tl-sm' : 'rounded-tr-sm'}`}
        style={{ background: mine ? '#d9fdd3' : '#fff' }}
      >
        <Media message={message} />
        {message.text && message.type !== 'text' && <p className="text-sm text-slate-800 whitespace-pre-wrap mt-1">{message.text}</p>}
        {message.type === 'text' && <p className="text-sm text-slate-800 whitespace-pre-wrap">{linkify(message.text)}</p>}
        <p className="text-[10px] text-[#667781] mt-0.5 flex items-center justify-end gap-1">
          {formatClock(message.timestamp)}
          {mine && ticks(message.status)}
        </p>
      </div>
    </div>
  )
}

function mediaSrc(message: WaMessage): string {
  if (message.fileUrl?.startsWith('/api/wa-media')) return message.fileUrl
  if (message.fileUrl && /^https?:\/\//.test(message.fileUrl) && !message.fileUrl.includes('/api/files/')) return message.fileUrl
  return `/api/wa-media?id=${encodeURIComponent(message.id)}`
}

function Media({ message }: { message: WaMessage }) {
  const [zoom, setZoom] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!message.fileUrl && !message.filePath && message.type === 'text') return null
  const src = mediaSrc(message)
  if (message.type === 'image' || message.type === 'sticker') {
    if (failed) return <p className="text-sm">{message.type === 'sticker' ? 'סטיקר' : 'תמונה'}</p>
    return (
      <>
        <button type="button" onClick={() => setZoom(true)} className="block">
          <img src={src} alt={message.fileName || 'תמונה'} onError={() => setFailed(true)} className={`rounded-lg max-w-full ${message.type === 'sticker' ? 'max-h-40' : 'max-h-64 object-cover cursor-zoom-in'}`} />
        </button>
        {zoom && (
          <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4" onClick={() => setZoom(false)}>
            <img src={src} alt="" className="max-h-[90vh] max-w-[90vw] object-contain" />
          </div>
        )}
      </>
    )
  }
  if (message.type === 'video') return failed
    ? <p className="text-sm">סרטון</p>
    : <video src={src} controls onError={() => setFailed(true)} className="max-w-full rounded-lg max-h-64" />
  if (message.type === 'audio') return failed
    ? <p className="text-sm">הודעה קולית</p>
    : <audio src={src} controls onError={() => setFailed(true)} className="max-w-full" />
  if (message.type === 'document') {
    return <a href={`${src}${src.includes('?') ? '&' : '?'}download=1`} className="flex items-center gap-2 text-sm text-[#027eb5] underline"><FileText size={16} />{message.fileName || 'קובץ'}</a>
  }
  if (message.type !== 'text' && !message.text) return <p className="text-sm text-slate-600">{message.type === 'location' ? 'מיקום' : message.type === 'contact' ? 'איש קשר' : 'הודעה'}</p>
  return null
}

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, i) => part.match(/^https?:\/\//)
    ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline break-all">{part}</a>
    : <span key={i}>{part}</span>)
}

function previewCandidates(): Candidate[] {
  const now = new Date().toISOString()
  return [{
    id: 'preview-candidate',
    name: 'נועה לוי',
    phone: '0521234567',
    city: 'חיפה',
    status: 'screening',
    positionType: 'מלצרות',
    source: 'WhatsApp',
    nonaStatus: '',
    notes: '',
    waChatId: '972521234567@c.us',
    waUnread: 0,
    lastWaAt: now,
    savedPositionIds: [],
    waMessages: [{
      id: 'm1', direction: 'in', text: 'שלום, ראיתי את המשרה בחיפה', timestamp: now, type: 'text', source: 'waha',
    }],
    createdAt: now,
    updatedAt: now,
  }]
}

function previewInbox(): WaInboxLead[] {
  const now = new Date().toISOString()
  return [{
    id: 'wa_509998887',
    phone: '0509998887',
    chatId: '972509998887@c.us',
    name: 'דני',
    provider: 'waha',
    unread: 2,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: 'm2', direction: 'in', text: 'אפשר לשלוח קורות חיים?', timestamp: now, type: 'text', source: 'waha' },
      { id: 'm3', direction: 'in', text: '', timestamp: now, type: 'document', fileName: 'cv.pdf', source: 'waha' },
    ],
  }]
}

function previewPositions(): SavedPosition[] {
  return [{
    id: 'preview-pos',
    companyName: 'קפה הים',
    positionTitle: 'בריסטה',
    city: 'תל אביב',
    isActive: true,
    createdAt: new Date().toISOString(),
    funnelSentToClient: 0,
    funnelInterviews: 0,
    funnelAccepted: 0,
    funnelConfirmed: 0,
  }]
}
