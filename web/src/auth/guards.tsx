import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { PageSpinner } from '../components/ui/PageSpinner'
import { ConfigMissing } from '../components/ui/ConfigMissing'

/** Renders children only when the visitor has a session; otherwise → /signin. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session, supabaseConfigured } = useAuth()
  const location = useLocation()
  if (!supabaseConfigured) return <ConfigMissing />
  if (loading) return <PageSpinner label="Checking your session…" />
  if (!session) {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate to={`/signin?next=${encodeURIComponent(returnTo)}`} replace />
  }
  return <>{children}</>
}

/** Inverse — sends already-authed users home so /signin doesn't flash. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { loading, session, supabaseConfigured } = useAuth()
  if (!supabaseConfigured) return <>{children}</>
  if (loading) return <PageSpinner />
  if (session) return <Navigate to="/" replace />
  return <>{children}</>
}
