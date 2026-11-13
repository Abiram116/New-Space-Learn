import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { useHandoffPlaying } from '../features/transitions/Handoff'
import { FirstPaintFallback } from '../components/ui/FirstPaint'
import { ConfigMissing } from '../components/ui/ConfigMissing'

/** Renders children only when the visitor has a session; otherwise → /signin. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session, supabaseConfigured } = useAuth()
  const location = useLocation()
  if (!supabaseConfigured) return <ConfigMissing />
  if (loading) return <FirstPaintFallback label="Checking your session…" />
  if (!session) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/signin?next=${encodeURIComponent(returnTo)}`} replace />
  }
  return <>{children}</>
}

/** Inverse — sends already-authed users home so /signin doesn't flash. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { loading, session, supabaseConfigured } = useAuth()
  // A first-run handoff navigates on its own schedule, and signing up makes
  // you authenticated — so without this the guard bounced brand-new accounts
  // to `/home` mid-transition while the handoff was still heading for the
  // intake. Whichever won was down to render order. While a handoff is
  // playing it owns navigation; see `useHandoffPlaying`.
  const handingOff = useHandoffPlaying()
  // Already signed in and sent here with somewhere to go (`/signin?next=/notes`):
  // go there. Only in-app paths, so a crafted link can't send anyone off-site.
  const asked = new URLSearchParams(useLocation().search).get('next')
  const next = asked && asked.startsWith('/') && !asked.startsWith('//') ? asked : '/home'
  if (!supabaseConfigured) return <>{children}</>
  if (loading) return <FirstPaintFallback />
  if (session && !handingOff) return <Navigate to={next} replace />
  return <>{children}</>
}
