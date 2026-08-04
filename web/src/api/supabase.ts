/**
 * Lazy Supabase-JS singleton.
 *
 * We defer creation until first use so a missing config doesn't blow up at
 * module import time (which would prevent even the config-missing UI from
 * rendering). Callers should catch `ConfigError` and show a friendly card.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig, SUPABASE_CONFIGURED } from '../lib/env'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) {
    const { url, anonKey } = getSupabaseConfig()
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}

export { SUPABASE_CONFIGURED }
