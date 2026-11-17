import { isViewer } from './accessMode'
import { supabase } from './supabase'
import { downloadFileName, storageObjectPath } from './storageKey'

export { storageObjectPath }

export async function signedStorageUrl(url: string, downloadName?: string): Promise<string> {
  if (isViewer()) throw new Error('צפייה בלבד — אין הורדת קבצים')
  const ref = storageObjectPath(url)
  if (!ref) return url
  const filename = downloadName ? downloadFileName(downloadName) : ''
  const { data, error } = await supabase.storage.from(ref.bucket).createSignedUrl(
    ref.path,
    60 * 60,
    filename ? { download: filename } : undefined,
  )
  if (error || !data?.signedUrl) throw error || new Error('signed url failed')
  return data.signedUrl
}
