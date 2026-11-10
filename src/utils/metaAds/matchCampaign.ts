import { normalizeHebrew } from '../matchCandidates'

export interface MatchPosition {
  id: string
  companyName?: string
  positionTitle?: string
  isActive?: boolean
}

export interface CampaignSuggestion {
  positionId: string
  reason: string
}

const GENERIC_TITLE = new Set([
  'שירות', 'לקוחות', 'משרה', 'מלאה', 'חלקית', 'מהבית', 'עבודה', 'כללי', 'טירגוט',
  'חדש', 'דחוף', 'היברידי', 'היברידית', 'בית', 'משרהמלאה',
])

function tokensOf(text: string): string[] {
  return normalizeHebrew(text).split(' ').filter(Boolean)
}

function isLatin(token: string): boolean {
  return /^[a-z0-9]+$/.test(token)
}

function damerau(a: string, b: string): number {
  const height = a.length + 1
  const width = b.length + 1
  const dp: number[][] = Array.from({ length: height }, () => Array(width).fill(0))
  for (let i = 0; i < height; i++) dp[i][0] = i
  for (let j = 0; j < width; j++) dp[0][j] = j
  for (let i = 1; i < height; i++) {
    for (let j = 1; j < width; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1)
      }
    }
  }
  return dp[a.length][b.length]
}

function tokensClose(needle: string, token: string): boolean {
  if (!needle || !token) return false
  if (needle === token) return true
  const length = Math.max(needle.length, token.length)
  if (length >= 8 && damerau(needle, token) <= 2) return true
  if (length >= 5 && damerau(needle, token) <= 1) return true
  return false
}

function companyTokens(name: string): string[] {
  return tokensOf(name).filter(token => (isLatin(token) ? token.length >= 2 : token.length >= 3))
}

function companyHit(companyName: string, campaignTokens: string[]): boolean {
  const tokens = companyTokens(companyName)
  if (!tokens.length) return false
  return tokens.some(token => campaignTokens.some(campaignToken => tokensClose(token, campaignToken)))
}

function titlePhraseHit(title: string, campaignNorm: string): boolean {
  const phrase = normalizeHebrew(title)
  if (phrase.length < 5) return false
  return campaignNorm.includes(phrase)
}

function distinctiveTitleHit(title: string, campaignTokens: string[]): boolean {
  const tokens = tokensOf(title).filter(token => token.length >= 4 && !GENERIC_TITLE.has(token))
  return tokens.some(token => campaignTokens.some(campaignToken => tokensClose(token, campaignToken)))
}

/**
 * Suggest positions for a campaign name. Nothing is saved until someone confirms.
 * Reasons are plain Hebrew, without a numeric score.
 */
export function suggestCampaignPositions(campaignName: string, positions: MatchPosition[]): CampaignSuggestion[] {
  const campaignNorm = normalizeHebrew(campaignName)
  const campaignTokens = tokensOf(campaignName)
  if (!campaignNorm) return []

  const prelim = positions.map(position => ({
    position,
    company: companyHit(position.companyName || '', campaignTokens),
    phrase: titlePhraseHit(position.positionTitle || '', campaignNorm),
    distinctive: distinctiveTitleHit(position.positionTitle || '', campaignTokens),
    phraseKey: normalizeHebrew(position.positionTitle || ''),
  }))
  const phraseCount = new Map<string, number>()
  for (const item of prelim) {
    if (!item.phrase || !item.phraseKey) continue
    phraseCount.set(item.phraseKey, (phraseCount.get(item.phraseKey) ?? 0) + 1)
  }

  const ranked = prelim.flatMap(item => {
    const uniquePhrase = item.phrase && (phraseCount.get(item.phraseKey) ?? 0) === 1
    const strong = (item.company && (item.phrase || item.distinctive)) || uniquePhrase
    const weak = item.company && !strong
    return strong || weak ? [{ position: item.position, strong }] : []
  })

  const strong = ranked.filter(item => item.strong)
  const chosen = strong.length ? strong : ranked.filter(item => !item.strong)
  return chosen.map(item => ({
    positionId: item.position.id,
    reason: item.strong
      ? 'שם הלקוח או שם המשרה מופיעים בקמפיין'
      : 'שם הלקוח מופיע בקמפיין, בלי שם משרה ברור',
  }))
}
