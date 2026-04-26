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
  done: boolean
  createdAt: string
}

export type View = 'dashboard' | 'form' | 'history' | 'positions' | 'pipeline' | 'tasks'
export type DashboardTab = 'daily' | 'weekly' | 'monthly' | 'company'
