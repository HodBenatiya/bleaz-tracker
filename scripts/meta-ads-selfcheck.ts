import assert from 'node:assert/strict'
import { adFromReferral } from '../src/utils/metaAds/adLink'
import { creativeFatigue, insightLeads, parseAdMetric, placementLabel } from '../src/utils/metaAds/adMetrics'
import { referralFromRecord } from '../src/utils/metaAds/adReferral'
import { backoffMs, rateLimitCode } from '../src/utils/metaAds/rateLimit'
import { campaignFunnel } from '../src/utils/metaAds/campaignFunnel'
import { inferCampaign } from '../src/utils/metaAds/inferCampaign'
import { campaignIsLive, updatedAgo, visibleCampaigns } from '../src/utils/metaAds/live'
import { attributeLead } from '../src/utils/metaAds/attributeLead'
import { exampleBundle } from '../src/utils/metaAds/example'
import { suggestCampaignPositions } from '../src/utils/metaAds/matchCampaign'
import { campaignsFromMaps, computeAdsMetrics, metricLeads } from '../src/utils/metaAds/metrics'
import { formatMoney } from '../src/utils/metaAds/money'
import { isDropoutStatus, isInterviewStatus, isRelevantStatus } from '../src/utils/metaAds/stages'
import {
  accountDatesForSpans,
  assertMetaRead,
  bucketToIsraelDays,
  mergeAccountConfigs,
  normalizeAccountId,
  parseInsightRow,
  pickResult,
  planFetchSpans,
  safeEqual,
  stripSecrets,
} from '../src/utils/metaAds/syncCore'
import { israelDateForAccountHour, parseHourLabel } from '../src/utils/metaAds/zone'

assert.equal(isRelevantStatus('relevant'), true)
assert.equal(isRelevantStatus('future_relevant'), false)
assert.equal(isRelevantStatus('called'), false)
assert.equal(isInterviewStatus('called'), false)
assert.equal(isInterviewStatus('interview_scheduled'), true)
assert.equal(isInterviewStatus('placement_complete'), true)
assert.equal(isDropoutStatus('irrelevant'), true)
assert.equal(isDropoutStatus('screening'), false)

assert.equal(parseHourLabel('14:00:00 - 14:59:59'), 14)
assert.equal(parseHourLabel('0'), 0)
assert.equal(parseHourLabel(''), null)
assert.equal(israelDateForAccountHour('2026-11-10', 13, 'America/Los_Angeles'), '2026-11-10')
assert.equal(israelDateForAccountHour('2026-11-10', 14, 'America/Los_Angeles'), '2026-11-11')
assert.equal(israelDateForAccountHour('2026-11-10', 10, 'Asia/Jerusalem'), '2026-11-10')

const bucket = bucketToIsraelDays([
  { campaignId: '1', campaignName: 'א', currency: 'USD', accountDate: '2026-11-10', hour: 13, spend: 10, impressions: 1, clicks: 1, results: 2, resultAction: 'lead' },
  { campaignId: '1', campaignName: 'א', currency: 'USD', accountDate: '2026-11-10', hour: 14, spend: 5, impressions: 1, clicks: 0, results: 1, resultAction: 'lead' },
], 'America/Los_Angeles')
assert.equal(bucket.length, 2)
assert.equal(bucket.find(row => row.date === '2026-11-10')?.spend, 10)
assert.equal(bucket.find(row => row.date === '2026-11-11')?.spend, 5)

const parsed = parseInsightRow({
  campaign_id: '9',
  campaign_name: 'בדיקה',
  spend: '1.5',
  date_start: '2026-11-10',
  account_currency: 'USD',
  hourly_stats_aggregated_by_advertiser_time_zone: '08:00:00 - 08:59:59',
  actions: [
    { action_type: 'lead', value: '4' },
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '2' },
  ],
}, 'ILS')
assert.equal(parsed?.results, 2)
assert.equal(parsed?.resultAction, 'onsite_conversion.messaging_conversation_started_7d')
assert.equal(parsed?.currency, 'USD')
assert.deepEqual(pickResult([{ action_type: 'lead', value: '3' }]), { action: 'lead', value: 3 })

const firstPlan = planFetchSpans('2026-11-10', 3, null)
assert.deepEqual(firstPlan.spans[0], { start: '2026-11-08', end: '2026-11-10' })
assert.equal(firstPlan.nextOldest, '2026-11-01')
const dates = accountDatesForSpans([{ start: '2026-11-10', end: '2026-11-10' }])
assert.deepEqual(dates, ['2026-11-09', '2026-11-10', '2026-11-11'])

assert.throws(() => assertMetaRead('https://graph.facebook.com/v19.0/act_1/insights', 'POST'), /read-only/)
assert.throws(() => assertMetaRead('https://graph.facebook.com/v19.0/act_1/campaigns', 'POST'), /read-only/)
assert.throws(() => assertMetaRead('https://example.com/v19.0/act_1/insights', 'GET'), /not allowed/)
assert.doesNotThrow(() => assertMetaRead('https://graph.facebook.com/v19.0/act_100/insights?access_token=secret', 'GET'))
assert.doesNotThrow(() => assertMetaRead('https://graph.facebook.com/v19.0/act_100/campaigns?limit=10', 'GET'))
assert.doesNotThrow(() => assertMetaRead('https://graph.facebook.com/v19.0/act_100/ads?limit=10', 'GET'))
assert.doesNotThrow(() => assertMetaRead('https://graph.facebook.com/v19.0/act_100/adsets?limit=10', 'GET'))
assert.throws(() => assertMetaRead('https://graph.facebook.com/v19.0/act_100/ads', 'POST'), /read-only/)
assert.equal(stripSecrets('fail access_token=EAA123abc'), 'fail access_token=redacted')
assert.equal(safeEqual('abc', 'abc'), true)
assert.equal(safeEqual('abc', 'abd'), false)
assert.equal(normalizeAccountId('act_42'), 'act_42')
assert.throws(() => normalizeAccountId('nope'))

const merged = mergeAccountConfigs(
  [{ accountId: 'act_1', name: 'טבלה', currency: 'ILS', timezone: 'Asia/Jerusalem', tokenEnv: 'META_TOKEN_BLEAZ', enabled: true }],
  [{ accountId: 'act_1', name: 'סביבה', currency: 'USD', timezone: 'UTC', tokenEnv: 'META_TOKEN_BLEAZ', enabled: true },
    { accountId: 'act_2', name: 'נוסף', currency: 'USD', timezone: 'UTC', tokenEnv: 'META_TOKEN_NONA', enabled: true }],
)
assert.equal(merged.find(row => row.accountId === 'act_1')?.currency, 'ILS')
assert.equal(merged.find(row => row.accountId === 'act_2')?.name, 'נוסף')

const positions = [
  { id: 'bdo', companyName: 'BDO', positionTitle: 'מנהלת חשבונות' },
  { id: 'alt', companyName: 'אלטשולר', positionTitle: 'עוזר חשב' },
  { id: 'alt-2', companyName: 'אלטשולר', positionTitle: 'מנהלת גיוס' },
  { id: 'meitav', companyName: 'מיטב', positionTitle: 'שירות לקוחות' },
  { id: 'clal-service', companyName: 'כלל', positionTitle: 'שירות לקוחות' },
  { id: 'clal-ops', companyName: 'כלל', positionTitle: 'רפרנט תפעול' },
]
function ids(name: string): string[] {
  return suggestCampaignPositions(name, positions).map(item => item.positionId).sort()
}
assert.deepEqual(ids('עוזר חשב אלטושלר'), ['alt'])
assert.deepEqual(ids('מנהלת חשבונות BDO משרה מלאה מהבית'), ['bdo'])
assert.deepEqual(ids('שירות לקוחות מיטב- כינרת'), ['meitav'])
assert.deepEqual(ids('רפרנט תפעול כלל רמת החייל'), ['clal-ops'])
assert.deepEqual(ids('שירות לקוחות כלל פתח תקווה טירגוט כללי'), ['clal-service'])
assert.deepEqual(ids('קמפיין כללי'), [])
assert.deepEqual(ids('אלטשולר').sort(), ['alt', 'alt-2'])
assert.equal(suggestCampaignPositions('אלטשולר', positions)[0].reason.includes('בלי שם משרה'), true)

const campaigns = [
  { accountId: 'act_1', campaignId: '111', campaignName: 'מנהלת חשבונות BDO משרה מלאה מהבית', positionIds: ['bdo'] },
  { accountId: 'act_1', campaignId: '222', campaignName: 'שירות לקוחות מיטב- כינרת', positionIds: [] },
  { accountId: 'act_1', campaignId: '333', campaignName: 'כפול', positionIds: ['bdo'] },
  { accountId: 'act_1', campaignId: '444', campaignName: 'כפול', positionIds: ['meitav'] },
]
assert.equal(attributeLead({ source: 'WhatsApp' }, campaigns).kind, 'unattributed')
assert.deepEqual(attributeLead({ source: 'WhatsApp', savedPositionId: 'bdo' }, campaigns), {
  kind: 'attributed', positionIds: ['bdo'], via: 'assignment', campaignId: undefined,
})
assert.equal(attributeLead({ source: 'מנהלת חשבונות BDO משרה מלאה מהבית' }, campaigns).kind, 'attributed')
const viaSource = attributeLead({ source: 'מנהלת חשבונות BDO משרה מלאה מהבית' }, campaigns)
assert.equal(viaSource.kind === 'attributed' && viaSource.via, 'source')
assert.equal(attributeLead({ source: 'שירות לקוחות מיטב- כינרת' }, campaigns).kind, 'unattributed')
if (attributeLead({ source: 'שירות לקוחות מיטב- כינרת' }, campaigns).kind === 'unattributed') {
  assert.equal(attributeLead({ source: 'שירות לקוחות מיטב- כינרת' }, campaigns).kind, 'unattributed')
}
const unmapped = attributeLead({ source: 'שירות לקוחות מיטב- כינרת' }, campaigns)
assert.equal(unmapped.kind, 'unattributed')
if (unmapped.kind === 'unattributed') assert.equal(unmapped.why, 'unmapped-campaign')
const ambiguous = attributeLead({ source: 'כפול' }, campaigns)
assert.equal(ambiguous.kind, 'unattributed')
if (ambiguous.kind === 'unattributed') assert.equal(ambiguous.why, 'ambiguous')
assert.deepEqual(
  attributeLead({ source: 'Meta', savedPositionIds: ['bdo', 'meitav'] }, campaigns).kind === 'attributed'
    ? (attributeLead({ source: 'Meta', savedPositionIds: ['bdo', 'meitav'] }, campaigns) as { positionIds: string[] }).positionIds
    : [],
  ['bdo', 'meitav'],
)

const today = '2026-11-10'
const sample = exampleBundle(today)
const known = campaignsFromMaps(sample.bundle.campaigns, sample.bundle.maps)
const leads = metricLeads(sample.candidates, known, today, today)
const report = computeAdsMetrics({
  spend: sample.bundle.spend,
  maps: sample.bundle.maps,
  leads,
  jobIds: 'all',
  usdToIls: 3.7,
  start: today,
  end: today,
})
assert.equal(report.selection.money.byCurrency[0].amount, 420)
assert.equal(report.selection.counts.leads, 6)
assert.equal(report.selection.counts.relevant, 3)
assert.equal(report.selection.counts.interviews, 2)
assert.equal(report.selection.counts.placements, 1)
assert.equal(report.selection.counts.dropouts, 1)
assert.equal(report.selection.costPerLead.amount, 70)
assert.equal(report.selection.costPerLead.currency, 'USD')
assert.equal(report.jobs.find(job => job.id === 'ex-bdo')?.money.byCurrency[0].amount, 300)
assert.equal(report.jobs.find(job => job.id === 'ex-bdo')?.counts.leads, 2)
assert.equal(report.jobs.find(job => job.id === 'ex-bdo')?.costPerLead.amount, 150)
assert.equal(report.jobs.find(job => job.id === 'ex-meitav')?.counts.placements, 1)
assert.equal(report.unattributed.counts.leads, 2)
assert.equal(report.unattributed.money.byCurrency[0].amount, 40)
assert.equal(formatMoney(420, 'USD'), '$420')

const onlyBdo = computeAdsMetrics({
  spend: sample.bundle.spend,
  maps: sample.bundle.maps,
  leads,
  jobIds: ['ex-bdo'],
  usdToIls: null,
  start: today,
  end: today,
})
assert.equal(onlyBdo.selection.money.byCurrency[0].amount, 300)
assert.equal(onlyBdo.selection.counts.leads, 2)
assert.equal(onlyBdo.unattributed.counts.leads, 2)

const shared = computeAdsMetrics({
  spend: [{ accountId: 'a', campaignId: 'c', date: today, spend: 100, currency: 'ILS' }],
  maps: [
    { accountId: 'a', campaignId: 'c', positionId: 'p1' },
    { accountId: 'a', campaignId: 'c', positionId: 'p2' },
  ],
  leads: [
    { id: 'l1', status: 'new', anchorDay: today, positionIds: ['p1', 'p2'], placementKind: 'out' },
  ],
  jobIds: 'all',
  usdToIls: null,
  start: today,
  end: today,
})
assert.equal(shared.selection.counts.leads, 1)
assert.equal(shared.selection.money.byCurrency[0].amount, 100)
assert.equal(shared.jobs.find(job => job.id === 'p1')?.counts.leads, 1)
assert.equal(shared.jobs.find(job => job.id === 'p2')?.counts.leads, 1)
assert.equal(shared.jobs.find(job => job.id === 'p1')?.money.byCurrency[0].amount, 50)

const withheld = computeAdsMetrics({
  spend: [{ accountId: 'a', campaignId: 'c', date: '2026-10-16', spend: 90, currency: 'ILS' }],
  maps: [{ accountId: 'a', campaignId: 'c', positionId: 'p1' }],
  leads: metricLeads([{
    id: 'placed',
    status: 'placement_complete',
    source: 'WhatsApp',
    savedPositionId: 'p1',
    createdAt: '2026-10-02T08:00:00.000Z',
    attributionMonth: '2026-10',
  }], [{ accountId: 'a', campaignId: 'c', campaignName: 'x', positionIds: ['p1'] }], '2026-10-15', '2026-10-20'),
  jobIds: 'all',
  usdToIls: null,
  start: '2026-10-15',
  end: '2026-10-20',
})
assert.equal(withheld.selection.counts.placements, 0)
assert.equal(withheld.selection.counts.placementsWithheld, 1)
assert.equal(withheld.selection.costPerPlacement.amount, null)

const fullMonth = computeAdsMetrics({
  spend: [{ accountId: 'a', campaignId: 'c', date: '2026-10-01', spend: 90, currency: 'ILS' }],
  maps: [{ accountId: 'a', campaignId: 'c', positionId: 'p1' }],
  leads: metricLeads([{
    id: 'placed',
    status: 'started_working',
    source: 'WhatsApp',
    savedPositionId: 'p1',
    createdAt: '2026-10-02T08:00:00.000Z',
    attributionMonth: '2026-10',
  }], [{ accountId: 'a', campaignId: 'c', campaignName: 'x', positionIds: ['p1'] }], '2026-10-01', '2026-10-31'),
  jobIds: 'all',
  usdToIls: null,
  start: '2026-10-01',
  end: '2026-10-31',
})
assert.equal(fullMonth.selection.counts.placements, 1)
assert.equal(fullMonth.selection.costPerPlacement.amount, 90)

assert.equal(campaignIsLive('ACTIVE', null), true)
assert.equal(campaignIsLive('PAUSED', null), false)
assert.equal(campaignIsLive('ACTIVE', false), false)
assert.equal(campaignIsLive('PAUSED', true), true)
assert.equal(campaignIsLive('', null), false)
const listed = visibleCampaigns([
  { campaignName: 'חי', status: 'ACTIVE', delivering: true },
  { campaignName: 'ישן Promoting', status: 'PAUSED', delivering: false },
], '')
assert.deepEqual(listed.map(item => item.campaignName), ['חי'])
assert.deepEqual(visibleCampaigns([
  { campaignName: 'חי', status: 'ACTIVE', delivering: true },
  { campaignName: 'ישן Promoting', status: 'PAUSED', delivering: false },
], 'promoting').map(item => item.campaignName), ['ישן Promoting'])
assert.equal(updatedAgo('2026-11-10T12:00:00.000Z', Date.parse('2026-11-10T12:12:00.000Z')), 'עודכן לפני 12 דק׳')

const catalog = [
  { accountId: 'act_1', campaignId: '111', campaignName: 'מנהלת חשבונות BDO משרה מלאה מהבית' },
  { accountId: 'act_1', campaignId: '222', campaignName: 'שירות לקוחות מיטב' },
]
assert.equal(inferCampaign({
  campaigns: catalog,
  referrals: [{ sourceId: '111', title: 'מודעה' }],
})?.reason, 'referral-id')
assert.equal(inferCampaign({
  campaigns: catalog,
  referrals: [{ title: 'מנהלת חשבונות BDO משרה מלאה מהבית' }],
})?.campaignId, '111')
assert.equal(inferCampaign({
  campaigns: catalog,
  source: 'WhatsApp',
  positionIds: ['job-bdo'],
  maps: [{ accountId: 'act_1', campaignId: '111', positionId: 'job-bdo' }],
})?.reason, 'job')
assert.equal(inferCampaign({
  campaigns: catalog,
  source: 'WhatsApp',
  positionIds: ['job-bdo'],
  maps: [
    { accountId: 'act_1', campaignId: '111', positionId: 'job-bdo' },
    { accountId: 'act_1', campaignId: '222', positionId: 'job-bdo' },
  ],
}), null)

const bdo = campaignFunnel({
  campaigns: [{ accountId: 'act_1', campaignId: '111', campaignName: 'מנהלת חשבונות BDO' }],
  accounts: [{ accountId: 'act_1', name: 'nona-jobs' }],
  spend: [{ accountId: 'act_1', campaignId: '111', date: '2026-11-10', spend: 300, currency: 'USD', results: 8 }],
  jobIds: 'all',
  usdToIls: null,
  start: '2026-11-10',
  end: '2026-11-10',
  candidates: [
    { id: 'a', status: 'new', source: 'WhatsApp', metaAccountId: 'act_1', metaCampaignId: '111', createdAt: '2026-11-10T08:00:00.000Z' },
    { id: 'b', status: 'sent_to_client', source: 'WhatsApp', metaAccountId: 'act_1', metaCampaignId: '111', createdAt: '2026-11-10T09:00:00.000Z' },
    { id: 'c', status: 'irrelevant', source: 'WhatsApp', metaAccountId: 'act_1', metaCampaignId: '111', createdAt: '2026-11-10T10:00:00.000Z' },
    { id: 'd', status: 'new', source: 'WhatsApp', createdAt: '2026-11-10T11:00:00.000Z' },
  ],
})
assert.equal(bdo.length, 1)
assert.equal(bdo[0].metaLeads, 8)
assert.equal(bdo[0].crmLeads, 3)
assert.equal(bdo[0].relevant, 1)
assert.equal(bdo[0].sent, 1)
assert.equal(bdo[0].notRelevant, 1)
assert.equal(bdo[0].interviews, 0)
assert.equal(bdo[0].placements, 0)
assert.equal(bdo[0].costPerRelevant.amount, 300)
assert.equal(bdo[0].accountName, 'nona-jobs')

const referral = referralFromRecord({
  _data: { message: { extendedTextMessage: { contextInfo: { externalAdReply: { title: 'מנהלת חשבונות BDO', sourceId: '111', sourceUrl: 'https://fb.me/x' } } } } },
})
assert.equal(referral?.sourceId, '111')
assert.equal(referral?.title, 'מנהלת חשבונות BDO')
assert.equal(referralFromRecord({ body: 'סתם הודעה' }), undefined)

const parsedAd = parseAdMetric({
  campaign_id: '111',
  adset_id: '22',
  ad_id: '33',
  ad_name: 'מודעה',
  date_start: '2026-11-10',
  spend: '30',
  impressions: '1000',
  reach: '400',
  clicks: '25',
  inline_link_clicks: '10',
  actions: [{ action_type: 'lead', value: '4' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '2' }],
}, 'USD')
assert.equal(parsedAd?.leads, 2)
assert.equal(parsedAd?.leadAction, 'onsite_conversion.messaging_conversation_started_7d')
assert.equal(parsedAd?.costPerLead, 15)
assert.equal(insightLeads([{ action_type: 'lead', value: '9' }]).leads, 9)
assert.equal(placementLabel('instagram', 'instagram_stories'), 'אינסטגרם סטוריז')
assert.equal(placementLabel('facebook', 'feed'), 'פיד פייסבוק')
assert.equal(creativeFatigue({ days: 3, frequencyRecent: 2.2, frequencyPrior: 1.4, ctrRecent: 0.01, ctrPrior: 0.02, cplRecent: 40, cplPrior: 20 }), true)
assert.equal(creativeFatigue({ days: 2, frequencyRecent: 2.2, frequencyPrior: 1.4, ctrRecent: 0.01, ctrPrior: 0.02, cplRecent: 40, cplPrior: 20 }), false)
assert.equal(rateLimitCode({ code: 17 }), 17)
assert.equal(rateLimitCode({ code: 100, error_subcode: 80004 }), 80004)
assert.equal(rateLimitCode({ code: 190 }), null)
assert.equal(backoffMs(0), 2000)
assert.equal(backoffMs(3), 16000)
assert.equal(adFromReferral(
  [{ sourceId: '33' }],
  [{ accountId: 'act_1', adId: '33', adsetId: '22', campaignId: '111', campaignName: 'BDO' }],
)?.adsetId, '22')
assert.equal(adFromReferral([{ sourceId: '999' }], [{ accountId: 'act_1', adId: '33', adsetId: '22', campaignId: '111', campaignName: 'BDO' }]), null)

console.log('meta ads selfcheck ok')
