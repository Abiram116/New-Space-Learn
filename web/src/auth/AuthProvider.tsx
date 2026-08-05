/**
 * Session context.
 *
 * Wraps the whole app. Exposes `{ session, user, loading, signOut }` and
 * feeds the current access token into the API client so every request is
 * authenticated without views needing to think about it.
 */

import type { ReactNode } from 'react'
import { clearBriefCache } from '../lib/briefCache'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getSession, onAuthChange, signOut, type Session } from '../api/auth'
import { setAuthTokenProvider } from '../api/client'
import { setUploadTokenProvider } from '../api/documents'
import { SUPABASE_CONFIGURED } from '../lib/env'

type AuthValue = {
  session: Session | null
  user: Session['user'] | null
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
