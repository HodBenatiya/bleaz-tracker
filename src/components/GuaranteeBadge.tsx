import type { Candidate, SavedPosition } from '../types'
import { placementGuarantee } from '../utils/guarantee'

interface Props {
  candidate: Pick<Candidate, 'startDate' | 'savedPositionId' | 'savedPositionIds'>
  positions: Array<Pick<SavedPosition, 'id' | 'guaranteeDays'>>
  today?: string
}

function formatEnd(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
}

/** End date and days left for a placed candidate. Renders nothing without a start date. */
export default function GuaranteeBadge({ candidate, positions, today }: Props) {
  const guarantee = placementGuarantee(candidate, positions, today)
  if (!guarantee.endDate || guarantee.daysLeft == null) return null
  const end = formatEnd(guarantee.endDate)
  if (guarantee.safe) {
    return (
      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full whitespace-nowrap">
        בטוח ✓ · {end}
      </span>
    )
  }
  const urgent = guarantee.daysLeft <= 7
  const label = guarantee.daysLeft === 0 ? 'אחריות מסתיימת היום' : `אחריות: ${guarantee.daysLeft} ימים`
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${urgent ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
      {label}
      <span className="opacity-70 mr-1">עד {end} ({guarantee.days})</span>
    </span>
  )
}
