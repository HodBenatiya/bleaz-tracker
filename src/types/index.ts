// ── משרה קבועה ──
// נשמרת פעם אחת. הדיווח היומי מזין רק עלות+לידים.
// הפאנל (שנשלחו/ראיונות/התקבלו/אחריות) מתעדכן כאן כשמשהו קורה בפועל.
export interface SavedPosition {
  id: string
  companyName: string
  positionTitle: string
  city: string
  description?: string   // פירוט המשרה / הודעה מקדימה למועמדים
  positionNumber?: string // מספר משרה במערכת הפנימית
  positionUrl?: string    // לינק למשרה במערכת הפנימית
  clientToken?: string    // טוקן גישה ללינק ציבורי ללקוח
  isActive: boolean
  createdAt: string

  // ── פאנל מצטבר (לא יומי) ──
  funnelSentToClient:     number
  funnelInterviews:       number
  funnelAccepted:         number
  funnelConfirmed:        number
}

// ── הערה בהיסטוריית מועמד ──
export interface CandidateNote {
  id: string
  text: string
  createdAt: string
}

// ── ראיון שהתרחש בעבר (ארכיב) ──
export interface InterviewRecord {
  id:             string
  date:           string    // YYYY-MM-DD
  time?:          string    // HH:MM
  companyName:    string
  positionTitle?: string
  savedPositionId?: string  // מזהה המשרה בזמן הראיון
  createdAt:      string    // מתי הרשומה נוצרה
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
  dueTime?: string         // שעת יעד אופציונלית, פורמט HH:MM
  done: boolean
  reminderSent?: boolean   // האם נשלחה תזכורת WhatsApp 15 דק' לפני
  source?: 'app' | 'whatsapp' // מקור יצירת המשימה
  createdAt: string
  updatedAt?: string
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
  savedPositionId?: string  // שיוך ראשי (compat)
  savedPositionIds?: string[] // שיוך למשרות מרובות
  nonaStatus: NonaStatus    // סטטוס הקמת משתמש נונה
  interviewDate?: string         // תאריך ראיון עבודה (YYYY-MM-DD)
  interviewTime?: string         // שעת הראיון (HH:MM)
  interviewReminderSent?: boolean // האם נשלחה תזכורת WhatsApp
  startDate?: string        // תאריך התחלת עבודה (YYYY-MM-DD)
  cvUrl?: string            // לינק לקורות חיים (Supabase Storage)
  cvFileName?: string       // שם הקובץ המקורי
  notes: string             // הערה מהירה (legacy)
  noteHistory?: CandidateNote[]     // היסטוריית הערות עם חותמת זמן
  interviewHistory?: InterviewRecord[] // ראיונות קודמים שהמועמד עבר
  estimatedSalary?: number  // שכר משוער (₪/חודש)
  invoiceStatus?: 'none' | 'sent' | 'paid' // סטטוס גבייה
  invoiceSentDate?: string  // תאריך שליחת חשבונית (YYYY-MM-DD)
  paidDate?: string         // תאריך קבלת תשלום (YYYY-MM-DD)
  createdAt: string
  updatedAt: string
}

export type View = 'dashboard' | 'form' | 'history' | 'positions' | 'pipeline' | 'tasks' | 'candidates' | 'marketing' | 'data' | 'board' | 'management'
export type DashboardTab = 'daily' | 'weekly' | 'monthly' | 'company'
