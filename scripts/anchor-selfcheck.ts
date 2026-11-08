import assert from 'node:assert/strict'
import { candidateAnchor, isPlacement } from '../src/utils/candidateAnchor'
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

console.log('anchor selfcheck ok')
