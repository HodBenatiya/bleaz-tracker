/** Calendar dates for the ads sync. Israel is the CRM day; Meta reports in the ad-account timezone. */

export const ISRAEL_TZ = 'Asia/Jerusalem'

function zoneParts(date: Date, timeZone: string): Record<string, string> {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const part of format.formatToParts(date)) parts[part.type] = part.value
  if (parts.hour === '24') parts.hour = '00'
  return parts
}

export function formatDateInZone(date: Date, timeZone: string): string {
  const parts = zoneParts(date, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function todayInZone(timeZone: string, now = new Date()): string {
  return formatDateInZone(now, timeZone)
}

export function todayInIsrael(now = new Date()): string {
  return todayInZone(ISRAEL_TZ, now)
}

/** Date-only arithmetic. Noon UTC avoids DST shifting the calendar day. */
export function addDaysISO(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12))
  return date.toISOString().slice(0, 10)
}

export function eachDate(start: string, end: string): string[] {
  if (!start || !end || start > end) return []
  const dates: string[] = []
  let cursor = start
  while (cursor <= end) {
    dates.push(cursor)
    cursor = addDaysISO(cursor, 1)
    if (dates.length > 400) break
  }
  return dates
}

/** Wall-clock time in `timeZone` as a UTC instant. */
export function zonedWallTimeToUtc(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0)
  const offset = (instant: number) => {
    const parts = zoneParts(new Date(instant), timeZone)
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
    return asUtc - instant
  }
  let utc = guess - offset(guess)
  utc = guess - offset(utc)
  return new Date(utc)
}

/** Meta's hourly bucket is in the ad account timezone. Return the Israel calendar date of that hour. */
export function israelDateForAccountHour(accountDate: string, hour: number, accountTimeZone: string): string {
  const [year, month, day] = accountDate.split('-').map(Number)
  const utc = zonedWallTimeToUtc(year, month, day, hour, accountTimeZone)
  return formatDateInZone(utc, ISRAEL_TZ)
}

/** "14:00:00 - 14:59:59" or "14" → 14. */
export function parseHourLabel(label: string | undefined | null): number | null {
  if (!label) return null
  const text = String(label).trim()
  const ranged = text.match(/^(\d{1,2}):/)
  const raw = ranged ? Number(ranged[1]) : (/^\d{1,2}$/.test(text) ? Number(text) : NaN)
  if (!Number.isInteger(raw) || raw < 0 || raw > 23) return null
  return raw
}
