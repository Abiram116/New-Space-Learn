import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { PageSpinner } from '../components/ui/PageSpinner'
// Lazy — a static import here would pull Landing back into the main bundle
// for signed-in users, who never see it. See routes/lazyRoutes.
import { Landing, Lazy } from './lazyRoutes'

/**
 * What lives at `/`.
 *
 * Signed in → straight into the app. A returning student should never have to
 * scroll past a marketing page to reach their cards; the pitch has already
 * done its job on them.
 *
 * Signed out → the landing page. This covers every case the pitch is for:
 * a first visit, a signed-out browser, a cleared cookie, or a session that
 * lapsed after a long time away.
 *
 * `/welcome` renders this same page unconditionally, so the pitch stays
 * linkable and shareable even while signed in.
 */
export function RootRoute() {
  const { session, loading } = useAuth()

  // Deciding before the session resolves would flash the wrong surface.
  if (loading) return <PageSpinner label="Loading…" />
  if (session) return <Navigate to="/home" replace />
  return (
    <Lazy>
      <Landing />
    </Lazy>
  )
}
