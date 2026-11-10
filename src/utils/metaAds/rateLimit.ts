/** Meta Marketing API rate-limit codes. 17 user limit, 613 app limit, 80004 ad-account limit. */

export const META_RATE_LIMIT_CODES = [17, 613, 80004] as const

export function rateLimitCode(error: { code?: number; error_subcode?: number } | null | undefined): number | null {
  if (!error) return null
  for (const code of [error.code, error.error_subcode]) {
    if (typeof code === 'number' && (META_RATE_LIMIT_CODES as readonly number[]).includes(code)) return code
  }
  return null
}

/** 2s, 4s, 8s, 16s. */
export function backoffMs(attempt: number): number {
  const step = Math.max(0, Math.floor(attempt))
  return Math.min(16000, 2000 * (2 ** step))
}
