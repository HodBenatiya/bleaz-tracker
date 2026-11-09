import { supabase } from './supabase'

export function storageObjectPath(url: string): { bucket: string; path: string } | null {
  const prefixed = url.match(/^(wa-media|cvs):(.+)$/)
  if (prefixed) return { bucket: prefixed[1], path: prefixed[2] }
  const hosted = url.match(/\/storage\/v1\/object\/(?:public|sign)\/(wa-media|cvs)\/([^?]+)/)
  if (!hosted) return null
  return { bucket: hosted[1], path: decodeURIComponent(hosted[2]) }
}

export async function signedStorageUrl(url: string): Promise<string> {
  const ref = storageObjectPath(url)
  if (!ref) return url
  const { data, error } = await supabase.storage.from(ref.bucket).createSignedUrl(ref.path, 60 * 60)
  if (error || !data?.signedUrl) throw error || new Error('signed url failed')
  return data.signedUrl
}
