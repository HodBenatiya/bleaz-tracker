/**
 * Funnel stages for ad cost, taken from the CRM candidate statuses.
 *
 * ליד            every candidate who entered in the date range
 * ליד רלוונטי    relevant, sent_to_client, interview_scheduled, started_working, placement_complete
 *                future_relevant stays out: the recruiter marked them for later, not for this job now
 * ראיון עבודה    interview_scheduled and anyone already past it (started_working, placement_complete)
 *                called is a screening call, not a job interview
 * השמה           started_working or placement_complete
 *                the day/month rule lives in candidateAnchor (creation month, or attributionMonth)
 * נפל            irrelevant — the CRM has no separate "dropped after interview" status
 */

export const RELEVANT_STATUSES = [
  'relevant',
  'sent_to_client',
  'interview_scheduled',
  'started_working',
  'placement_complete',
] as const

export const INTERVIEW_STATUSES = [
  'interview_scheduled',
  'started_working',
  'placement_complete',
] as const

export const PLACEMENT_STATUSES = ['started_working', 'placement_complete'] as const

export const DROPOUT_STATUSES = ['irrelevant'] as const

export function isRelevantStatus(status: string): boolean {
  return (RELEVANT_STATUSES as readonly string[]).includes(status)
}

export function isInterviewStatus(status: string): boolean {
  return (INTERVIEW_STATUSES as readonly string[]).includes(status)
}

export function isDropoutStatus(status: string): boolean {
  return (DROPOUT_STATUSES as readonly string[]).includes(status)
}

export const METRIC_COPY = {
  spend: { label: 'הוצאה', hint: 'כמה שולם למטא בטווח שנבחר' },
  leads: { label: 'לידים', hint: 'מועמדים שנכנסו ל-CRM בטווח' },
  costPerLead: { label: 'עלות לליד', hint: 'הוצאה לחלק למספר הלידים' },
  relevant: { label: 'לידים רלוונטיים', hint: 'סומנו רלוונטי, נשלחו ללקוח, הגיעו לראיון או הושמו' },
  costPerRelevant: { label: 'עלות לליד רלוונטי', hint: 'הוצאה לחלק ללידים הרלוונטיים' },
  interviews: { label: 'ראיונות עבודה', hint: 'נקבע ראיון, או שהמועמד כבר התחיל לעבוד או הושם' },
  costPerInterview: { label: 'עלות לראיון', hint: 'הוצאה לחלק לראיונות העבודה' },
  placements: { label: 'השמות', hint: 'התחיל לעבוד או הושלמה השמה, לפי חודש היצירה או שיוך ידני' },
  costPerPlacement: { label: 'עלות להשמה', hint: 'הוצאה לחלק להשמות' },
  dropouts: { label: 'נפל', hint: 'סומן לא רלוונטי' },
  costPerDropout: { label: 'עלות לנפל', hint: 'הוצאה לחלק למי שסומן לא רלוונטי' },
} as const
