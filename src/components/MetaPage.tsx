import { useState } from 'react'
import { Zap, Upload, Share2, Info } from 'lucide-react'
import type { SavedPosition, DailyReport, JobPosition } from '../types'
import { loadMetaCredentials } from '../utils/metaApi'
import { todayISO, reportForDate, newEmptyReport, generateId } from '../utils/helpers'
import MetaSync from './MetaSync'
import MetaCsvImport from './MetaCsvImport'

interface Props {
  savedPositions: SavedPosition[]
  reports:        DailyReport[]
  onSave:         (report: DailyReport) => void
}

function buildTodayJobs(savedPositions: SavedPosition[], reports: DailyReport[]): JobPosition[] {
  const today   = todayISO()
  const existing = reportForDate(reports, today)?.jobs ?? []
  return savedPositions.filter(p => p.isActive).map(pos => {
    const found = existing.find(j => j.savedPositionId === pos.id)
    return found ?? {
      id: generateId(), savedPositionId: pos.id,
      companyName: pos.companyName, positionTitle: pos.positionTitle, city: pos.city,
      campaignCost: 0, leadsIn: 0, relevantLeads: 0,
    }
  })
}

export default function MetaPage({ savedPositions, reports, onSave }: Props) {
  const [showSync, setShowSync] = useState(false)
  const [showCsv,  setShowCsv]  = useState(false)
  const metaConnected = !!loadMetaCredentials()

  const today    = todayISO()
  const todayRep = reportForDate(reports, today)
  const jobs     = buildTodayJobs(savedPositions, reports)

  function handleApply(newJobs: JobPosition[]) {
    const base = todayRep ?? newEmptyReport(today)
    onSave({ ...base, jobs: newJobs, updatedAt: new Date().toISOString() })
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800 mb-1">שילוב Meta Ads Manager</h2>
        <p className="text-sm text-slate-500">
          ייבא נתוני קמפיינים מ-Meta ישירות לדיווח היומי של היום ({today}).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {/* Meta API Sync */}
        <button
          onClick={() => setShowSync(true)}
          className="card text-right hover:shadow-lg transition-shadow group flex flex-col gap-3 p-5"
        >
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${metaConnected ? 'bg-blue-600' : 'bg-slate-100'}`}>
            <Zap size={22} className={metaConnected ? 'text-white' : 'text-slate-400'} />
          </div>
          <div>
            <p className="font-bold text-slate-800 text-base mb-1">
              {metaConnected ? 'סנכרון Meta API' : 'חבר Meta API'}
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              {metaConnected
                ? 'שלוף נתוני קמפיינים, הוצאות ולידים ישירות מחשבון Meta שלך.'
                : 'הגדר Access Token ו-Account ID להתחלת סנכרון אוטומטי.'}
            </p>
          </div>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full self-start ${metaConnected ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
            {metaConnected ? 'מחובר ✓' : 'לא מחובר'}
          </span>
        </button>

        {/* CSV Import */}
        <button
          onClick={() => setShowCsv(true)}
          className="card text-right hover:shadow-lg transition-shadow group flex flex-col gap-3 p-5"
        >
          <div className="w-11 h-11 rounded-xl bg-indigo-100 flex items-center justify-center">
            <Upload size={22} className="text-indigo-600" />
          </div>
          <div>
            <p className="font-bold text-slate-800 text-base mb-1">ייבוא CSV</p>
            <p className="text-xs text-slate-500 leading-relaxed">
              ייצא דוח מ-Meta Ads Manager ועלה אותו כאן. הנתונים ימופו אוטומטית למשרות.
            </p>
          </div>
          <span className="text-xs font-semibold px-2 py-1 rounded-full self-start bg-indigo-50 text-indigo-700">
            ייבא קובץ CSV
          </span>
        </button>
      </div>

      {/* Info box */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex gap-3">
        <Info size={16} className="text-slate-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-500 leading-relaxed">
          <p className="font-semibold text-slate-600 mb-1">איך זה עובד?</p>
          <ul className="list-disc list-inside space-y-1">
            <li>הנתונים שמיובאים מתמלאים בדיווח היומי של <strong>היום</strong> ({today}).</li>
            <li>לסנכרון API — צור Access Token ב-Meta Business Suite עם הרשאת <code>ads_read</code>.</li>
            <li>לייבוא CSV — הורד דוח &quot;Campaigns&quot; מ-Meta Ads Manager, בחר טווח תאריכים של יום אחד.</li>
            <li>לאחר הייבוא, עבור ל&quot;דיווח יומי&quot; כדי לעדכן לידים רלוונטיים ולשמור.</li>
          </ul>
        </div>
      </div>

      {/* Modals */}
      {showSync && (
        <MetaSync
          date={today}
          savedPositions={savedPositions}
          currentJobs={jobs}
          onApply={newJobs => { handleApply(newJobs); setShowSync(false) }}
          onClose={() => setShowSync(false)}
        />
      )}
      {showCsv && (
        <MetaCsvImport
          savedPositions={savedPositions}
          currentJobs={jobs}
          onApply={newJobs => { handleApply(newJobs); setShowCsv(false) }}
          onClose={() => setShowCsv(false)}
        />
      )}
    </div>
  )
}
