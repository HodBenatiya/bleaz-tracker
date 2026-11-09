import { placementAttribution, withAttributionMonth, type PlacementAttribution } from '../utils/candidateAnchor'
import type { Candidate } from '../types'

interface Props {
  candidate: Candidate
  onPick: (next: Candidate) => void
}

export function automaticAttribution(candidate: Candidate): PlacementAttribution {
  return placementAttribution({ ...candidate, attributionMonth: undefined })
}

export default function AttributionMonthField({ candidate, onPick }: Props) {
  const current = placementAttribution(candidate)
  const automatic = automaticAttribution(candidate)

  const pick = (value: string) => {
    if (!value || value === automatic.month) onPick(withAttributionMonth(candidate, null))
    else onPick(withAttributionMonth(candidate, value))
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5 max-w-full" dir="rtl">
      <label className="inline-flex items-center gap-1 text-[11px] text-slate-500">
        <span className="whitespace-nowrap">חודש שיוך ההשמה</span>
        <input
          type="month"
          aria-label="חודש שיוך ההשמה"
          value={current.month}
          onChange={event => pick(event.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-1.5 py-1 bg-white min-w-0"
        />
      </label>
      {current.manual ? (
        <button
          type="button"
          onClick={() => onPick(withAttributionMonth(candidate, null))}
          className="text-[11px] font-semibold text-indigo-700 underline underline-offset-2"
        >
          איפוס לחודש היצירה
        </button>
      ) : (
        <span className="text-[10px] text-slate-400 whitespace-nowrap">
          {current.fallback ? 'תאריך משוער' : 'חודש יצירת הרשומה'}
        </span>
      )}
    </div>
  )
}
