import assert from 'node:assert/strict'
import { normalizeHebrew, rankCandidates, type MatchCandidateInput, type MatchJobInput } from '../src/utils/matchCandidates'

assert.equal(normalizeHebrew('הנה"ח  מוקדן'), 'הנהח מוקדנ')
assert.equal(normalizeHebrew('שֵׁירוּת'), 'שירות')

const job: MatchJobInput = {
  id: 'job-1',
  companyName: 'שירות ישיר',
  positionTitle: 'נציג מוקד',
  city: 'תל אביב',
  description: 'משרה מלאה במוקד שירות לקוחות, נדרש ניסיון, משמרות בוקר',
}

const people: MatchCandidateInput[] = [
  {
    id: 'future',
    name: 'מאיה לוי',
    phone: '0521112233',
    city: 'רמת גן',
    status: 'future_relevant',
    positionType: 'מוקד',
    notes: 'עבדתי שנתיים כנציגת שירות במוקד. זמינה למשרה מלאה ומשמרת בוקר.',
  },
  {
    id: 'sales-south',
    name: 'יוסי',
    phone: '0500000001',
    city: 'באר שבע',
    status: 'relevant',
    positionType: 'מכירות',
    notes: 'ניסיון במכירות שטח בדרום, משרה מלאה.',
  },
  {
    id: 'placed',
    name: 'כבר הושם',
    phone: '0500000002',
    city: 'תל אביב',
    status: 'placement_complete',
    notes: 'מוקד שירות לקוחות משרה מלאה',
  },
  {
    id: 'blocked',
    name: 'לא רלוונטי',
    phone: '0500000003',
    city: 'חולון',
    status: 'irrelevant',
    notes: 'מוקדן מנוסה',
  },
  {
    id: 'books',
    name: 'דנה',
    phone: '0500000004',
    city: 'חיפה',
    status: 'new',
    notes: 'הנה"ח וחשבת שכר, משרה מלאה',
  },
  {
    id: 'part',
    name: 'נועה',
    phone: '0500000005',
    city: 'תל אביב',
    status: 'relevant',
    notes: 'מוקד שירות, רק משרה חלקית',
  },
]

const ranked = rankCandidates(job, people, 20)
const ids = ranked.map(hit => hit.id)
assert.ok(!ids.includes('placed'), 'placed candidate excluded')
assert.ok(!ids.includes('blocked'), 'irrelevant candidate excluded')
assert.ok(!ids.includes('books'), 'bookkeeping candidate is not a call-center match')
assert.equal(ids[0], 'future')
assert.ok(ids.includes('part'))
assert.ok(ids.indexOf('future') < ids.indexOf('part'))
const future = ranked[0]
assert.ok(future.reasons.some(reason => reason.includes('מוקד') || reason.includes('שירות')))
assert.ok(future.reasons.some(reason => reason.includes('גוש דן') || reason.includes('רמת גן')))
assert.ok(future.snippet.includes('מוקד') || future.highlights.some(term => term.includes('מוקד') || term.includes('שירות')))
assert.ok(future.score > ranked.find(hit => hit.id === 'part')!.score)

const books = rankCandidates({
  id: 'job-2',
  positionTitle: 'הנהלת חשבונות',
  city: 'חיפה',
  description: 'משרה מלאה, ניסיון בחשב שכר',
}, people, 5)
assert.equal(books[0]?.id, 'books')
assert.ok(books[0].highlights.join(' ').includes('הנה') || books[0].snippet.includes('הנה'))

const empty = rankCandidates({ id: 'job-3', positionTitle: 'מהנדס חלל', city: 'אילת', description: '' }, people, 5)
assert.equal(empty.length, 0)

console.log('match selfcheck ok')
