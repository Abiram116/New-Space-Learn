/**
 * Lazy Supabase auth singleton — auth ONLY, deliberately.
 *
 * The browser uses Supabase for exactly one thing: sign-in and the session.
 * Every database read, storage upload and model call goes through our own
 * backend with its service key. Yet `createClient` from `@supabase/supabase-js`
 * ships its database, storage and realtime clients regardless — measured at
 * 868K of source in a chunk that loads on EVERY page, because every page has
 * to know whether you're signed in. `AuthClient` is the same class the full
 * SDK wraps (`SupabaseAuthClient extends AuthClient`), published standalone.
 *
 * **Configured to match `createClient` byte for byte** — read from
 * supabase-js 2.112's own `_initSupabaseAuthClient`, not guessed. The one that
 * matters most is `storageKey`: the session lives in localStorage under it,
 * and a different key would silently sign out every existing user on the
 * first deploy. Same URL, same two headers, same four defaults.
 *
 * Creation stays deferred so a missing config can't blow up at import time
 * (which would prevent even the config-missing UI from rendering). Callers
 * should catch `ConfigError` and show a friendly card.
 */

import { AuthClient, type GoTrueClient } from '@supabase/auth-js'
import { getSupabaseConfig, SUPABASE_CONFIGURED } from '../lib/env'

/** The shape every caller already uses — `getSupabase().auth.*` — so none of
 *  the twelve call sites change. */
export type SupabaseAuthOnly = { auth: GoTrueClient }

let client: SupabaseAuthOnly | null = null

export function getSupabase(): SupabaseAuthOnly {
  if (!client) {
    const { url, anonKey } = getSupabaseConfig()
    const base = new URL(url)
    client = {
      auth: new AuthClient({
        url: new URL('auth/v1', base).href,
        headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
        // supabase-js's `defaultStorageKey`. Do not change: see header.
        storageKey: `sb-${base.hostname.split('.')[0]}-auth-token`,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
      }),
    }
  }
  return client
}

export { SUPABASE_CONFIGURED }
