import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import handler from '../api/apply.ts'
import handleGoRedirect, {
  GO_JOB_TEXTS,
  PLAIN_WA_URL,
  WA_PHONE,
  isGoRedirect,
  parseJobId,
  queryParam,
  recordGoClick,
  sanitizeGroupId,
  shouldRecordGoClick,
  whatsappLocation,
} from '../api/_goRedirect.ts'
import { matchOrganicJob, sanitizeVariant } from '../src/utils/organicJobs.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const EXPECTED: Record<string, string> = {
  '1': 'היי, אשמח לקבל פרטים על משרת קשרי לקוחות בבית השקעות',
  '2': 'היי, אשמח לקבל פרטים על משרת שירות לקוחות ברמת החייל',
  '3': 'היי, אשמח לקבל פרטים על משרת שירות במוקד מעסיקים בפתח תקווה',
  '4': 'היי, אשמח לקבל פרטים על משרת מכירות במוקד פיננסי בגבעת שאול',
  '5': 'היי, אשמח לקבל פרטים על משרת תומך/ת מסחר בשוק ההון',
  '6': 'היי, אשמח לקבל פרטים על משרת הנהלת חשבונות מהבית',
  '7': 'היי, אשמח לקבל פרטים על משרת יועץ/ת השקעות ג\u05F3וניור בתל אביב',
  '8': 'היי, אשמח לקבל פרטים על משרת מכירות ברמת גן',
  '9': 'היי, אשמח לקבל פרטים על משרת שימור לקוחות בפתח תקווה',
  '10': 'היי, אשמח לקבל פרטים על משרת שירות לקוחות בבאר שבע',
}

assert.equal(WA_PHONE, '972559817733')
assert.equal(PLAIN_WA_URL, 'https://wa.me/972559817733')

for (const key of Object.keys(EXPECTED)) {
  const jobId = Number(key)
  const text = EXPECTED[key]
  assert.equal(GO_JOB_TEXTS[jobId], text)
  assert.equal(text.includes('\n'), false)
  assert.equal(text.includes('משרה:'), false)
  const location = whatsappLocation(jobId)
  assert.equal(location, `${PLAIN_WA_URL}?text=${encodeURIComponent(text)}`)
  assert.equal(decodeURIComponent(location.slice(location.indexOf('?text=') + 6)), text)
  assert.equal(location.includes('\n'), false)
  assert.equal(location.includes('%0A'), false)
  assert.equal(location.startsWith('https://wa.me/972559817733?text='), true)
  assert.equal(matchOrganicJob(text), jobId)
}

assert.equal(GO_JOB_TEXTS[7].includes('\u05F3'), true)
assert.equal(whatsappLocation(7).includes('+'), false)

for (const raw of [null, '', '0', '01', '11', '99', 'abc', '1.5', '1 ', ' 1', '10abc']) {
  assert.equal(parseJobId(raw), null)
  assert.equal(whatsappLocation(parseJobId(raw)), PLAIN_WA_URL)
}
for (let jobId = 1; jobId <= 10; jobId += 1) {
  assert.equal(parseJobId(String(jobId)), jobId)
}

assert.equal(sanitizeVariant('A'), 'A')
assert.equal(sanitizeVariant('D'), 'D')
for (const raw of [null, '', 'a', 'E', 'AB', '1', ' A']) assert.equal(sanitizeVariant(raw), null)

assert.equal(sanitizeGroupId('test123'), 'test123')
assert.equal(sanitizeGroupId('A_b-9'), 'A_b-9')
assert.equal(sanitizeGroupId('a'.repeat(64)), 'a'.repeat(64))
for (const raw of [null, '', 'a'.repeat(65), 'bad group', 'a/b', 'עברית', 'g.1', 'a b', ' ']) {
  assert.equal(sanitizeGroupId(raw), null)
}

assert.equal(shouldRecordGoClick('GET', 4), true)
assert.equal(shouldRecordGoClick('HEAD', 4), false)
assert.equal(shouldRecordGoClick('GET', null), false)
assert.equal(shouldRecordGoClick('POST', 4), false)

assert.equal(isGoRedirect({ method: 'GET', query: { go: '4' } }), true)
assert.equal(isGoRedirect({ method: 'HEAD', query: { go: '99' } }), true)
assert.equal(isGoRedirect({ method: 'GET', query: { go: '' } }), true)
assert.equal(isGoRedirect({ method: 'GET', query: {} }), false)
assert.equal(isGoRedirect({ method: 'POST', query: { go: '1' } }), false)
assert.equal(isGoRedirect({ method: 'HEAD' }), false)
assert.equal(isGoRedirect({ method: 'GET', url: '/api/apply?go=4&g=test123' }), true)
assert.equal(queryParam({ url: '/api/apply?go=4&g=test123' }, 'g'), 'test123')
assert.equal(queryParam({ query: { go: ['10', '2'], g: 'test123' } }, 'go'), '10')

function mockRes() {
  const headers: Record<string, string> = {}
  let body = ''
  const res = {
    statusCode: 0,
    headers,
    body: '',
    setHeader(name: string, value: string) { headers[name] = value },
    status(code: number) { res.statusCode = code; return res },
    end(chunk?: string) { if (chunk) body += chunk; res.body = body; return res },
    send(chunk: string) { body = chunk; res.body = body; if (!res.statusCode) res.statusCode = 200; return res },
    json(payload: unknown) { body = JSON.stringify(payload); res.body = body; return res },
  }
  return res
}

const recorded: Array<{ jobId: number; groupId: string | null; variant: string | null }> = []
async function fakeRecord(jobId: number, groupId: string | null, variant: string | null) {
  recorded.push({ jobId, groupId, variant })
}

{
  recorded.length = 0
  const order: string[] = []
  const res = mockRes()
  const finish = res.end
  res.end = () => { order.push('end'); return finish() }
  await handleGoRedirect({ method: 'GET', query: { go: '4', g: 'test123', v: 'B' } }, res, async (jobId, groupId, variant) => {
    order.push('record')
    await fakeRecord(jobId, groupId, variant)
  })
  assert.deepEqual(order, ['record', 'end'])
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers['Cache-Control'], 'no-store')
  assert.equal(res.headers.Location, whatsappLocation(4))
  assert.deepEqual(recorded, [{ jobId: 4, groupId: 'test123', variant: 'B' }])
}

{
  const order: string[] = []
  const res = mockRes()
  const finish = res.end
  res.end = () => { order.push('end'); return finish() }
  await handleGoRedirect({ method: 'HEAD', query: { go: '9', v: 'A', g: 'devtest_fix' } }, res, async () => {
    order.push('record')
  })
  assert.deepEqual(order, ['end'])
  assert.equal(res.statusCode, 302)
}

{
  recorded.length = 0
  const res = mockRes()
  await handleGoRedirect({ method: 'HEAD', query: { go: '4', g: 'test123' } }, res, fakeRecord)
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.Location, whatsappLocation(4))
  assert.equal(res.headers['Cache-Control'], 'no-store')
  assert.deepEqual(recorded, [])
}

{
  recorded.length = 0
  const res = mockRes()
  await handleGoRedirect({ method: 'GET', query: { go: '99', g: 'nope!' }, url: '/api/apply?go=99&g=nope!' }, res, fakeRecord)
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.Location, PLAIN_WA_URL)
  assert.deepEqual(recorded, [])
}

{
  recorded.length = 0
  const res = mockRes()
  await handleGoRedirect({ method: 'GET', query: { go: '1', g: 'bad group' } }, res, fakeRecord)
  assert.equal(res.headers.Location, whatsappLocation(1))
  assert.deepEqual(recorded, [{ jobId: 1, groupId: null, variant: null }])
}

{
  const res = mockRes()
  await handler({ method: 'GET', query: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.includes('POST /api/apply'), true)
}

{
  const res = mockRes()
  await handler({ method: 'HEAD', query: { go: '2', g: 'team_a' } }, res)
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers['Cache-Control'], 'no-store')
  assert.equal(res.headers.Location, whatsappLocation(2))
}

{
  const res = mockRes()
  await handler({ method: 'HEAD', query: { go: 'abc' } }, res)
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.Location, PLAIN_WA_URL)
}

{
  const res = mockRes()
  await handler({ method: 'HEAD', query: {} }, res)
  assert.equal(res.statusCode, 405)
}

{
  const res = mockRes()
  await handler({ method: 'POST', query: { go: '1' }, body: { name: '', phone: '' } }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.includes('name and phone are required'), true)
}

{
  const res = mockRes()
  await handler({
    method: 'POST',
    query: { go: '1' },
    body: { event_type: 'click', has_fbclid: false },
  }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body, '')
}

{
  const res = mockRes()
  await handler({ method: 'GET', url: '/go/8?g=test123' }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.includes('POST /api/apply'), true)
}

for (const rel of ['api/_goRedirect.ts', 'api/apply.ts', 'vercel.json', 'schema_go_clicks.sql', 'schema_go_clicks_variant.sql', 'schema_organic_leads.sql', 'src/utils/organicJobs.ts']) {
  const source = readFileSync(join(root, rel), 'utf8')
  const runs = source.match(/\d{7,}/g) ?? []
  assert.deepEqual(runs.filter((run) => run !== '972559817733'), [], rel)
  assert.equal(source.includes('050-'), false, rel)
  assert.equal(source.includes('050 '), false, rel)
}

function countFunctions(dir: string): number {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) count += countFunctions(path)
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) count += 1
  }
  return count
}
assert.equal(countFunctions(join(root, 'api')), 12)

const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
  rewrites: Array<{ source: string; destination: string }>
  functions: Record<string, unknown>
}
const sources = vercel.rewrites.map((rule) => rule.source)
const goAt = sources.indexOf('/go/:jobId')
const spaAt = sources.findIndex((source) => source.includes('?!'))
assert.ok(goAt >= 0 && spaAt >= 0 && goAt < spaAt)
assert.equal(vercel.rewrites[goAt].destination, '/api/apply?go=:jobId')
assert.equal(sources.includes('/jobs'), true)
assert.equal(sources.includes('/jobs/'), true)
assert.equal(Object.keys(vercel.functions).length, 12)
assert.equal(Object.keys(vercel.functions).some((name) => name.includes('_goRedirect')), false)

const applySource = readFileSync(join(root, 'api/apply.ts'), 'utf8')
assert.ok(applySource.indexOf('isGoRedirect') < applySource.indexOf('isLandingBeacon'))

if (!process.env.VITE_SUPABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const errors: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')) }
  try {
    const res = mockRes()
    await handleGoRedirect({ method: 'HEAD', query: { go: '5', g: 'ok' } }, res)
    assert.equal(res.headers.Location, whatsappLocation(5))
    assert.deepEqual(errors, [])
    const counted = mockRes()
    await handler({ method: 'GET', query: { go: '3', g: 'team_a' } }, counted)
    assert.equal(counted.statusCode, 302)
    assert.equal(counted.headers.Location, whatsappLocation(3))
    assert.equal(errors.length, 1)
    await recordGoClick(5, 'ok', 'A')
    assert.equal(errors.length, 2)
    assert.equal(errors.every((line) => line.includes('missing supabase service role')), true)
    const invalid = mockRes()
    await handleGoRedirect({ method: 'GET', query: { go: 'abc' } }, invalid)
    assert.equal(invalid.headers.Location, PLAIN_WA_URL)
    assert.equal(errors.length, 2)
  } finally {
    console.error = original
  }
}

console.log('go redirect selfcheck ok')
