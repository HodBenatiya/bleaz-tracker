import { addDaysISO, eachDate } from './zone.ts'

export type RangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'past' | 'custom'

export interface MarketingRange {
  start: string
  end: string
  label: string
}

function monthLastDay(year: number, month: number): string {
  return addDaysISO(`${year}-${String(month).padStart(2, '0')}-01`, daysInMonth(year, month) - 1)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  return { start, end: monthLastDay(year, month) }
}

export function monthName(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Inclusive Israel dates for the marketing screen. `today` is already Asia/Jerusalem. */
export function resolveMarketingRange(input: {
  preset: RangePreset
  today: string
  pastMonth?: string
  customStart?: string
  customEnd?: string
}): MarketingRange {
  const today = input.today
  if (input.preset === 'yesterday') {
    const day = addDaysISO(today, -1)
    return { start: day, end: day, label: 'אתמול' }
  }
  if (input.preset === 'week') {
    return { start: addDaysISO(today, -6), end: today, label: '7 ימים אחרונים' }
  }
  if (input.preset === 'month') {
    const [year, month] = today.split('-').map(Number)
    return { start: monthBounds(year, month).start, end: today, label: 'החודש' }
  }
  if (input.preset === 'past' && input.pastMonth && /^\d{4}-\d{2}$/.test(input.pastMonth)) {
    const [year, month] = input.pastMonth.split('-').map(Number)
    if (month >= 1 && month <= 12) {
      const bounds = monthBounds(year, month)
      return { ...bounds, label: monthName(year, month) }
    }
  }
  if (input.preset === 'custom' && input.customStart && input.customEnd) {
    const start = input.customStart <= input.customEnd ? input.customStart : input.customEnd
    const end = input.customStart <= input.customEnd ? input.customEnd : input.customStart
    return { start, end, label: `${start} – ${end}` }
  }
  return { start: today, end: today, label: 'היום' }
}

/** Days before `today` in the range that have no stored daily row. Today comes from the live snapshot. */
export function datesMissingSpend(start: string, end: string, today: string, storedDates: Iterable<string>): string[] {
  const have = new Set(storedDates)
  return eachDate(start, end).filter(day => day < today && !have.has(day))
}

/** Closed-day portion of a screen range. Null when the range is only today. */
export function historySpan(start: string, end: string, today: string): { since: string; until: string } | null {
  if (!start || !end || start > end) return null
  const until = end < today ? end : addDaysISO(today, -1)
  if (start > until) return null
  return { since: start, until }
}

export function chunkIsoRange(start: string, end: string, size = 90): { start: string; end: string }[] {
  if (!start || !end || start > end || size < 1) return []
  const chunks: { start: string; end: string }[] = []
  let cursor = start
  while (cursor <= end && chunks.length < 12) {
    let chunkEnd = addDaysISO(cursor, size - 1)
    if (chunkEnd > end) chunkEnd = end
    chunks.push({ start: cursor, end: chunkEnd })
    const next = addDaysISO(chunkEnd, 1)
    if (next <= cursor) break
    cursor = next
  }
  return chunks
}

/** How many calendar days, including today, the frequent sync should cache. */
export function recentSpendWindow(today: string, days: number): { since: string; until: string } {
  const span = Math.min(Math.max(Math.floor(days) || 1, 1), 400)
  return { since: addDaysISO(today, -(span - 1)), until: today }
}
