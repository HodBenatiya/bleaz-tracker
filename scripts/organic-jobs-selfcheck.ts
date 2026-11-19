import assert from 'node:assert/strict'
import {
  ORGANIC_JOB_NAMES,
  ORGANIC_SOURCE,
  firstInboundText,
  matchOrganicJob,
  organicRelevance,
  summarizeOrganicLeads,
  tagNewOrganicLead,
  withJobNameLine,
} from '../src/utils/organicJobs.ts'

assert.equal(matchOrganicJob('שירות לקוחות באר שבע'), 10)
assert.equal(matchOrganicJob('שירות לקוחות בבאר שבע'), 10)
assert.equal(matchOrganicJob('  שירות   לקוחות, בבאר-שבע '), 10)
assert.equal(matchOrganicJob('היי\nמשרה: שירות לקוחות באר שבע'), 10)
assert.equal(matchOrganicJob('שירות לקוחות ברמת החייל'), 2)
assert.equal(matchOrganicJob('שירות לקוחות רמת החייל'), 2)
assert.equal(matchOrganicJob('שימור לקוחות בפתח תקווה'), 9)
assert.equal(matchOrganicJob('שימור לקוחות פתח תקווה'), 9)
assert.equal(matchOrganicJob('שלום, אשמח לפרטים'), null)
assert.equal(matchOrganicJob('שירות לקוחות'), null)
assert.equal(matchOrganicJob('באר שבע שירות לקוחות'), null)

const prefill = withJobNameLine(10, 'היי\nשם:')
assert.equal(prefill, 'משרה: שירות לקוחות באר שבע\nהיי\nשם:')
assert.equal(matchOrganicJob(prefill), 10)
assert.equal(withJobNameLine(4, 'היי'), 'היי')
assert.equal(ORGANIC_JOB_NAMES[2], 'שירות לקוחות רמת החייל')
assert.equal(ORGANIC_JOB_NAMES[9], 'שימור לקוחות פתח תקווה')

const messages = [
  { direction: 'out', text: 'שירות לקוחות באר שבע', timestamp: '2026-11-01T00:00:00.000Z' },
  { direction: 'in', text: 'שירות לקוחות בבאר שבע', timestamp: '2026-11-19T10:00:00.000Z' },
  { direction: 'in', text: 'שירות לקוחות רמת החייל', timestamp: '2026-11-19T11:00:00.000Z' },
]
assert.equal(firstInboundText(messages), 'שירות לקוחות בבאר שבע')
assert.deepEqual(
  tagNewOrganicLead({ source: 'WhatsApp', name: 'דנה' }, messages),
  { source: ORGANIC_SOURCE, name: 'דנה', organicJob: 10 },
)
assert.deepEqual(
  tagNewOrganicLead({ source: '', name: 'דנה' }, messages),
  { source: ORGANIC_SOURCE, name: 'דנה', organicJob: 10 },
)
assert.deepEqual(
  tagNewOrganicLead({ source: 'Facebook Lead Ads', name: 'דנה' }, messages),
  { source: 'Facebook Lead Ads', name: 'דנה' },
)
assert.deepEqual(
  tagNewOrganicLead({ source: 'WhatsApp' }, [{ direction: 'in', text: 'סתם היי', timestamp: '2026-11-19T10:00:00.000Z' }]),
  { source: 'WhatsApp' },
)

assert.equal(organicRelevance('sent_to_client'), 'relevant')
assert.equal(organicRelevance('placement_complete'), 'relevant')
assert.equal(organicRelevance('future_relevant'), 'relevant')
assert.equal(organicRelevance('irrelevant'), 'not_relevant')
assert.equal(organicRelevance('new'), 'pending')
assert.equal(organicRelevance('screening'), 'pending')
assert.equal(organicRelevance('called'), 'pending')

const now = new Date('2026-11-19T12:00:00.000Z')
const rows = summarizeOrganicLeads([
  { source: ORGANIC_SOURCE, status: 'sent_to_client', organicJob: 10, createdAt: '2026-11-19T08:00:00.000Z' },
  { source: ORGANIC_SOURCE, status: 'irrelevant', organicJob: 10, createdAt: '2026-11-19T09:00:00.000Z' },
  { source: ORGANIC_SOURCE, status: 'new', organicJob: 2, createdAt: '2026-11-18T09:00:00.000Z' },
  { source: 'WhatsApp', status: 'sent_to_client', organicJob: 10, createdAt: '2026-11-19T09:00:00.000Z' },
  { source: ORGANIC_SOURCE, status: 'relevant', organicJob: 9, createdAt: '2026-10-01T09:00:00.000Z' },
], now)
assert.equal(rows.length, 2)
assert.deepEqual(rows[0], { day: '2026-11-19', jobId: 10, leads: 2, relevant: 1, notRelevant: 1, pending: 0 })
assert.deepEqual(rows[1], { day: '2026-11-18', jobId: 2, leads: 1, relevant: 0, notRelevant: 0, pending: 1 })

console.log('organic jobs selfcheck ok')
