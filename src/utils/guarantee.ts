import type { Candidate, SavedPosition } from '../types'

/** Used when a position has no usable ימי אחריות value. */
export const DEFAULT_GUARANTEE_DAYS = 30

const PLACED = new Set(['started_working', 'placement_complete'])

export type PositionGuarantee = Pick<SavedPosition, 'id' | 'guaranteeDays'>

export type PlacementRef = Pick<Candidate, 'status' | 'startDate' | 'savedPositionId' | 'savedPositionIds'>

export interface GuaranteeSnapshot {
  /** Contract length in days. Always a positive number, 30 when unset. */
  days: number
  /** YYYY-MM-DD, start date plus `days`. Null until the candidate has a start date. */
  endDate: string | null
  /** Calendar days from `today` until `endDate`. Negative after the end date. */
  daysLeft: number | null
  /** The fee is safe: today is after the end date. */
  safe: boolean
}

export interface GuaranteeWatch<T> {
  candidate: T
  guarantee: GuaranteeSnapshot
}

/**
 * A stored ימי אחריות value. Missing or unusable values return undefined
 * so callers can fall back to {@link DEFAULT_GUARANTEE_DAYS} without
 * writing anything back onto the position.
 */
export function readGuaranteeDays(value: unknown): number | undefined {
  const numeric = typeof value === 'string'
    ? (value.trim() === '' ? Number.NaN : Number(value.trim()))
    : value
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return undefined
  const days = Math.round(numeric)
  if (days < 1 || days > 3650) return undefined
  return days
}

export function positionGuaranteeDays(position: { guaranteeDays?: unknown } | null | undefined): number {
  return readGuaranteeDays(position?.guaranteeDays) ?? DEFAULT_GUARANTEE_DAYS
}

export function isPlacedStatus(status: string | undefined): boolean {
  return status != null && PLACED.has(status)
}

export function isGuaranteePlacement(candidate: { status?: string; startDate?: string }): boolean {
  return isPlacedStatus(candidate.status) && Boolean(candidate.startDate)
}

/** First linked position that still exists. Same resolution the old Bingo/30 rule used. */
export function placementPosition<T extends { id: string }>(
  candidate: Pick<Candidate, 'savedPositionId' | 'savedPositionIds'>,
  positions: T[],
): T | undefined {
  const ids = candidate.savedPositionIds?.length
    ? candidate.savedPositionIds
    : candidate.savedPositionId ? [candidate.savedPositionId] : []
  for (const id of ids) {
    const found = positions.find(position => position.id === id)
    if (found) return found
  }
  return undefined
}

export function guaranteeDaysForPlacement(
  candidate: Pick<Candidate, 'savedPositionId' | 'savedPositionIds'>,
  positions: Array<{ id: string; guaranteeDays?: unknown }>,
): number {
  return positionGuaranteeDays(placementPosition(candidate, positions))
}

export function calendarToday(now: Date = new Date(), timeZone?: string): string {
  if (!timeZone) {
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  if (!year || !month || !day) return calendarToday(now)
  return `${year}-${month}-${day}`
}

export function addCalendarDays(isoDate: string, days: number): string | null {
  const day = isoDate.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const date = new Date(`${day}T12:00:00`)
  if (Number.isNaN(date.getTime())) return null
  date.setDate(date.getDate() + days)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function calendarDaysBetween(fromIso: string, toIso: string): number | null {
  const from = addCalendarDays(fromIso, 0)
  const to = addCalendarDays(toIso, 0)
  if (!from || !to) return null
  const start = new Date(`${from}T12:00:00`).getTime()
  const end = new Date(`${to}T12:00:00`).getTime()
  return Math.round((end - start) / 86_400_000)
}

/**
 * Guarantee for one placed candidate. Nothing is stored on the candidate:
 * changing the position's ימי אחריות changes the end date on the next read.
 */
export function placementGuarantee(
  candidate: Pick<Candidate, 'startDate' | 'savedPositionId' | 'savedPositionIds'>,
  positions: Array<{ id: string; guaranteeDays?: unknown }>,
  today: string = calendarToday(),
): GuaranteeSnapshot {
  const days = guaranteeDaysForPlacement(candidate, positions)
  const start = candidate.startDate?.slice(0, 10) ?? ''
  const endDate = start ? addCalendarDays(start, days) : null
  const daysLeft = endDate ? calendarDaysBetween(today, endDate) : null
  return {
    days,
    endDate,
    daysLeft,
    safe: daysLeft != null && daysLeft < 0,
  }
}

export function watchPlacements<T extends PlacementRef>(
  candidates: T[],
  positions: Array<{ id: string; guaranteeDays?: unknown }>,
  today?: string,
): GuaranteeWatch<T>[] {
  const day = today ?? calendarToday()
  return candidates
    .filter(isGuaranteePlacement)
    .map(candidate => ({ candidate, guarantee: placementGuarantee(candidate, positions, day) }))
    .filter(row => row.guarantee.endDate != null && row.guarantee.daysLeft != null)
}

export function selectGuaranteeAlerts<T>(
  rows: GuaranteeWatch<T>[],
  soonDays = 7,
  safeLookback = 14,
): { endingSoon: GuaranteeWatch<T>[]; newlySafe: GuaranteeWatch<T>[] } {
  const endingSoon = rows
    .filter(row => row.guarantee.daysLeft != null && row.guarantee.daysLeft >= 0 && row.guarantee.daysLeft <= soonDays)
    .sort((a, b) => (a.guarantee.daysLeft ?? 0) - (b.guarantee.daysLeft ?? 0))
  const newlySafe = rows
    .filter(row => row.guarantee.daysLeft != null && row.guarantee.daysLeft < 0 && row.guarantee.daysLeft >= -safeLookback)
    .sort((a, b) => (b.guarantee.daysLeft ?? 0) - (a.guarantee.daysLeft ?? 0))
  return { endingSoon, newlySafe }
}

function dayDot(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${Number(day)}.${Number(month)}`
}

/** Lines for the weekly WhatsApp summary. Empty when nothing is ending or newly safe. */
export function guaranteeAlertLines(
  rows: GuaranteeWatch<{ name?: string }>[],
  soonDays = 7,
  safeLookback = 7,
): string[] {
  const { endingSoon, newlySafe } = selectGuaranteeAlerts(rows, soonDays, safeLookback)
  const lines: string[] = []
  if (endingSoon.length > 0) {
    lines.push(`🛡️ *אחריות שמסתיימת בקרוב:* *${endingSoon.length}*`)
    for (const row of endingSoon.slice(0, 5)) {
      const left = row.guarantee.daysLeft ?? 0
      const when = left === 0 ? 'היום' : `${left} ימים`
      lines.push(`  · ${row.candidate.name || 'מועמד'} — עד ${dayDot(row.guarantee.endDate!)} (${when})`)
    }
    if (endingSoon.length > 5) lines.push(`  ועוד ${endingSoon.length - 5}...`)
  }
  if (newlySafe.length > 0) {
    lines.push(`✅ *אחריות שהסתיימה (אפשר לחייב):* *${newlySafe.length}*`)
    for (const row of newlySafe.slice(0, 5)) {
      lines.push(`  · ${row.candidate.name || 'מועמד'} — הסתיימה ${dayDot(row.guarantee.endDate!)}`)
    }
    if (newlySafe.length > 5) lines.push(`  ועוד ${newlySafe.length - 5}...`)
  }
  return lines
}
