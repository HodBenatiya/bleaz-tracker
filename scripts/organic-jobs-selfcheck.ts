import assert from 'node:assert/strict'
import {
  ORGANIC_JOB_NAMES,
  ORGANIC_SOURCE,
  firstInboundText,
  matchOrganicJob,
  matchingOrganicJobs,
  humanClicksByJob,
  organicInProcess,
  organicPresetRange,
  organicRelevance,
  summarizeGoClicks,
  summarizeOrganicLeads,
  summarizeOrganicWindow,
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
assert.equal(matchOrganicJob('שירות לקוחות באר'), null)
assert.equal(matchOrganicJob('באר שבע שירות לקוחות'), 10)

const SHORT: Record<number, string> = {
  1: 'היי, אשמח לקבל פרטים על משרת קשרי לקוחות בבית השקעות',
  2: 'היי, אשמח לקבל פרטים על משרת שירות לקוחות ברמת החייל',
  3: 'היי, אשמח לקבל פרטים על משרת שירות במוקד מעסיקים בפתח תקווה',
  4: 'היי, אשמח לקבל פרטים על משרת מכירות במוקד פיננסי בגבעת שאול',
  5: 'היי, אשמח לקבל פרטים על משרת תומך/ת מסחר בשוק ההון',
  6: 'היי, אשמח לקבל פרטים על משרת הנהלת חשבונות מהבית',
  7: 'היי, אשמח לקבל פרטים על משרת יועץ/ת השקעות ג\u05F3וניור בתל אביב',
  8: 'היי, אשמח לקבל פרטים על משרת מכירות ברמת גן',
  9: 'היי, אשמח לקבל פרטים על משרת שימור לקוחות בפתח תקווה',
  10: 'היי, אשמח לקבל פרטים על משרת שירות לקוחות בבאר שבע',
}
for (const [id, sentence] of Object.entries(SHORT)) {
  const jobId = Number(id)
  assert.deepEqual(matchingOrganicJobs(sentence), [jobId], sentence)
  assert.equal(matchOrganicJob(sentence), jobId)
}

const OLD: Record<number, string> = {
  1: 'היי, ראיתי בפייסבוק את משרת קשרי הלקוחות בבית ההשקעות ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nידע/ניסיון בשוק ההון:',
  2: 'היי, ראיתי בפייסבוק את משרת שירות הלקוחות בחברת הביטוח ברמת החייל ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון בשירות לקוחות:',
  3: 'היי, ראיתי בפייסבוק את משרת השירות במוקד המעסיקים בפתח תקווה ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון בשירות לקוחות:',
  4: 'היי, ראיתי בפייסבוק את משרת המכירות במוקד הפיננסי בגבעת שאול ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון במכירות טלפוניות (כמה זמן ואיפה):',
  5: 'היי, ראיתי בפייסבוק את משרת תומך/ת המסחר בשוק ההון ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון בשירות לקוחות / ידע בשוק ההון:',
  6: 'היי, ראיתי בפייסבוק את משרת מנהל/ת החשבונות מהבית ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nשנות ניסיון במשרד רו״ח (עד מאזן?):',
  7: 'היי, ראיתי בפייסבוק את משרת יועץ/ת ההשקעות ג\u05F3וניור בבנק בתל אביב ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nרישיון ייעוץ השקעות + התמחות (מתי הושלמה):',
  8: 'היי, ראיתי בפייסבוק את משרת המכירות במכללה ברמת גן ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון במכירות (אם יש):',
  9: 'היי, ראיתי בפייסבוק את משרת שימור הלקוחות בפתח תקווה ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון במכירות או שירות (אם יש):',
  10: 'היי, ראיתי בפייסבוק את משרת השירות במוקד המעסיקים בבאר שבע ואשמח לפרטים נוספים ולהגיש מועמדות.\nשם:\nניסיון בשירות לקוחות:',
}
for (const [id, sentence] of Object.entries(OLD)) {
  const jobId = Number(id)
  assert.deepEqual(matchingOrganicJobs(sentence), [jobId], `old ${id}`)
  assert.equal(matchOrganicJob(sentence), jobId)
}
for (const jobId of [2, 9, 10]) {
  const labeled = withJobNameLine(jobId, OLD[jobId])
  assert.equal(labeled.startsWith(`משרה: ${ORGANIC_JOB_NAMES[jobId]}\n`), true)
  assert.deepEqual(matchingOrganicJobs(labeled), [jobId])
}

const prefill = withJobNameLine(10, 'היי\nשם:')
assert.equal(prefill, 'משרה: שירות לקוחות באר שבע\nהיי\nשם:')
assert.equal(matchOrganicJob(prefill), 10)
assert.equal(ORGANIC_JOB_NAMES[1], 'קשרי לקוחות בית השקעות')
assert.equal(ORGANIC_JOB_NAMES[2], 'שירות לקוחות רמת החייל')
assert.equal(ORGANIC_JOB_NAMES[3], 'שירות מוקד מעסיקים פתח תקווה')
assert.equal(ORGANIC_JOB_NAMES[4], 'מכירות מוקד פיננסי גבעת שאול')
assert.equal(ORGANIC_JOB_NAMES[5], 'תומך מסחר שוק ההון')
assert.equal(ORGANIC_JOB_NAMES[6], 'הנהלת חשבונות מהבית')
assert.equal(ORGANIC_JOB_NAMES[7], 'יועץ השקעות ג׳וניור תל אביב')
assert.equal(ORGANIC_JOB_NAMES[8], 'מכירות רמת גן')
assert.equal(ORGANIC_JOB_NAMES[9], 'שימור לקוחות פתח תקווה')
assert.equal(ORGANIC_JOB_NAMES[10], 'שירות לקוחות באר שבע')

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

assert.equal(organicInProcess('new'), true)
assert.equal(organicInProcess('call_scheduled'), true)
assert.equal(organicInProcess('relevant'), false)
assert.deepEqual(organicPresetRange('today', now), { start: '2026-11-19', end: '2026-11-19', label: 'היום' })
assert.equal(organicPresetRange('week', now).start, '2026-11-13')
assert.equal(organicPresetRange('month', now).start, '2026-11-01')

const windowSummary = summarizeOrganicWindow([
  { id: 'a', name: 'דנה', source: ORGANIC_SOURCE, status: 'future_relevant', organicJob: 10, createdAt: '2026-11-19T08:00:00.000Z' },
  { id: 'b', name: 'יוסי', source: ORGANIC_SOURCE, status: 'irrelevant', organicJob: 10, createdAt: '2026-11-18T08:00:00.000Z' },
  { id: 'c', name: 'מיכל', source: ORGANIC_SOURCE, status: 'call_scheduled', organicJob: 2, createdAt: '2026-11-19T08:00:00.000Z' },
  { id: 'd', name: 'ישן', source: ORGANIC_SOURCE, status: 'new', organicJob: 2, createdAt: '2026-10-01T08:00:00.000Z' },
  { id: 'e', name: 'אחר', source: 'WhatsApp', status: 'new', organicJob: 10, createdAt: '2026-11-19T08:00:00.000Z' },
], '2026-11-13', '2026-11-19')
assert.equal(windowSummary.leads, 3)
assert.equal(windowSummary.relevant, 1)
assert.equal(windowSummary.notRelevant, 1)
assert.equal(windowSummary.inProcess, 1)
assert.equal(windowSummary.jobs[0].jobId, 10)
assert.deepEqual(windowSummary.jobs.find(job => job.jobId === 2)?.people.map(person => person.name), ['מיכל'])

const clicks = summarizeGoClicks([
  { job_id: 10, created_at: '2026-11-19T08:00:00.000Z', is_bot: false },
  { job_id: 10, created_at: '2026-11-19T09:00:00.000Z', is_bot: true },
  { job_id: 2, created_at: '2026-11-01T09:00:00.000Z', is_bot: false },
], now, { start: '2026-11-01', end: '2026-11-19' })
assert.equal(clicks.reduce((sum, row) => sum + row.clicks, 0), 2)
assert.deepEqual(humanClicksByJob([
  { job_id: 10, created_at: '2026-11-19T08:00:00.000Z', is_bot: false },
  { job_id: 10, created_at: '2026-11-19T09:00:00.000Z', is_bot: true },
], '2026-11-19', '2026-11-19'), { 10: 1 })

console.log('organic jobs selfcheck ok')
