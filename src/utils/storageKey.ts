/** Storage object keys are ASCII. The original filename is kept on the candidate or message. */

function basename(name: string): string {
  const trimmed = String(name || '').trim().replace(/\\/g, '/')
  const parts = trimmed.split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

/** Lowercase ASCII extension, including the dot. Empty when the name has none. */
export function fileExtension(name: string): string {
  const base = basename(name)
  const match = base.match(/\.([a-z0-9]{1,10})$/i)
  return match ? `.${match[1].toLowerCase()}` : ''
}

function asciiSlug(stem: string): string {
  return stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** `my cv.PDF` → `my-cv.pdf`. A Hebrew name with no ASCII stem becomes `cv.pdf`. */
export function storageObjectName(originalName: string, fallback = 'cv'): string {
  const token = fallback.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'cv'
  const base = basename(originalName)
  const ext = fileExtension(base)
  const stem = ext ? base.slice(0, -ext.length) : base
  return `${asciiSlug(stem) || token}${ext}`
}

function folderSegment(value: string, fallback: string): string {
  const clean = String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '').replace(/^[_-]+|[_-]+$/g, '').slice(0, 80)
  return clean || fallback
}

/** `<owner>/<timestamp>-<ascii slug>.<ext>` for the private `cvs` bucket. */
export function cvStorageKey(ownerId: string, originalName: string, now = Date.now()): string {
  const folder = folderSegment(ownerId, 'cv')
  return `${folder}/${now}-${storageObjectName(originalName, 'cv')}`
}

/** Same filename rules as CV uploads. The `whatsapp/<chat>/` prefix is unchanged. */
export function waMediaObjectPath(chatKey: string, originalName: string, now = Date.now()): string {
  const folder = folderSegment(chatKey, 'file')
  return `whatsapp/${folder}/${now}-${storageObjectName(originalName, 'file')}`
}

/** Original name for Content-Disposition. Slashes and quotes are removed; Hebrew stays. */
export function downloadFileName(originalName: string): string {
  const base = basename(originalName)
    .replace(/["\\]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  return (base || 'cv').slice(0, 180)
}

export function contentDisposition(kind: 'inline' | 'attachment', originalName: string): string {
  const name = downloadFileName(originalName)
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '') || 'file'
  const star = encodeURIComponent(name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${star}`
}

/** Parse a stored pointer. The path is returned as stored, including older non-ASCII keys. */
export function storageObjectPath(url: string): { bucket: string; path: string } | null {
  const prefixed = url.match(/^(wa-media|cvs):(.+)$/)
  if (prefixed) return { bucket: prefixed[1], path: prefixed[2] }
  const hosted = url.match(/\/storage\/v1\/object\/(?:public|sign)\/(wa-media|cvs)\/([^?]+)/)
  if (!hosted) return null
  return { bucket: hosted[1], path: decodeURIComponent(hosted[2]) }
}
