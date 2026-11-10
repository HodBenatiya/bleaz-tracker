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

/** Shown when a CV arrived as a picture and no vision reader is connected. */
export const IMAGE_CV_STATUS = 'קורות החיים התקבלו כתמונה – יפוענחו אוטומטית לאחר חיבור מנוע הניתוח'

/** Shown for a file we cannot read. The draft stays local; nothing is sent to the candidate. */
export const UNSUPPORTED_CV_STATUS = 'פורמט קובץ לא נתמך – בקשו מהמועמד PDF או Word'

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

const PHONE = /(?:\+?972|0)5\d{8}/g
const CHAT_BUDGET = 7_000
const CV_BUDGET = 6_000

export const NOTE_DRAFT_SYSTEM = `כתוב טיוטת הערת סינון בעברית למגייס. זו טיוטה לניתוח, לא תמלול ולא העתק של השיחה, והיא לא נשמרת מכאן.

מזג שני מקורות בלבד:
1. קורות החיים, אם יש: מי המועמד, גיל אם צוין, היסטוריית עבודה, ניסיון רלוונטי, השכלה וכישורים.
2. שיחת הוואטסאפ עם הליד: עובדות שהמועמד מסר והעדפות או אילוצים שהביע, למשל איפה הוא גר, איזו משרה הוא מחפש, שעות וזמינות, תאריך התחלה, ציפיות שכר, רכב והסעות, שפות, העדפת תחום, ומה שאמר על תפקידים קודמים. הודעות שלנו נותנות הקשר בלבד ואינן עובדות על המועמד.

פלט: סיכום אחד תמציתי בטון מקצועי וישיר, בלי אימוג'י, בלי ציון ובלי מספרי טלפון.
מבנה:
- שורת פרופיל קצרה
- ניסיון מתוך קורות החיים
- מה עלה בשיחה (מיקום, זמינות, העדפות משרה, אילוצים)
- שורת התאמה קצרה: לאן זה מתאים (למשל מוקד או פיננסים), פערים, ושאלות פתוחות לשיחת הסינון

אל תצטט את השיחה כלשונה ואל תמנה הודעות. סכם.
אם חסר מקור (אין קורות חיים, או אין בשיחה מידע שימושי), כתוב זאת בקצרה והשתמש במה שקיים.
אל תמציא פרטים שלא מופיעים בקורות החיים או בשיחה.
פתח בשורה המדויקת: ${HEADER}`

export interface NoteDraftMessage {
  direction?: string
  text?: string
  caption?: string
}

export interface NoteDraftImage {
  mime: string
  base64: string
}

export interface NoteDraftPrompt {
  system: string
  user: string
  image?: NoteDraftImage
  hasSource: boolean
}

export type NoteDraftLlmContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail: 'low' } }
    >

export interface NoteDraftLlmMessage {
  role: 'system' | 'user'
  content: NoteDraftLlmContent
}

function redact(value: string): string {
  return value.replace(PHONE, '')
}

function lineFor(message: NoteDraftMessage): string {
  const raw = String(message.text || '').trim() || String(message.caption || '').trim()
  const text = redact(raw).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const who = message.direction === 'out' ? 'אנחנו' : 'מועמד'
  return `[${who}] ${text}`
}

/** Newest lines win the budget. The kept lines stay in chronological order. */
function conversationBlock(messages: NoteDraftMessage[]): { text: string; count: number } {
  const lines = (messages || []).map(lineFor).filter(Boolean)
  const kept: string[] = []
  let used = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const cost = kept.length ? line.length + 1 : line.length
    if (cost > CHAT_BUDGET) {
      if (!kept.length) kept.push(line.slice(line.length - CHAT_BUDGET))
      break
    }
    if (used + cost > CHAT_BUDGET) break
    kept.push(line)
    used += cost
  }
  kept.reverse()
  const omitted = lines.length - kept.length
  const header = omitted > 0
    ? `שיחה (ההודעות האחרונות, מהישן לחדש; ${omitted} הודעות ישנות הושמטו. "מועמד" = עובדה על המועמד, "אנחנו" = הקשר בלבד ולא עובדה):`
    : 'שיחה (מהישן לחדש. "מועמד" = עובדה על המועמד, "אנחנו" = הקשר בלבד ולא עובדה):'
  const body = kept.length ? kept.join('\n') : 'אין טקסט שיחה.'
  return { text: `${header}\n${body}`, count: lines.length }
}

function cvBlock(cvText: string, image?: NoteDraftImage): string {
  const text = redact(cvText).trim()
  const clipped = text ? text.slice(0, CV_BUDGET) : ''
  if (clipped && image) return `קורות חיים (טקסט שחולץ, והתמונה מצורפת להודעה):\n${clipped}`
  if (clipped) return `קורות חיים:\n${clipped}`
  if (image) return 'קורות חיים: צורפו כתמונה ומצורפות להודעה. אין טקסט מחולץ.'
  return 'קורות חיים: לא צורפו.'
}

export function buildNoteDraftPrompt(input: {
  messages: NoteDraftMessage[]
  cvText?: string
  image?: NoteDraftImage | null
}): NoteDraftPrompt {
  const image = input.image?.base64 ? input.image : undefined
  const chat = conversationBlock(input.messages || [])
  const cvText = input.cvText || ''
  return {
    system: NOTE_DRAFT_SYSTEM,
    user: `${chat.text}\n\n${cvBlock(cvText, image)}`,
    image,
    hasSource: chat.count > 0 || Boolean(redact(cvText).trim()) || Boolean(image),
  }
}

/** The chat-completions messages actually sent for the draft. */
export function noteDraftLlmMessages(prompt: NoteDraftPrompt): NoteDraftLlmMessage[] {
  const user: NoteDraftLlmContent = prompt.image
    ? [
        { type: 'text', text: prompt.user },
        {
          type: 'image_url',
          image_url: { url: `data:${prompt.image.mime};base64,${prompt.image.base64}`, detail: 'low' },
        },
      ]
    : prompt.user
  return [
    { role: 'system', content: prompt.system },
    { role: 'user', content: user },
  ]
}
