/** Rule-based Hebrew screening note. No scores. Safe to show in the candidate card. */

export interface NoteFacts {
  area: string[]
  scope: string[]
  experience: string[]
  education: string[]
  availability: string[]
  job: string[]
  notes: string[]
}

const AREAS = [
  'תל אביב', 'רמת גן', 'גבעתיים', 'בני ברק', 'חולון', 'בת ים', 'הרצליה', 'רעננה', 'כפר סבא',
  'נתניה', 'חדרה', 'פתח תקווה', 'ראשון לציון', 'רחובות', 'ירושלים', 'בית שמש', 'חיפה', 'נהריה',
  'עפולה', 'באר שבע', 'אשדוד', 'אשקלון', 'קריית גת', 'מודיעין',
]
const REGIONS = ['גוש דן', 'השרון', 'שפלה', 'אזור המרכז', 'במרכז', 'בצפון', 'בדרום', 'נגב', 'גליל']

const EXPERIENCE: { label: string; terms: string[] }[] = [
  { label: 'מכירות', terms: ['מכירות', 'מכירה', 'נציג מכירות', 'טלמרקטינג'] },
  { label: 'שירות', terms: ['שירות לקוחות', 'שירות', 'שרות'] },
  { label: 'מוקד', terms: ['מוקד', 'מוקדן', 'מוקדנית', 'קול סנטר'] },
  { label: 'ביטוח', terms: ['ביטוח', 'סוכן ביטוח'] },
  { label: 'פנסיה', terms: ['פנסיה', 'פנסיוני', 'גמל'] },
  { label: 'הנהלת חשבונות', terms: ['הנהלת חשבונות', 'הנה"ח', 'הנהח', 'חשב שכר', 'חשבת שכר'] },
  { label: 'בק אופיס', terms: ['בק אופיס', 'מזכירות', 'אדמיניסטרציה'] },
  { label: 'פיננסים', terms: ['פיננסים', 'בנק', 'אשראי', 'גבייה', 'גביה'] },
  { label: 'מסחר', terms: ['מסחר', 'טריידינג', 'trading', 'שוק ההון'] },
]

const HEADER = 'טיוטה אוטומטית – לבדוק'

function has(text: string, term: string): boolean {
  return text.includes(term.toLowerCase())
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = value.replace(/\s+/g, ' ').trim()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}

function sentencesAround(text: string, pattern: RegExp): string[] {
  return unique(
    text.split(/[.\n]/).map(part => part.trim()).filter(part => pattern.test(part)).map(part => part.slice(0, 140)),
  ).slice(0, 4)
}

export function extractNoteFacts(raw: string): NoteFacts {
  const text = raw.replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()
  const area = unique([
    ...AREAS.filter(city => text.includes(city)),
    ...REGIONS.filter(region => text.includes(region)),
  ])
  const scope: string[] = []
  if (has(lower, 'משרה מלאה') || has(lower, 'פול טיים') || has(lower, 'full time')) scope.push('משרה מלאה')
  if (has(lower, 'משרה חלקית') || has(lower, 'חצי משרה') || has(lower, 'part time')) scope.push('משרה חלקית')
  if (has(lower, 'משמרות')) scope.push('משמרות')
  if (has(lower, 'בוקר')) scope.push('בוקר')
  if (has(lower, 'ערב')) scope.push('ערב')
  if (has(lower, 'לילה')) scope.push('לילה')

  const experience = unique([
    ...EXPERIENCE.filter(item => item.terms.some(term => has(lower, term.toLowerCase()))).map(item => item.label),
    ...sentencesAround(text, /עבד|ניסיון|נסיון|שנתיים|שנים/),
  ])

  const education = unique([
    ...sentencesAround(text, /תואר|בגרות|תעודה|רישיון|קורס|לימוד/),
    ...(has(lower, 'אנגלית') || has(lower, 'רוסית') || has(lower, 'ערבית') || has(lower, 'אמהרית')
      ? [`שפות: ${['עברית', 'אנגלית', 'רוסית', 'ערבית', 'אמהרית'].filter(lang => text.includes(lang)).join(', ') || 'עברית'}`]
      : []),
  ])

  const availability = unique(sentencesAround(text, /זמינ|מייד|מידית|להתחיל|אחרי החג|עוד חודש|משבוע/)).slice(0, 2)
  const job = unique([
    ...(text.match(/(?:פונה לגבי|לגבי המשרה|מעוניין(?:ת)? ב|מתעניין(?:ת)? ב)\s+([^.,\n]{2,40})/)?.[1] ? [RegExp.$1.trim()] : []),
  ])

  const notes: string[] = []
  const age = text.match(/(?:גיל|בן|בת)\s*(\d{2})\b/)
  const birth = text.match(/(?:יליד|ילידת|נולד(?:תי)?(?:\s+ב)?)\s*(19\d{2}|20\d{2})/)
  if (age) notes.push(`גיל ${age[1]}`)
  else if (birth) notes.push(`שנת לידה ${birth[1]}`)
  for (const flag of ['לא מעוניין', 'לא מעוניינת', 'אין רישיון', 'אין רכב', 'לא יכול משמרות', 'לא יכולה משמרות']) {
    if (text.includes(flag)) notes.push(flag)
  }

  return { area, scope, experience, education, availability, job, notes }
}

export function formatNoteDraft(facts: NoteFacts, extraNotes: string[] = []): string {
  const notes = unique([...facts.notes, ...extraNotes])
  const lines = [HEADER]
  const add = (label: string, values: string[]) => {
    if (values.length) lines.push(`${label}: ${values.join(' · ')}`)
  }
  add('אזור', facts.area)
  add('היקף', facts.scope)
  add('ניסיון', facts.experience)
  add('השכלה', facts.education)
  add('זמינות', facts.availability)
  add('משרה שפנה אליה', facts.job)
  add('הערות', notes.length ? notes : ['לא נמצאו פרטים נוספים בשיחה או בקורות החיים'])
  return lines.join('\n')
}

export function draftFromText(chat: string, cv: string, extraNotes: string[] = []): string {
  return formatNoteDraft(extractNoteFacts(`${chat}\n${cv}`), extraNotes)
}

export function looksLikeAutoDraft(notes: string): boolean {
  return notes.trimStart().startsWith(HEADER)
}
