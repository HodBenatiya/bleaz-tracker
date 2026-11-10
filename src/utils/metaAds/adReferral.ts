/** A click-to-WhatsApp ad marker, when the chat provider sent one. */

export interface AdReferral {
  title?: string
  body?: string
  sourceId?: string
  sourceUrl?: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function fromNode(node: unknown): AdReferral | undefined {
  if (!node || typeof node !== 'object') return undefined
  const record = node as Record<string, unknown>
  const nested = record.externalAdReply && typeof record.externalAdReply === 'object'
    ? record.externalAdReply as Record<string, unknown>
    : record
  const title = text(nested.title)
  const body = text(nested.body || nested.description)
  const sourceId = text(nested.sourceId || nested.sourceID)
  const sourceUrl = text(nested.sourceUrl || nested.sourceURL || nested.url)
  if (!title && !body && !sourceId) return undefined
  return {
    title: title || undefined,
    body: body || undefined,
    sourceId: sourceId || undefined,
    sourceUrl: sourceUrl || undefined,
  }
}

function dig(root: unknown, path: string[]): unknown {
  let current = root
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

const PATHS = [
  ['_data', 'message', 'extendedTextMessage', 'contextInfo', 'externalAdReply'],
  ['_data', 'Message', 'extendedTextMessage', 'contextInfo', 'externalAdReply'],
  ['messageData', 'extendedTextMessageData'],
  ['messageData', 'extendedTextMessageData', 'contextInfo', 'externalAdReply'],
  ['_data', 'ctwaContext'],
]

/** Read a referral from a WAHA or Green API message body. Missing data returns undefined. */
export function referralFromRecord(record: unknown): AdReferral | undefined {
  if (!record || typeof record !== 'object') return undefined
  for (const path of PATHS) {
    const found = fromNode(dig(record, path))
    if (found) return found
  }
  return undefined
}
