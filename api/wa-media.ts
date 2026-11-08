import { findStoredMedia, openStoredMedia } from './_ingest.js'
import { downloadIncomingMedia, redactError } from './_provider.js'

function queryValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })
  const id = queryValue(req.query?.id)
  if (!id) return res.status(400).json({ error: 'missing id' })
  try {
    const stored = await findStoredMedia(id)
    if (!stored) return res.status(404).json({ error: 'not found' })
    if (stored.filePath) {
      const signed = await openStoredMedia(stored.filePath)
      if (signed) {
        res.statusCode = 302
        res.setHeader('Location', signed)
        res.setHeader('Cache-Control', 'private, max-age=300')
        return res.end()
      }
    }
    if (stored.fileUrl && /^https?:\/\//.test(stored.fileUrl) && !stored.fileUrl.includes('/api/files/')) {
      res.statusCode = 302
      res.setHeader('Location', stored.fileUrl)
      return res.end()
    }
    const file = await downloadIncomingMedia({
      id,
      chatId: stored.chatId || '',
      direction: 'in',
      text: '',
      timestamp: new Date().toISOString(),
      type: (stored.type as 'image') || 'document',
      mimeType: stored.mimeType,
      fileName: stored.fileName,
      hasMedia: true,
      source: 'waha',
    })
    if (!file) return res.status(404).json({ error: 'media unavailable' })
    const download = queryValue(req.query?.download) === '1'
    const filename = (stored.fileName || 'file').replace(/["\r\n]/g, '')
    res.statusCode = 200
    res.setHeader('Content-Type', file.mime)
    res.setHeader('Content-Length', String(file.bytes.byteLength))
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    return res.end(Buffer.from(file.bytes))
  } catch (err) {
    console.error('wa-media', redactError(err))
    return res.status(500).json({ error: 'media failed' })
  }
}
