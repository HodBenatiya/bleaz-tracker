import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/** Server-side client. Uses the service role so RLS does not block webhooks and crons. */
export function db(): SupabaseClient {
  if (client) return client
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('missing supabase service role')
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}
