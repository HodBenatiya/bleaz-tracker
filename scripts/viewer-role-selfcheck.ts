import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  VIEWER_EMAIL,
  VIEWER_HIDDEN_VIEWS,
  VIEWER_PAGE_SIZE,
  blockViewerExtract,
  clampViewerLimit,
  isStaffAllowed,
  redactJson,
  resolveAppRole,
  viewAllowed,
} from '../src/utils/accessRole.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migration = readFileSync(join(root, 'schema_viewer_role.sql'), 'utf8')
const rollback = readFileSync(join(root, 'schema_viewer_role_rollback.sql'), 'utf8')
const reader = readFileSync(join(root, 'src/utils/viewerRead.ts'), 'utf8')

assert.equal(resolveAppRole({ email: 'Natalie@Nona-Jobs.com', role: null }), 'viewer')
assert.equal(resolveAppRole({ email: VIEWER_EMAIL, role: undefined }), 'viewer')
assert.equal(resolveAppRole({ email: VIEWER_EMAIL, role: 'admin' }), 'admin')
assert.equal(resolveAppRole({ email: 'hod@example.com', role: null }), 'admin')
assert.equal(resolveAppRole({ email: 'hod@example.com', role: undefined }), 'admin')
assert.equal(resolveAppRole({ email: 'tzachi@example.com', role: 'viewer' }), 'viewer')
assert.equal(resolveAppRole({ email: '', role: null }), 'admin')

assert.equal(isStaffAllowed(VIEWER_EMAIL, null), false)
assert.equal(isStaffAllowed(VIEWER_EMAIL, undefined), false)
assert.equal(isStaffAllowed(VIEWER_EMAIL, 'admin'), true)
assert.equal(isStaffAllowed('hod@example.com', null), true)
assert.equal(isStaffAllowed('hod@example.com', 'viewer'), false)

assert.equal(clampViewerLimit(undefined), 50)
assert.equal(clampViewerLimit(0), 1)
assert.equal(clampViewerLimit(-4), 1)
assert.equal(clampViewerLimit(50), 50)
assert.equal(clampViewerLimit(1000), VIEWER_PAGE_SIZE)
assert.equal(VIEWER_PAGE_SIZE, 50)

assert.equal(viewAllowed('admin', 'whatsapp'), true)
assert.equal(viewAllowed('admin', 'form'), true)
assert.equal(viewAllowed('viewer', 'whatsapp'), false)
assert.equal(viewAllowed('viewer', 'meta'), false)
assert.equal(viewAllowed('viewer', 'form'), false)
for (const view of ['management', 'dashboard', 'board', 'candidates', 'data', 'positions', 'marketing', 'pipeline', 'tasks', 'history']) {
  assert.equal(viewAllowed('viewer', view), true, view)
}
assert.deepEqual([...VIEWER_HIDDEN_VIEWS], ['form', 'whatsapp', 'meta'])

assert.equal(blockViewerExtract('viewer', 'copy'), true)
assert.equal(blockViewerExtract('viewer', 'cut'), true)
assert.equal(blockViewerExtract('viewer', 'print'), true)
assert.equal(blockViewerExtract('viewer', 'contextmenu'), true)
assert.equal(blockViewerExtract('viewer', 'drag'), true)
assert.equal(blockViewerExtract('admin', 'copy'), false)

const redacted = redactJson({
  companyName: 'BINGO',
  positionTitle: 'האקריו',
  positionUrl: 'https://jobs.example/bingo',
  clientToken: 'secret-token',
  phone: '0501234567',
  notes: 'שיחת סינון',
  cvUrl: 'cvs:abc/file.pdf',
  cvFileName: 'קורות.pdf',
  waMessages: [{ text: 'שלום', fileUrl: '/api/wa-media?id=1', filePath: 'wa-media:whatsapp/a/cv.pdf' }],
  nested: { downloadUrl: 'https://x/storage/v1/object/sign/cvs/a.pdf', keep: 'כן' },
})
assert.equal(redacted.companyName, 'BINGO')
assert.equal(redacted.positionTitle, 'האקריו')
assert.equal(redacted.positionUrl, 'https://jobs.example/bingo')
assert.equal(redacted.phone, '0501234567')
assert.equal(redacted.notes, 'שיחת סינון')
assert.equal(redacted.cvFileName, 'קורות.pdf')
assert.equal('clientToken' in redacted, false)
assert.equal('cvUrl' in redacted, false)
assert.equal('fileUrl' in redacted.waMessages[0], false)
assert.equal('filePath' in redacted.waMessages[0], false)
assert.equal(redacted.waMessages[0].text, 'שלום')
assert.equal('downloadUrl' in redacted.nested, false)
assert.equal(redacted.nested.keep, 'כן')

const allowedMatch = migration.match(/v_allowed text\[\] := array\[([\s\S]*?)\]/)
assert.ok(allowedMatch, 'viewer allowlist missing')
const sqlTables = [...allowedMatch[1].matchAll(/'([a-z0-9_]+)'/g)].map(match => match[1])
const tsMatch = reader.match(/export const VIEWER_TABLES = \[([\s\S]*?)\] as const/)
assert.ok(tsMatch, 'VIEWER_TABLES missing')
const tsTables = [...tsMatch[1].matchAll(/'([a-z0-9_]+)'/g)].map(match => match[1])
assert.deepEqual(sqlTables, tsTables)
for (const denied of ['wa_inbox', 'meta_sync_log', 'meta_sync_state', 'meta_status_history', 'user_roles', 'viewer_access_log']) {
  assert.equal(sqlTables.includes(denied), false, denied)
}
for (const required of ['reports', 'positions', 'candidates', 'meta_campaign_daily', 'meta_ad_accounts']) {
  assert.equal(sqlTables.includes(required), true, required)
}

assert.match(migration, /natalie@nona-jobs\.com/)
assert.match(migration, /least\(greatest\(coalesce\(p_limit, 50\), 1\), 50\)/)
assert.match(migration, /viewer_access_log/)
assert.match(migration, /viewer_read_page is limited to the viewer role/)
assert.match(migration, /public\.is_admin\(\)/)
assert.match(migration, /bucket_id = 'cvs' and public\.is_admin\(\)/)
assert.match(migration, /bucket_id = 'wa-media' and public\.is_admin\(\)/)
const sqlOnly = migration
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n')
assert.doesNotMatch(sqlOnly, /drop table/i)
assert.doesNotMatch(sqlOnly, /truncate/i)
assert.doesNotMatch(sqlOnly, /delete from public\.(reports|candidates|positions|tasks|pipeline_companies|wa_inbox)/i)
assert.doesNotMatch(sqlOnly, /revoke all on table public\.(reports|candidates|positions|wa_inbox)/i)

const selectLines = migration.split('\n').filter(line => /^\s*select\b/i.test(line))
for (const line of selectLines) {
  assert.equal(line.includes('token_env'), false, line)
}

assert.match(rollback, /drop table if exists public\.viewer_access_log/)
assert.match(rollback, /drop table if exists public\.user_roles/)
assert.match(rollback, /using \(true\)/)
const rollbackSql = rollback.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
assert.doesNotMatch(rollbackSql, /drop table if exists public\.(reports|candidates|positions|tasks|wa_inbox)/i)
assert.doesNotMatch(rollbackSql, /delete from/i)

console.log('viewer role selfcheck ok')
