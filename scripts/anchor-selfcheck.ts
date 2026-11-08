import assert from 'node:assert/strict'
import { candidateAnchor, isPlacement, placementAttribution, placementInMonth, placementOverlapsRange, withAttributionMonth } from '../src/utils/candidateAnchor'
import { mergeCandidateSave } from '../src/utils/wa'
import type { Candidate } from '../src/types'

const base = { status: 'started_working' } as Candidate

const october = candidateAnchor({
  ...base,
  createdAt: '2026-10-17T08:00:00.000Z',
  interviewDate: '2026-10-24',
  interviewHistory: [{ id: 'h', date: '2026-11-01', companyName: 'א', createdAt: '2026-11-01' }],
  startDate: '2026-11-05',
})
assert.equal(october.day, '2026-10-17')
assert.equal(october.fallback, false)
assert.equal(isPlacement(base), true)

const fallback = candidateAnchor({
  ...base,
  createdAt: '',
  interviewDate: '2026-10-24',
  startDate: '2026-11-05',
  updatedAt: '2026-11-06T00:00:00.000Z',
})
assert.equal(fallback.day, '2026-10-24')
assert.equal(fallback.fallback, true)

const missing = candidateAnchor({ ...base, createdAt: '' })
assert.equal(missing.day, '')
assert.equal(missing.fallback, true)

const created = {
  ...base,
  id: 'c1',
  name: 'דוגמה',
  phone: '0500000000',
  createdAt: '2026-10-17T08:00:00.000Z',
  startDate: '2026-11-05',
  interviewDate: '2026-10-24',
  notes: '',
  positionType: 'מוקד',
  source: 'WhatsApp',
  nonaStatus: '' as const,
  savedPositionId: 'job-1',
  updatedAt: '2026-11-05T00:00:00.000Z',
}

assert.equal(placementAttribution(created).month, '2026-10')
assert.equal(placementAttribution(created).manual, false)
assert.equal(placementInMonth(created, 2026, 10), true)
assert.equal(placementInMonth(created, 2026, 11), false)

const overridden = withAttributionMonth(created, '2026-11')
assert.equal(overridden.attributionMonth, '2026-11')
assert.equal(overridden.createdAt, created.createdAt)
assert.equal(overridden.startDate, created.startDate)
assert.equal(overridden.status, created.status)
assert.equal(overridden.savedPositionId, created.savedPositionId)
assert.equal(placementAttribution(overridden).month, '2026-11')
assert.equal(placementAttribution(overridden).manual, true)
assert.equal(placementInMonth(overridden, 2026, 11), true)
assert.equal(placementInMonth(overridden, 2026, 10), false)
assert.equal(placementOverlapsRange(overridden, '2026-11-01', '2026-11-30'), true)
assert.equal(placementOverlapsRange(overridden, '2026-10-01', '2026-10-31'), false)

const stored = JSON.parse(JSON.stringify(overridden)) as typeof overridden
assert.equal(placementAttribution(stored).month, '2026-11')

const reset = withAttributionMonth(stored, null)
assert.equal(reset.attributionMonth, undefined)
assert.equal(Object.prototype.hasOwnProperty.call(reset, 'attributionMonth'), false)
assert.equal(placementAttribution(reset).month, '2026-10')
assert.equal(reset.createdAt, created.createdAt)
assert.equal(reset.startDate, created.startDate)

const kept = mergeCandidateSave(stored, { ...stored, notes: 'הערה' })
assert.equal(kept.attributionMonth, '2026-11')
assert.equal(kept.notes, 'הערה')
assert.equal(kept.createdAt, stored.createdAt)
const cleared = mergeCandidateSave(stored, reset)
assert.equal(cleared.attributionMonth, undefined)
assert.equal(placementAttribution(cleared).month, '2026-10')

const untouched = { ...created, attributionMonth: '2026-11' }
const snapshot = JSON.stringify(untouched)
assert.equal(placementAttribution(untouched).month, '2026-11')
assert.equal(JSON.stringify(untouched), snapshot)

console.log('anchor selfcheck ok')
