import assert from 'node:assert/strict'
import {
  addCalendarDays,
  calendarDaysBetween,
  calendarToday,
  DEFAULT_GUARANTEE_DAYS,
  guaranteeAlertLines,
  guaranteeDaysForPlacement,
  placementGuarantee,
  placementPosition,
  positionGuaranteeDays,
  readGuaranteeDays,
  selectGuaranteeAlerts,
  watchPlacements,
} from '../src/utils/guarantee.ts'

assert.equal(DEFAULT_GUARANTEE_DAYS, 30)
assert.equal(readGuaranteeDays(undefined), undefined)
assert.equal(readGuaranteeDays(null), undefined)
assert.equal(readGuaranteeDays(''), undefined)
assert.equal(readGuaranteeDays('  '), undefined)
assert.equal(readGuaranteeDays(0), undefined)
assert.equal(readGuaranteeDays(-5), undefined)
assert.equal(readGuaranteeDays(3651), undefined)
assert.equal(readGuaranteeDays('nope'), undefined)
assert.equal(readGuaranteeDays('45'), 45)
assert.equal(readGuaranteeDays(' 60 '), 60)
assert.equal(readGuaranteeDays(45.2), 45)
assert.equal(readGuaranteeDays(3650), 3650)

const bingo = { id: 'bingo', companyName: 'BINGO', guaranteeDays: undefined }
const office = { id: 'office', companyName: 'משרד', guaranteeDays: 60 }
const restaurant = { id: 'rest', companyName: 'מסעדה' }
const legacy = { id: 'legacy', companyName: 'קיים', guaranteeDays: '45' as unknown as number }

assert.equal(positionGuaranteeDays(bingo), 30, 'a Bingo name no longer implies 45 days')
assert.equal(positionGuaranteeDays(restaurant), 30)
assert.equal(positionGuaranteeDays(office), 60)
assert.equal(positionGuaranteeDays(legacy), 45)
assert.equal(positionGuaranteeDays(null), 30)

const positions = [bingo, office, restaurant, legacy]
const placed = {
  status: 'started_working' as const,
  startDate: '2026-01-01',
  savedPositionIds: ['missing', 'office'],
  savedPositionId: 'bingo',
}

assert.equal(placementPosition(placed, positions)?.id, 'office')
assert.equal(guaranteeDaysForPlacement(placed, positions), 60)
assert.equal(guaranteeDaysForPlacement({ savedPositionIds: [], savedPositionId: 'legacy' }, positions), 45)
assert.equal(guaranteeDaysForPlacement({ savedPositionId: 'bingo' }, positions), 30)
assert.equal(guaranteeDaysForPlacement({}, positions), 30)

assert.equal(addCalendarDays('2026-01-01', 30), '2026-01-31')
assert.equal(addCalendarDays('2026-01-01', 45), '2026-02-15')
assert.equal(addCalendarDays('2026-02-01', 30), '2026-03-03')
assert.equal(addCalendarDays('2024-02-01', 30), '2024-03-02')
assert.equal(addCalendarDays('not-a-date', 30), null)
assert.equal(calendarDaysBetween('2026-01-24', '2026-01-31'), 7)

const during = placementGuarantee(placed, positions, '2026-01-24')
assert.equal(during.days, 60)
assert.equal(during.endDate, '2026-03-02')
assert.equal(during.daysLeft, calendarDaysBetween('2026-01-24', '2026-03-02'))
assert.equal(during.safe, false)

const lastDay = placementGuarantee({ ...placed, savedPositionIds: ['bingo'] }, positions, '2026-01-31')
assert.equal(lastDay.days, 30)
assert.equal(lastDay.endDate, '2026-01-31')
assert.equal(lastDay.daysLeft, 0)
assert.equal(lastDay.safe, false)

const safe = placementGuarantee({ ...placed, savedPositionIds: ['bingo'] }, positions, '2026-02-01')
assert.equal(safe.daysLeft, -1)
assert.equal(safe.safe, true)

const noStart = placementGuarantee({ ...placed, startDate: undefined, savedPositionIds: ['office'] }, positions, '2026-01-24')
assert.equal(noStart.endDate, null)
assert.equal(noStart.safe, false)
assert.equal(noStart.days, 60)

const candidate = { ...placed, name: 'דנה' }
const before = JSON.stringify(candidate)
placementGuarantee({ ...candidate, savedPositionIds: ['office'] }, positions, '2026-04-01')
const afterDays = placementGuarantee({ ...candidate, savedPositionIds: ['rest'] }, [{ ...restaurant, guaranteeDays: 90 }], '2026-01-01')
assert.equal(afterDays.endDate, '2026-04-01')
assert.equal(JSON.stringify(candidate), before, 'the end date is derived, not written onto the candidate')

const rows = watchPlacements([
  { id: 'soon', name: 'קרוב', status: 'started_working' as const, startDate: '2026-01-06', savedPositionId: 'bingo' },
  { id: 'today', name: 'היום', status: 'placement_complete' as const, startDate: '2026-01-01', savedPositionId: 'bingo' },
  { id: 'safe', name: 'בטוח', status: 'started_working' as const, startDate: '2025-12-21', savedPositionId: 'bingo' },
  { id: 'old', name: 'ישן', status: 'started_working' as const, startDate: '2025-10-01', savedPositionId: 'bingo' },
  { id: 'open', name: 'פתוח', status: 'sent_to_client' as const, startDate: '2026-01-01', savedPositionId: 'bingo' },
  { id: 'nostart', name: 'בלי', status: 'started_working' as const, savedPositionId: 'bingo' },
], positions, '2026-01-31')

assert.deepEqual(rows.map(row => row.candidate.id), ['soon', 'today', 'safe', 'old'])
const alerts = selectGuaranteeAlerts(rows, 7, 14)
assert.deepEqual(alerts.endingSoon.map(row => row.candidate.name), ['היום', 'קרוב'])
assert.equal(alerts.endingSoon[0].guarantee.daysLeft, 0)
assert.equal(alerts.endingSoon[1].guarantee.daysLeft, 5)
assert.deepEqual(alerts.newlySafe.map(row => row.candidate.name), ['בטוח'])
assert.equal(alerts.newlySafe[0].guarantee.endDate, '2026-01-20')

const lines = guaranteeAlertLines(rows, 7, 14)
assert.ok(lines.some(line => line.includes('היום — עד 31.1 (היום)')))
assert.ok(lines.some(line => line.includes('קרוב — עד 5.2 (5 ימים)')))
assert.ok(lines.some(line => line.includes('בטוח — הסתיימה 20.1')))
assert.ok(lines.some(line => line.includes('אפשר לחייב')))
assert.equal(guaranteeAlertLines([], 7, 7).length, 0)

assert.equal(calendarToday(new Date('2026-11-11T22:30:00Z'), 'Asia/Jerusalem'), '2026-11-12')
assert.equal(calendarToday(new Date('2026-11-11T20:00:00Z'), 'Asia/Jerusalem'), '2026-11-11')

console.log('guarantee selfcheck ok')
