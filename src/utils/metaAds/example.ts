import type { Candidate, SavedPosition } from '../../types'
import type { AdsAccountRow, AdsBundle, AdsCampaignRow } from '../metaAdsStore'
import { addDaysISO } from './zone'

export const EXAMPLE_NOTE = 'נתוני דוגמה — לא נתונים אמיתיים'

export function examplePositions(): SavedPosition[] {
  const base = {
    city: '',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    funnelSentToClient: 0,
    funnelInterviews: 0,
    funnelAccepted: 0,
    funnelConfirmed: 0,
  }
  return [
    { ...base, id: 'ex-bdo', companyName: 'BDO', positionTitle: 'מנהלת חשבונות' },
    { ...base, id: 'ex-meitav', companyName: 'מיטב', positionTitle: 'שירות לקוחות' },
    { ...base, id: 'ex-clal', companyName: 'כלל', positionTitle: 'רפרנט תפעול' },
    { ...base, id: 'ex-old', companyName: 'ישן', positionTitle: 'משרה ישנה', isActive: false },
  ]
}

function person(partial: Partial<Candidate> & Pick<Candidate, 'id' | 'status' | 'createdAt'>): Candidate {
  return {
    name: 'דוגמה',
    phone: '0500000000',
    positionType: '',
    source: '',
    nonaStatus: '',
    notes: '',
    updatedAt: partial.createdAt,
    ...partial,
  }
}

export function exampleBundle(today: string): { bundle: AdsBundle; candidates: Candidate[] } {
  const yesterday = addDaysISO(today, -1)
  const account = 'act_1001470104897244'
  const campaigns: AdsCampaignRow[] = [
    { accountId: account, campaignId: '111', campaignName: 'מנהלת חשבונות BDO משרה מלאה מהבית', currency: 'USD', status: 'ACTIVE' },
    { accountId: account, campaignId: '222', campaignName: 'שירות לקוחות מיטב- כינרת', currency: 'USD', status: 'ACTIVE' },
    { accountId: account, campaignId: '333', campaignName: 'קמפיין בלי משרה', currency: 'USD', status: 'ACTIVE' },
  ]
  const accounts: AdsAccountRow[] = [{
    accountId: account,
    name: 'nona-jobs',
    currency: 'USD',
    timezone: 'America/Los_Angeles',
    enabled: true,
  }]
  const bundle: AdsBundle = {
    accounts,
    campaigns,
    maps: [
      { accountId: account, campaignId: '111', positionId: 'ex-bdo' },
      { accountId: account, campaignId: '222', positionId: 'ex-meitav' },
    ],
    usdToIls: 3.7,
    lastSync: { finishedAt: `${today}T10:05:00.000Z`, ok: true, message: EXAMPLE_NOTE },
    spend: [
      { accountId: account, campaignId: '111', date: today, spend: 300, currency: 'USD' },
      { accountId: account, campaignId: '111', date: yesterday, spend: 150, currency: 'USD' },
      { accountId: account, campaignId: '222', date: today, spend: 80, currency: 'USD' },
      { accountId: account, campaignId: '333', date: today, spend: 40, currency: 'USD' },
    ],
  }
  const candidates: Candidate[] = [
    person({ id: 'ex-1', status: 'new', source: 'WhatsApp', savedPositionId: 'ex-bdo', createdAt: `${today}T06:00:00.000Z` }),
    person({ id: 'ex-2', status: 'relevant', source: 'מנהלת חשבונות BDO משרה מלאה מהבית', createdAt: `${today}T07:00:00.000Z` }),
    person({ id: 'ex-3', status: 'interview_scheduled', source: 'WhatsApp', savedPositionId: 'ex-meitav', createdAt: `${today}T08:00:00.000Z` }),
    person({ id: 'ex-4', status: 'placement_complete', source: 'WhatsApp', savedPositionId: 'ex-meitav', createdAt: `${today}T09:00:00.000Z` }),
    person({ id: 'ex-5', status: 'irrelevant', source: 'WhatsApp', createdAt: `${today}T09:30:00.000Z` }),
    person({ id: 'ex-6', status: 'new', source: 'קמפיין לא מוכר', createdAt: `${today}T11:00:00.000Z` }),
    person({ id: 'ex-7', status: 'sent_to_client', source: 'WhatsApp', savedPositionId: 'ex-bdo', createdAt: `${yesterday}T08:00:00.000Z` }),
  ]
  return { bundle, candidates }
}
