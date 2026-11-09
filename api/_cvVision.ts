const VISION_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function normalizedMime(mime: string): string {
  const type = mime.toLowerCase().split(';')[0].trim()
  if (type === 'image/jpg' || type === 'image/pjpeg') return 'image/jpeg'
  return type
}

/** True when an image reader is already configured. No new key is required or created. */
export function imageVisionAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY
}

export function visionAcceptsMime(mime: string): boolean {
  return VISION_TYPES.has(normalizedMime(mime))
}

/**
 * The only image-CV call site. Returns null when OPENAI_API_KEY is unset,
 * when the picture cannot be sent (for example HEIC), or when the call fails.
 * A future reader replaces this function and nothing else.
 */
export async function readImageCv(bytes: Uint8Array, mime: string): Promise<string | null> {
  if (!imageVisionAvailable()) return null
  const type = normalizedMime(mime)
  if (!VISION_TYPES.has(type)) return null
  if (bytes.byteLength < 32 || bytes.byteLength > 4_000_000) return null
  try {
    return await requestVisionText(bytes, type)
  } catch (err) {
    console.error('cv vision', err instanceof Error ? err.message.slice(0, 200) : 'failed')
    return null
  }
}

async function requestVisionText(bytes: Uint8Array, mime: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1000,
      messages: [
        {
          role: 'system',
          content: 'Transcribe the visible text in this CV image. Return only that text, in its original language. If nothing is readable, return an empty string. Do not summarize, score, or invent facts.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract the CV text.' },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`, detail: 'low' },
            },
          ],
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`llm ${res.status}`)
  const body = await res.json() as { choices?: { message?: { content?: string } }[] }
  return body.choices?.[0]?.message?.content?.trim() || ''
}
