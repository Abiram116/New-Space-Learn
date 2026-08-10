/**
 * Session context.
 *
 * Wraps the whole app. Exposes `{ session, user, loading, signOut }` and
 * feeds the current access token into the API client so every request is
 * authenticated without views needing to think about it.
 */

import type { ReactNode } from 'react'
import { clearBriefCache } from '../lib/briefCache'
import { hideBootSplash } from '../lib/bootSplash'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getSession, onAuthChange, signOut, updateDisplayName, type Session } from '../api/auth'
import { setAuthTokenProvider } from '../api/client'
import { setUploadTokenProvider } from '../api/documents'
import { SUPABASE_CONFIGURED } from '../lib/env'
import { warmApi } from '../lib/warmApi'

type AuthValue = {
  session: Session | null
  user: Session['user'] | null
  /** Rename yourself. The rail, Profile and the brief all read this. */
  setDisplayName: (name: string) => Promise<void>
  loading: boolean
  ready: boolean
  supabaseConfigured: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED)
  const tokenRef = useRef<string | null>(null)

  // Wire the token provider once — the client uses it on every request.
  useEffect(() => {
    setAuthTokenProvider(() => tokenRef.current)
    setUploadTokenProvider(() => tokenRef.current)
  }, [])

  // This wraps the whole app above the router (see main.tsx), so it mounts on
  // every load — including a student who bookmarks straight into `/home` and
  // never sees Landing or the auth pages. That path previously got zero
  // warm-up at all. Firing here means the free-tier backend's cold start
  // overlaps with getSession() below rather than starting only once AppShell
  // mounts and immediately races the real data fetch it triggers — see
  // docs/operations/performance-and-cost.md §6 for why a ping *inside* AppShell doesn't help.
  useEffect(warmApi, [])

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return

    let mounted = true

    getSession()
      .then((s) => {
        if (!mounted) return
        setSession(s)
        tokenRef.current = s?.access_token ?? null
      })
      .catch(() => {
        if (!mounted) return
        setSession(null)
        tokenRef.current = null
      })
      .finally(() => {
        if (mounted) setLoading(false)
        // The splash's real exit condition. Routing depends on knowing
        // whether there is a session, so this is the first moment the app can
        // paint the correct page rather than a frame of the wrong one.
        hideBootSplash()
      })

    const { data: sub } = onAuthChange((_event, s) => {
      setSession(s)
      tokenRef.current = s?.access_token ?? null
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      ready: !loading,
      supabaseConfigured: SUPABASE_CONFIGURED,
      setDisplayName: async (name) => {
        await updateDisplayName(name)
        // No manual refresh: Supabase emits USER_UPDATED, and the
        // `onAuthChange` subscription above already writes the new session
        // into state. Setting it here too would just race with that.
      },
      signOut: async () => {
        // The next person to sign in on this browser must not inherit the
        // previous user's personalised brief.
        clearBriefCache()
        await signOut()
        setSession(null)
        tokenRef.current = null
      },
    }),
    [session, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
