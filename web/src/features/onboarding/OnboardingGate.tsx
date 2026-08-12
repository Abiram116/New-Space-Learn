/**
 * Sends a brand-new account to the intake before it can reach the app.
 *
 * A dashboard of zeroes is the worst possible first screen: it teaches someone
 * the product is empty at the exact moment they are deciding whether it is
 * worth their time. One short conversation first means the app knows something
 * about them before it shows them anything.
 *
 * **Fails open, always.** If the check errors, times out, or the backend is
 * cold, the student goes to the app. A gate that can lock someone out of the
 * product they just signed up for is far worse than one that occasionally
 * misses an intake — and the intake is recoverable (Settings has every field),
 * while a login that goes nowhere is not.
 */

import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getStudentModel } from '../../api/me'
import { useAuth } from '../../auth/AuthProvider'
import { FirstPaintFallback } from '../../components/ui/FirstPaint'
import { hasPreferences, hasSkippedLocally } from './state'

type Verdict = 'checking' | 'needs-intake' | 'ready'

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const location = useLocation()
  const userId = session?.user?.id ?? null
  const [verdict, setVerdict] = useState<Verdict>('checking')

  useEffect(() => {
    let live = true
    if (!userId) {
      setVerdict('ready')
      return
    }
    // Someone who skipped has nothing stored to distinguish them from a new
    // account, so the local flag is checked first and short-circuits the read.
    if (hasSkippedLocally(userId)) {
      setVerdict('ready')
      return
    }
    getStudentModel()
      .then((model) => {
        if (live) setVerdict(hasPreferences(model) ? 'ready' : 'needs-intake')
      })
      .catch(() => {
        // See the note above: any failure means "let them in".
        if (live) setVerdict('ready')
      })
    return () => {
      live = false
    }
  }, [userId])

  // `FirstPaintFallback` owns the "which loading screen" decision and the
  // splash hold. This gate had its own copy of both; two implementations of
  // "is the splash still up" is how one of them ends up wrong.
  if (verdict === 'checking') {
    return <FirstPaintFallback label="Loading…" />
  }
  // Already on the intake — rendering a redirect to it would loop.
  if (verdict === 'needs-intake' && location.pathname !== '/welcome-aboard') {
    return <Navigate to="/welcome-aboard" replace />
  }
  return <>{children}</>
}
