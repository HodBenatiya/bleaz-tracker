import { useState } from 'react'
import { X, Zap, Settings2, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'
import type { JobPosition, SavedPosition } from '../types'
import {
  MetaCredentials, MetaCampaign,
  loadMetaCredentials, saveMetaCredentials, clearMetaCredentials,
  fetchDailyInsights,
} from '../utils/metaApi'
import { generateId } from '../utils/helpers'

interface Props {
  date:           string
  savedPositions: SavedPosition[]
  currentJobs:    JobPosition[]
  onApply:        (jobs: JobPosition[]) => void
  onClose:        () => void
}

interface CampaignRow extends MetaCampaign {
  selectedJobId: string   // savedPosition.id or 'new'
  checked:       boolean
}

type Step = 'settings' | 'sync' | 'results'

export default function MetaSync({ date, savedPositions, currentJobs, onApply, onClose }: Props) {
  const stored = loadMetaCredentials()

  const [step,      setStep]      = useState<Step>(stored ? 'sync' : 'settings')
  const [creds,     setCreds]     = useState<MetaCredentials>(stored ?? { accessToken: '', accountId: '' })
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])

  const activePositions = savedPositions.filter(p => p.isActive)

  // ── fetch ──────────────────────────────────────────────────────────────────
  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDailyInsights(creds, date)
      if (data.length === 0) {
        setError('לא נמצאו קמפיינים עם נתונים בתאריך זה. ייתכן שהמודעות לא היו פעילות.')
        setLoading(false)
        return
      }
      setCampaigns(data.map(c => {
        const match = activePositions.find(p =>
          c.campaignName.toLowerCase().includes(p.positionTitle.toLowerCase()) ||
          c.campaignName.toLowerCase().includes(p.companyName.toLowerCase())
        )
        return { ...c, selectedJobId: match?.id ?? 'new', checked: true }
      }))
      setStep('results')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'שגיאה בחיבור ל-Meta')
    }
    setLoading(false)
  }

  // ── apply to form ──────────────────────────────────────────────────────────
  function applyToForm() {
    const checked = campaigns.filter(c => c.checked)
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

  function updateRow(id: string, patch: Partial<CampaignRow>) {
    setCampaigns(prev => prev.map(c => c.campaignId === id ? { ...c, ...patch } : c))
  }

  function saveAndConnect() {
    if (!creds.accessToken.trim() || !creds.accountId.trim()) return
    saveMetaCredentials(creds)
    setStep('sync')
  }

  const checkedCount = campaigns.filter(c => c.checked).length

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col" dir="rtl">

        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Zap size={15} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-slate-800 leading-none">Meta Ads Sync</p>
              <p className="text-xs text-slate-400 mt-0.5">{date}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {step !== 'settings' && (
              <button onClick={() => setStep('settings')} className="p-1.5 text-slate-400 hover:text-slate-700" title="הגדרות">
                <Settings2 size={15} />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700"><X size={18} /></button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto flex-1">

          {/* ── step: settings ── */}
          {step === 'settings' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
                <p className="font-semibold mb-2">איך מקבלים Access Token שלא פג תוקף:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
                  <li>כנס ל-<strong>business.facebook.com</strong> ← הגדרות עסק</li>
                  <li>משתמשי מערכת ← הוסף משתמש מערכת (תפקיד: אנליסט)</li>
                  <li>הוסף נכסים ← חשבון המודעות שלך</li>
                  <li>צור טוקן ← בחר הרשאה: <strong>ads_read</strong></li>
                </ol>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Access Token</label>
                <textarea
                  value={creds.accessToken}
                  onChange={e => setCreds(c => ({ ...c, accessToken: e.target.value.trim() }))}
                  className="input w-full font-mono text-xs resize-none"
                  rows={3}
                  placeholder="EAAxxxxxx..."
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ad Account ID</label>
                <input
                  value={creds.accountId}
                  onChange={e => setCreds(c => ({ ...c, accountId: e.target.value.trim().replace(/^act_/, '') }))}
                  className="input w-full font-mono"
                  placeholder="123456789"
                  dir="ltr"
                />
                <p className="text-xs text-slate-400 mt-1">
                  ממנהל המודעות → בחר חשבון → ה-ID בפינה שמאלית למעלה
                </p>
              </div>

              <button
                onClick={saveAndConnect}
                disabled={!creds.accessToken.trim() || !creds.accountId.trim()}
                className="btn-primary w-full disabled:opacity-40"
              >
                שמור והתחבר
              </button>
            </div>
          )}

          {/* ── step: sync ── */}
          {step === 'sync' && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-xl p-3 text-sm flex items-center gap-2">
                <CheckCircle size={16} className="text-emerald-500 shrink-0" />
                <span className="text-slate-600">
                  מחובר לחשבון <span className="font-mono font-bold text-slate-800">act_{creds.accountId}</span>
                </span>
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                onClick={fetchData}
                disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2 py-3"
              >
                {loading
                  ? <><RefreshCw size={16} className="animate-spin" /> טוען נתונים ממטא...</>
                  : <><Zap size={16} /> טען נתוני {date}</>}
              </button>

              <button
                onClick={() => { clearMetaCredentials(); setStep('settings'); setCreds({ accessToken: '', accountId: '' }) }}
                className="text-xs text-slate-400 hover:text-red-500 w-full text-center"
              >
                נתק חשבון Meta
              </button>
            </div>
          )}

          {/* ── step: results ── */}
          {step === 'results' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                נמצאו {campaigns.length} קמפיינים. שייך כל אחד למשרה ולחץ עדכן.
              </p>

              <div className="space-y-2">
                {campaigns.map(row => (
                  <div
                    key={row.campaignId}
                    className={`rounded-xl border p-3 transition-all ${
                      row.checked ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50 opacity-50'
                    }`}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <input
                        type="checkbox"
                        checked={row.checked}
                        onChange={e => updateRow(row.campaignId, { checked: e.target.checked })}
                        className="mt-1 shrink-0"
                      />
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
                            <span className="text-slate-400">
                              CPL: ₪{(row.spend / row.leads).toFixed(0)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {row.checked && (
                      <select
                        value={row.selectedJobId}
                        onChange={e => updateRow(row.campaignId, { selectedJobId: e.target.value })}
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
            </div>
          )}
        </div>

        {/* footer */}
        {step === 'results' && (
          <div className="px-5 pb-5 border-t border-slate-100 pt-4 flex gap-3">
            <button
              onClick={applyToForm}
              disabled={checkedCount === 0}
              className="btn-primary flex-1 flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <CheckCircle size={16} />
              עדכן דיווח ({checkedCount} קמפיינים)
            </button>
            <button onClick={() => setStep('sync')} className="btn-secondary px-4">בטל</button>
          </div>
        )}
      </div>
    </div>
  )
}
