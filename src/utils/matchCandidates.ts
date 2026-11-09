/** Zero-cost Hebrew matching of candidates to a job. Read-only. */

export interface MatchJobInput {
  id: string
  companyName?: string
  positionTitle?: string
  city?: string
  description?: string
}

export interface MatchCandidateInput {
  id: string
  name?: string
  phone?: string
  city?: string
  status?: string
  positionType?: string
  source?: string
  notes?: string
  noteHistory?: { text?: string }[]
  interviewHistory?: { companyName?: string; positionTitle?: string }[]
}

export interface MatchHit {
  id: string
  name: string
  phone: string
  city: string
  status: string
  score: number
  snippet: string
  highlights: string[]
  reasons: string[]
}

type Region = 'tel_aviv' | 'sharon' | 'center' | 'shfela' | 'jerusalem' | 'north' | 'south'

const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }

const STOP = new Set([
  'של', 'על', 'עם', 'את', 'זה', 'זו', 'היא', 'הוא', 'גם', 'לא', 'יש', 'אין', 'עבור', 'בין', 'כל', 'או', 'אם', 'כי',
  'רק', 'עוד', 'כדי', 'מאוד', 'מאד', 'טוב', 'עבודה', 'משרה', 'דרוש', 'דרושים', 'דרושה', 'מועמד', 'מועמדת', 'חברה',
  'שכר', 'תנאים', 'כולל', 'אפשר', 'צריך', 'מחפש', 'מחפשת', 'רוצה', 'יכול', 'יכולה', 'בנוסף', 'וכן', 'אחד', 'אחת',
  'מלאה', 'חלקית', 'ניסיון', 'נסיון', 'בוקר', 'ערב', 'לילה', 'משמרות', 'משמרת', 'זמין', 'זמינה',
])

const FIELDS: { id: string; label: string; terms: string[] }[] = [
  { id: 'callcenter', label: 'מוקד', terms: ['מוקד', 'מוקדן', 'מוקדנית', 'קול סנטר', 'call center', 'נציג שירות', 'נציגת שירות'] },
  { id: 'service', label: 'שירות', terms: ['שירות לקוחות', 'שירות', 'שרות', 'שירותיות'] },
  { id: 'sales', label: 'מכירות', terms: ['מכירות', 'מכירה', 'איש מכירות', 'אשת מכירות', 'נציג מכירות', 'נציגת מכירות', 'טלמרקטינג', 'sales'] },
  { id: 'insurance', label: 'ביטוח', terms: ['ביטוח', 'ביטוחי', 'סוכן ביטוח', 'סוכנת ביטוח', 'ביטוחים'] },
  { id: 'pension', label: 'פנסיה', terms: ['פנסיה', 'פנסיוני', 'פנסיונית', 'גמל', 'סוכן פנסיוני', 'קרן השתלמות', 'השתלמות'] },
  { id: 'bookkeeping', label: 'הנהלת חשבונות', terms: ['הנהלת חשבונות', 'הנהלת חשבון', 'הנהח', 'חשב שכר', 'חשבת שכר', 'חשבות', 'bookkeeping'] },
  { id: 'hospitality', label: 'מסעדנות', terms: ['מלצרות', 'מלצר', 'מלצרית', 'ברמן', 'ברמנית', 'בריסטה', 'מטבח', 'טבח', 'טבחית'] },
  { id: 'admin', label: 'משרד', terms: ['מזכירות', 'מזכיר', 'מזכירה', 'אדמיניסטרציה', 'פקיד', 'פקידה', 'קבלה'] },
  { id: 'logistics', label: 'לוגיסטיקה', terms: ['לוגיסטיקה', 'מחסנאי', 'מחסנאית', 'מחסן', 'מלגזה', 'מלגזן', 'נהג', 'נהגת', 'משלוחים'] },
  { id: 'finance', label: 'פיננסים', terms: ['גבייה', 'גביה', 'בנקאות', 'בנק', 'אשראי', 'פיננסים'] },
  { id: 'hr', label: 'משאבי אנוש', terms: ['משאבי אנוש', 'גיוס', 'רכזת גיוס', 'רכז גיוס'] },
  { id: 'security', label: 'אבטחה', terms: ['אבטחה', 'מאבטח', 'מאבטחת', 'שמירה'] },
]

const CITIES: [string, Region][] = [
  ['תל אביב יפו', 'tel_aviv'], ['תל אביב', 'tel_aviv'], ['יפו', 'tel_aviv'],
  ['רמת גן', 'tel_aviv'], ['גבעתיים', 'tel_aviv'], ['בני ברק', 'tel_aviv'],
  ['חולון', 'tel_aviv'], ['בת ים', 'tel_aviv'], ['אור יהודה', 'tel_aviv'],
  ['יהוד', 'tel_aviv'], ['קריית אונו', 'tel_aviv'], ['קרית אונו', 'tel_aviv'],
  ['גבעת שמואל', 'tel_aviv'], ['אזור', 'tel_aviv'],
  ['הרצליה', 'sharon'], ['רמת השרון', 'sharon'], ['רעננה', 'sharon'],
  ['כפר סבא', 'sharon'], ['הוד השרון', 'sharon'], ['נתניה', 'sharon'],
  ['כפר יונה', 'sharon'], ['אבן יהודה', 'sharon'], ['חדרה', 'sharon'],
  ['זכרון יעקב', 'sharon'], ['פרדס חנה', 'sharon'], ['קיסריה', 'sharon'],
  ['אור עקיבא', 'sharon'],
  ['פתח תקווה', 'center'], ['פתח תקוה', 'center'], ['ראשון לציון', 'center'],
  ['ראש העין', 'center'], ['לוד', 'center'], ['רמלה', 'center'],
  ['מודיעין', 'center'], ['אלעד', 'center'], ['שוהם', 'center'],
  ['רחובות', 'shfela'], ['נס ציונה', 'shfela'], ['יבנה', 'shfela'],
  ['גדרה', 'shfela'], ['גן יבנה', 'shfela'], ['מזכרת בתיה', 'shfela'],
  ['קריית עקרון', 'shfela'],
  ['ירושלים', 'jerusalem'], ['בית שמש', 'jerusalem'], ['מבשרת ציון', 'jerusalem'],
  ['מעלה אדומים', 'jerusalem'], ['ביתר עילית', 'jerusalem'],
  ['קריית שמונה', 'north'], ['קרית שמונה', 'north'], ['צפת', 'north'],
  ['טבריה', 'north'], ['כרמיאל', 'north'], ['נהריה', 'north'], ['עכו', 'north'],
  ['קריית אתא', 'north'], ['קריית ביאליק', 'north'], ['קריית ים', 'north'],
  ['קריית מוצקין', 'north'], ['קרית אתא', 'north'], ['קרית ביאליק', 'north'],
  ['קרית ים', 'north'], ['קרית מוצקין', 'north'], ['נשר', 'north'],
  ['טירת כרמל', 'north'], ['חיפה', 'north'], ['יוקנעם', 'north'],
  ['עפולה', 'north'], ['נצרת', 'north'], ['נוף הגליל', 'north'],
  ['מגדל העמק', 'north'], ['בית שאן', 'north'],
  ['באר שבע', 'south'], ['אשדוד', 'south'], ['אשקלון', 'south'],
  ['קריית גת', 'south'], ['קרית גת', 'south'], ['נתיבות', 'south'],
  ['אופקים', 'south'], ['שדרות', 'south'], ['דימונה', 'south'],
  ['ערד', 'south'], ['אילת', 'south'], ['ירוחם', 'south'],
]

const REGION_LABEL: Record<Region, string> = {
  tel_aviv: 'גוש דן',
  sharon: 'שרון',
  center: 'מרכז',
  shfela: 'שפלה',
  jerusalem: 'ירושלים',
  north: 'צפון',
  south: 'דרום',
}

const ADJACENT: Record<Region, Region[]> = {
  tel_aviv: ['sharon', 'center', 'shfela'],
  sharon: ['tel_aviv', 'center', 'north'],
  center: ['tel_aviv', 'sharon', 'shfela', 'jerusalem'],
  shfela: ['tel_aviv', 'center', 'south', 'jerusalem'],
  jerusalem: ['center', 'shfela'],
  north: ['sharon'],
  south: ['shfela'],
}

const EXCLUDED = new Set(['placement_complete', 'started_working', 'irrelevant'])

const STATUS_BOOST: Record<string, number> = {
  future_relevant: 24,
  relevant: 20,
  new: 12,
  screening: 12,
  call_scheduled: 12,
  called: 12,
  sent_to_client: 8,
  interview_scheduled: 6,
}

const BLACKLIST = ['רשימה שחורה', 'חסום', 'חסומה', 'לא ליצור קשר', 'לא לחזור']

export function normalizeHebrew(input: string): string {
  return String(input || '')
    .normalize('NFKC')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[ךםןףץ]/g, ch => FINALS[ch] || ch)
    .replace(/[״"׳'`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function tokens(text: string): string[] {
  return normalizeHebrew(text).split(' ').filter(word => word.length >= 2 && !STOP.has(word))
}

function hasTerm(haystack: string, term: string): boolean {
  const needle = normalizeHebrew(term)
  if (!needle) return false
  if (needle.includes(' ')) return haystack.includes(needle)
  if (needle.length <= 3) return haystack.split(' ').some(word => word === needle)
  return haystack.split(' ').some(word => word === needle || word.startsWith(needle))
}

const CITY_INDEX = [...CITIES]
  .map(([name, region]) => ({ name: normalizeHebrew(name), label: name, region }) as const)
  .sort((a, b) => b.name.length - a.name.length)

function placeOf(text: string): { city: string; region: Region } | null {
  const norm = normalizeHebrew(text)
  if (!norm) return null
  for (const city of CITY_INDEX) {
    if (norm === city.name || norm.includes(city.name)) return { city: city.label, region: city.region }
  }
  if (norm.includes('גוש דן')) return { city: '', region: 'tel_aviv' }
  if (norm.includes('השרון') || /(^| )שרון( |$)/.test(norm)) return { city: '', region: 'sharon' }
  if (norm.includes('שפלה')) return { city: '', region: 'shfela' }
  if (norm.includes('נגב') || /(^| )דרום( |$)/.test(norm)) return { city: '', region: 'south' }
  if (norm.includes('גליל') || /(^| )צפון( |$)/.test(norm)) return { city: '', region: 'north' }
  if (norm.includes('אזור המרכז') || norm.includes('במרכז הארץ')) return { city: '', region: 'center' }
  return null
}

function fieldsIn(text: string): { id: string; label: string; term: string }[] {
  const found: { id: string; label: string; term: string }[] = []
  for (const field of FIELDS) {
    const term = field.terms.find(item => hasTerm(text, item))
    if (term) found.push({ id: field.id, label: field.label, term })
  }
  return found
}

type Schedule = 'full' | 'part' | null

function scheduleOf(text: string): Schedule {
  const full = hasTerm(text, 'משרה מלאה') || hasTerm(text, 'פול טיים') || hasTerm(text, 'full time') || hasTerm(text, 'מלאה')
  const part = hasTerm(text, 'משרה חלקית') || hasTerm(text, 'חצי משרה') || hasTerm(text, 'part time') || hasTerm(text, 'חלקית')
  if (full && !part) return 'full'
  if (part && !full) return 'part'
  return null
}

function shiftsOf(text: string): string[] {
  return ['משמרות', 'בוקר', 'ערב', 'לילה'].filter(term => hasTerm(text, term))
}

function experienceOf(text: string): 'required' | 'none' | null {
  const none = hasTerm(text, 'ללא ניסיון') || hasTerm(text, 'בלי ניסיון') || hasTerm(text, 'ללא נסיון') || hasTerm(text, 'מתחיל')
  const some = hasTerm(text, 'ניסיון') || hasTerm(text, 'נסיון') || hasTerm(text, 'ותק')
  if (none && !some) return 'none'
  if (some && !none) return 'required'
  if (none) return 'none'
  return null
}

function corpusOf(candidate: MatchCandidateInput): string {
  return [
    candidate.positionType,
    candidate.city,
    candidate.notes,
    candidate.source,
    ...(candidate.noteHistory ?? []).map(note => note.text),
    ...(candidate.interviewHistory ?? []).map(item => [item.companyName, item.positionTitle].filter(Boolean).join(' ')),
  ].filter(Boolean).join('\n')
}

function snippetAround(original: string, terms: string[]): { snippet: string; highlights: string[] } {
  const clean = original.replace(/\s+/g, ' ').trim()
  if (!clean) return { snippet: '', highlights: [] }
  const lower = clean.toLowerCase()
  const found: { index: number; term: string }[] = []
  for (const term of terms) {
    const needle = term.trim()
    if (needle.length < 2) continue
    const index = lower.indexOf(needle.toLowerCase())
    if (index >= 0) found.push({ index, term: clean.slice(index, index + needle.length) })
  }
  if (!found.length) return { snippet: clean.slice(0, 140), highlights: [] }
  found.sort((a, b) => a.index - b.index)
  const start = Math.max(0, found[0].index - 36)
  const end = Math.min(clean.length, found[0].index + found[0].term.length + 80)
  const snippet = `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`
  return { snippet, highlights: [...new Set(found.map(item => item.term))] }
}

function jobText(job: MatchJobInput): string {
  return [job.positionTitle, job.description, job.city, job.companyName].filter(Boolean).join('\n')
}

export function rankCandidates(job: MatchJobInput, candidates: MatchCandidateInput[], limit = 20): MatchHit[] {
  const rawJob = jobText(job)
  const jobNorm = normalizeHebrew(rawJob)
  const jobFields = fieldsIn(jobNorm)
  const jobPlace = placeOf([job.city, job.description, job.positionTitle].filter(Boolean).join(' '))
  const jobSchedule = scheduleOf(jobNorm)
  const jobShifts = shiftsOf(jobNorm)
  const jobExperience = experienceOf(jobNorm)
  const jobTokens = tokens([job.positionTitle, job.description].filter(Boolean).join(' '))
    .filter(word => word.length >= 3)
    .filter(word => !jobFields.some(field => normalizeHebrew(field.term).includes(word) || word.includes(normalizeHebrew(field.label))))

  const hits: MatchHit[] = []
  for (const candidate of candidates) {
    const status = String(candidate.status || '')
    if (EXCLUDED.has(status)) continue
    const original = corpusOf(candidate)
    const text = normalizeHebrew(original)
    if (BLACKLIST.some(term => hasTerm(text, term))) continue

    const candFields = fieldsIn(text)
    const shared = jobFields.filter(field => candFields.some(item => item.id === field.id))
    const fieldScore = Math.min(40, shared.length * 28)

    const overlap = jobTokens.filter(word => hasTerm(text, word))
    const tokenScore = Math.min(18, overlap.length * 6)

    const candPlace = placeOf([candidate.city, original].filter(Boolean).join(' '))
    let locationScore = 0
    let locationReason = ''
    if (jobPlace && candPlace) {
      if (jobPlace.city && candPlace.city && normalizeHebrew(jobPlace.city) === normalizeHebrew(candPlace.city)) {
        locationScore = 24
        locationReason = `אזור: ${candPlace.city}`
      } else if (jobPlace.region === candPlace.region) {
        locationScore = 16
        locationReason = `אזור: ${REGION_LABEL[candPlace.region]}`
      } else if (ADJACENT[jobPlace.region].includes(candPlace.region)) {
        locationScore = 8
        locationReason = `אזור קרוב: ${REGION_LABEL[candPlace.region]}`
      }
    }

    const candSchedule = scheduleOf(text)
    let scheduleScore = 0
    let scheduleReason = ''
    if (jobSchedule && candSchedule) {
      if (jobSchedule === candSchedule) {
        scheduleScore = 10
        scheduleReason = jobSchedule === 'full' ? 'היקף: משרה מלאה' : 'היקף: משרה חלקית'
      } else {
        scheduleScore = -8
        scheduleReason = 'היקף שונה מהמשרה'
      }
    }

    const candShifts = shiftsOf(text)
    const sharedShifts = jobShifts.filter(shift => candShifts.includes(shift))
    const shiftScore = sharedShifts.length ? 6 : 0

    const candExperience = experienceOf(text)
    let experienceScore = 0
    let experienceReason = ''
    if (jobExperience && candExperience && jobExperience === candExperience) {
      experienceScore = 8
      experienceReason = jobExperience === 'required' ? 'ניסיון מתאים' : 'מתאים ללא ניסיון'
    } else if (jobExperience === 'required' && candExperience === 'none') {
      experienceScore = -6
    }

    const content = fieldScore + tokenScore + locationScore + scheduleScore + shiftScore + experienceScore
    const qualified = fieldScore > 0 || tokenScore > 0 || (locationScore >= 16 && (scheduleScore > 0 || experienceScore > 0 || shiftScore > 0))
    if (!qualified || content < 12) continue

    const statusBoost = STATUS_BOOST[status] ?? 4
    const reasons = [
      ...shared.map(field => `תחום: ${field.label}`),
      ...overlap.slice(0, 3).map(word => `מילה מהמשרה: ${word}`),
      locationReason,
      scheduleReason,
      sharedShifts.length ? `משמרות: ${sharedShifts.join(', ')}` : '',
      experienceReason,
    ].filter(Boolean)

    const surfaceTerms = [
      ...shared.map(field => field.term),
      ...shared.map(field => candFields.find(item => item.id === field.id)?.term || ''),
      ...overlap,
      candPlace?.city || '',
      ...sharedShifts,
    ].filter(Boolean)
    const { snippet, highlights } = snippetAround(original, surfaceTerms)

    hits.push({
      id: candidate.id,
      name: String(candidate.name || '').trim() || 'ללא שם',
      phone: String(candidate.phone || '').trim(),
      city: String(candidate.city || candPlace?.city || '').trim(),
      status,
      score: Math.max(1, Math.min(99, Math.round(content + statusBoost))),
      snippet,
      highlights,
      reasons,
    })
  }

  const rank = (status: string) => status === 'future_relevant' ? 0 : status === 'relevant' ? 1 : 2
  hits.sort((a, b) => b.score - a.score || rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, 'he'))
  return hits.slice(0, limit)
}
