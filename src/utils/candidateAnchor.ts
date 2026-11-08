import type { Candidate } from '../types'

export interface CandidateAnchor {
  day: string
  fallback: boolean
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
