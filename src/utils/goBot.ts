const IN_APP = /FBAN|FBAV|FB_IAB|Instagram/i

/** Substrings, matched case-insensitively. Longer product names sit beside the generic words. */
const BOT_TOKENS = [
  'facebookexternalhit',
  'facebookcatalog',
  'meta-externalagent',
  'meta-externalfetcher',
  'facebot',
  'telegrambot',
  'twitterbot',
  'slackbot',
  'linkedinbot',
  'discordbot',
  'skypeuripreview',
  'googlebot',
  'bingbot',
  'applebot',
  'duckduckbot',
  'redditbot',
  'baiduspider',
  'headlesschrome',
  'python-requests',
  'go-http-client',
  'node-fetch',
  'whatsapp',
  'yandex',
  'embedly',
  'pinterest',
  'vkshare',
  'wget',
  'axios',
  'curl',
  'crawler',
  'spider',
  'preview',
  'bot',
]

/** Present on real mobile and desktop browsers, including in-app WebViews. */
const BROWSER_TOKENS = [
  'applewebkit',
  'chrome',
  'crios',
  'firefox',
  'fxios',
  'mozilla',
  'opr/',
  'safari',
  'samsungbrowser',
  'edg/',
]

/**
 * Preview crawlers and non-browser clients. Facebook and Instagram in-app
 * browsers stay human. The user-agent string itself is never stored.
 */
export function isBotUserAgent(ua: string | null | undefined, acceptLanguage?: string | null): boolean {
  const value = typeof ua === 'string' ? ua.trim() : ''
  if (!value) return true
  if (IN_APP.test(value)) return false
  const lower = value.toLowerCase()
  if (BOT_TOKENS.some(token => lower.includes(token))) return true
  const language = typeof acceptLanguage === 'string' ? acceptLanguage.trim() : ''
  if (!language && !BROWSER_TOKENS.some(token => lower.includes(token))) return true
  return false
}
