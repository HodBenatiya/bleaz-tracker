import type { Candidate } from '../types'

export interface CandidateAnchor {
  day: string
  fallback: boolean
}

export interface PlacementAttribution {
  month: string
  fallback: boolean
  manual: boolean
}

function dayOf(value?: string): string {
  if (!value) return ''
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${parsed.getFullYear()}-${month}-${day}`
}

/** Month attribution uses createdAt. Missing creation dates fall back to the earliest other date. */
export function candidateAnchor(candidate: Pick<Candidate, 'createdAt' | 'startDate' | 'interviewDate' | 'interviewHistory' | 'updatedAt'>): CandidateAnchor {
  const created = dayOf(candidate.createdAt)
  if (created) return { day: created, fallback: false }
  const earliest = [
    candidate.startDate,
    candidate.interviewDate,
    ...(candidate.interviewHistory ?? []).map(item => item.date),
    candidate.updatedAt,
  ].map(dayOf).filter(Boolean).sort()[0] || ''
  return { day: earliest, fallback: true }
}

export function isPlacement(candidate: Pick<Candidate, 'status'>): boolean {
  return candidate.status === 'started_working' || candidate.status === 'placement_complete'
}

function manualMonth(value?: string): string {
  const match = value?.match(/^(\d{4})-(\d{2})$/)
  if (!match) return ''
  const month = Number(match[2])
  if (month < 1 || month > 12) return ''
  return `${match[1]}-${match[2]}`
}

function monthEnd(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(year, mon, 0)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

/** Manual YYYY-MM wins. Otherwise the creation month, or the earliest known date. */
export function placementAttribution(candidate: Pick<Candidate, 'createdAt' | 'startDate' | 'interviewDate' | 'interviewHistory' | 'updatedAt' | 'attributionMonth'>): PlacementAttribution {
  const manual = manualMonth(candidate.attributionMonth)
  if (manual) return { month: manual, fallback: false, manual: true }
  const anchor = candidateAnchor(candidate)
  return { month: anchor.day.slice(0, 7), fallback: anchor.fallback, manual: false }
}

export function placementInMonth(candidate: Pick<Candidate, 'status' | 'createdAt' | 'startDate' | 'interviewDate' | 'interviewHistory' | 'updatedAt' | 'attributionMonth'>, year: number, month: number): boolean {
  if (!isPlacement(candidate)) return false
  const key = `${year}-${String(month).padStart(2, '0')}`
  return placementAttribution(candidate).month === key
}

export function placementOverlapsRange(candidate: Pick<Candidate, 'status' | 'createdAt' | 'startDate' | 'interviewDate' | 'interviewHistory' | 'updatedAt' | 'attributionMonth'>, start: string, end: string): boolean {
  if (!isPlacement(candidate) || !start || !end) return false
  const month = placementAttribution(candidate).month
  if (!month) return false
  return `${month}-01` <= end && monthEnd(month) >= start
}

/** Changes only attributionMonth. Passing null removes a manual override. */
export function withAttributionMonth<T extends { attributionMonth?: string }>(candidate: T, month: string | null): T {
  const next = { ...candidate }
  const manual = manualMonth(month || '')
  if (!manual) delete next.attributionMonth
  else next.attributionMonth = manual
  return next
}
