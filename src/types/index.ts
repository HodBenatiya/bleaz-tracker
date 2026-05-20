// ── משרה קבועה ──
// נשמרת פעם אחת. הדיווח היומי מזין רק עלות+לידים.
// הפאנל (שנשלחו/ראיונות/התקבלו/אחריות) מתעדכן כאן כשמשהו קורה בפועל.
export interface SavedPosition {
  id: string
  companyName: string
  positionTitle: string
  city: string
  isActive: boolean
  createdAt: string

  // ── פאנל מצטבר (לא יומי) ──
  // מתעדכן ידנית כשמשהו קורה, ללא קשר לתאריך ספציפי
  funnelSentToClient:     number  // פרופילים שנשלחו ללקוח לאישור
  funnelInterviews:       number  // ראיונות שנקיימו
  funnelAccepted:         number  // מועמדים שהתחילו לעבוד
  funnelConfirmed:        number  // עברו תקופת אחריות → הכנסה מאושרת
}

// ── נתוני קמפיין יומיים למשרה ספציפית ──
export interface JobPosition {
  id: string
  savedPositionId?: string
  companyName: string
  positionTitle: string
  city: string
  campaignCost: number
  leadsIn: number
  relevantLeads: number
}

// ── פייפליין לקוחות — צחי ──
export type PipelineStage =
  | 'first_contact'
  | 'meeting_scheduled'
  | 'offer_sent'
  | 'negotiating'
  | 'signed'
  | 'lost'

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  first_contact:     'פנייה ראשונית',
  meeting_scheduled: 'פגישה נקבעה',
  offer_sent:        'הצעה נשלחה',
  negotiating:       'במשא ומתן',
  signed:            'נחתם ✓',
  lost:              'נדחה',
}

export const PIPELINE_STAGE_COLORS: Record<PipelineStage, string> = {
  first_contact:     'badge-gray',
  meeting_scheduled: 'badge-blue',
  offer_sent:        'badge-yellow',
  negotiating:       'bg-orange-100 text-orange-800',
  signed:            'badge-green',
  lost:              'bg-red-100 text-red-700',
}

export interface PipelineCompany {
  id: string
  name: string
  contactPerson: string
  stage: PipelineStage
  nextAction: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type ClientStatus = 'active' | 'pending' | 'negotiating' | 'paused'

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active:      'פעיל',
  pending:     'בהמתנה',
  negotiating: 'במשא ומתן',
  paused:      'מושהה',
}

export interface ActiveClient {
  id: string
  name: string
  status: ClientStatus
  notes: string
}

export interface DailyReport {
  id: string
  date: string
  createdAt: string
  updatedAt: string

  // הוד — קמפיינים
  jobs: JobPosition[]
  screeningCalls: number
  nonaUsersRegistered: number
  hodBlockers: string

  // צחי — גיוס לקוחות
  outreachSent: number
  companiesNearClose: number
  newClientsSigned: number
  tzachiBlockers: string

  // משותף
  activeClients: ActiveClient[]
  generalNotes: string
}

// ── משימות ──
export type TaskPriority = 'high' | 'medium' | 'low'

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  high:   'דחוף',
  medium: 'רגיל',
  low:    'נמוך',
}

export interface Task {
  id: string
  title: string
  assignee: 'hod' | 'tzachi' | 'both'
  priority: TaskPriority
  dueDate: string
  dueTime?: string   // שעת יעד אופציונלית, פורמט HH:MM
  done: boolean
  createdAt: string
}

// ── מועמדים (CRM) ──
export type CandidateStatus =
  | 'new'                 // חדש — נכנס מהקמפיין
  | 'screening'           // בסינון — שיחת ווצאפ
  | 'call_scheduled'      // שיחה מתואמת
  | 'called'              // שוחח / רואיין
  | 'relevant'            // רלוונטי — ממתין למשרה
  | 'future_relevant'     // רלוונטי עתידי — לא עכשיו
  | 'sent_to_client'      // נשלח ללקוח
  | 'interview_scheduled' // נקבע ראיון
  | 'started_working'     // התחיל לעבוד
  | 'placement_complete'  // הושלמה השמה ✓
  | 'irrelevant'          // לא רלוונטי

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  new:                 'חדש',
  screening:           'בסינון',
  call_scheduled:      'שיחה נקבעה',
  called:              'שוחח',
  relevant:            'רלוונטי',
  future_relevant:     'רלוונטי עתידי',
  sent_to_client:      'נשלח ללקוח',
  interview_scheduled: 'נקבע ראיון',
  started_working:     'התחיל לעבוד',
  placement_complete:  'הושלמה השמה ✓',
  irrelevant:          'לא רלוונטי',
}

export const CANDIDATE_STATUS_COLORS: Record<CandidateStatus, string> = {
  new:                 'bg-blue-100 text-blue-800',
  screening:           'bg-yellow-100 text-yellow-800',
  call_scheduled:      'bg-orange-100 text-orange-800',
  called:              'bg-purple-100 text-purple-800',
  relevant:            'bg-green-100 text-green-800',
  future_relevant:     'bg-lime-100 text-lime-800',
  sent_to_client:      'bg-teal-100 text-teal-800',
  interview_scheduled: 'bg-indigo-100 text-indigo-800',
  started_working:     'bg-emerald-100 text-emerald-800',
  placement_complete:  'bg-emerald-600 text-white',
  irrelevant:          'bg-red-100 text-red-700',
}

export type NonaStatus = '' | 'קיים' | 'לא קיים' | 'ממתין לסרטון'

export interface Candidate {
  id: string
  name: string
  phone: string
  age?: number              // גיל
  city?: string             // עיר מגורים
  status: CandidateStatus
  positionType: string      // סוג המשרה
  source: string            // שם הקמפיין / מקור
  savedPositionId?: string  // שיוך למשרה ספציפית
  nonaStatus: NonaStatus    // סטטוס הקמת משתמש נונה
  interviewDate?: string    // תאריך ראיון עבודה (YYYY-MM-DD)
  startDate?: string        // תאריך התחלת עבודה (YYYY-MM-DD)
  notes: string
  createdAt: string
  updatedAt: string
}

export type View = 'dashboard' | 'form' | 'history' | 'positions' | 'pipeline' | 'tasks' | 'candidates' | 'marketing'
export type DashboardTab = 'daily' | 'weekly' | 'monthly' | 'company'
