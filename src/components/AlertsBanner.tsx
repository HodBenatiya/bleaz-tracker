import { AlertTriangle, Info, TrendingDown } from 'lucide-react'
import type { DailyReport } from '../types'
import { calcCostPerLead } from '../utils/helpers'

interface Props {
  todayReport: DailyReport | null
  weekReports: DailyReport[]
}

export default function AlertsBanner({ todayReport, weekReports }: Props) {
  const alerts: { type: 'red' | 'yellow' | 'blue'; message: string; sub?: string }[] = []

  // בדיקת עלות לליד גבוהה בכל משרה של היום
  if (todayReport) {
    for (const job of todayReport.jobs) {
      const cpl = calcCostPerLead(job.campaignCost, job.leadsIn)
      if (cpl > 30) {
        alerts.push({
          type: 'yellow',
          message: `עלות לליד גבוהה: ${job.companyName} — ₪${cpl}`,
          sub: 'עלות הליד חצתה את ₪30. כדאי לבחון את יעד הקמפיין.',
        })
      }
    }

    if (todayReport.outreachSent === 0) {
      alerts.push({
        type: 'blue',
        message: 'תזכורת: לא יצאו פניות יזומות היום',
        sub: 'גיוס לקוחות חדשים דורש פניות יזומות שוטפות.',
      })
    }
  }

  // אזהרה שבועית — אם עברו 3 ימים בלי פניות יזומות
  const weekOutreach = weekReports.reduce((s, r) => s + r.outreachSent, 0)
  if (weekReports.length >= 3 && weekOutreach === 0) {
    alerts.push({
      type: 'red',
      message: 'אזהרה: אפס פניות יזומות השבוע',
      sub: 'עברו 3+ ימים בלי פניות. גיוס לקוחות דורש פניות שוטפות.',
    })
  }

  if (alerts.length === 0) return null

  return (
    <div className="flex flex-col gap-3 mb-6">
      {alerts.map((a, i) => (
        <div key={i} className={`alert-${a.type}`}>
          <span className="mt-0.5 shrink-0">
            {a.type === 'red'    && <TrendingDown size={18} />}
            {a.type === 'yellow' && <AlertTriangle size={18} />}
            {a.type === 'blue'   && <Info size={18} />}
          </span>
          <div>
            <p className="font-semibold text-sm">{a.message}</p>
            {a.sub && <p className="text-xs mt-0.5 opacity-80">{a.sub}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
