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

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getStudentModel } from '../../api/me'
import { useAuth } from '../../auth/AuthProvider'
import { holdBootSplash } from '../../lib/bootSplash'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { hasPreferences, hasSkippedLocally } from './state'

type Verdict = 'checking' | 'needs-intake' | 'ready'

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const location = useLocation()
  const userId = session?.user?.id ?? null
  const [verdict, setVerdict] = useState<Verdict>('checking')
  /* Captured once, at mount: was the boot splash still on screen when this
     gate first rendered? Decides whether "still checking" should show nothing
     (the splash has it covered) or a spinner (nothing else is there). A ref
     rather than a render-time DOM read, so the answer cannot change mid-render
     as the splash tears down underneath us. */
  const splashWasUp = useRef(
    typeof document !== 'undefined' && document.getElementById('boot') !== null,
  )

  /**
   * Hold the boot splash for as long as this gate is undecided.
   *
   * `useLayoutEffect`, not `useEffect`, and the distinction is load-bearing:
   * `AuthProvider` calls `hideBootSplash()` the moment auth resolves, which
   * schedules the teardown on a timer. Layout effects run in the same commit,
   * before any timer can fire — so the hold is always registered before the
   * splash could act on that request. A passive effect would sometimes lose
   * that race and let the splash go, which is the bug being fixed.
   */
  useLayoutEffect(() => {
    if (verdict !== 'checking') return
    return holdBootSplash()
  }, [verdict])

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

  // One loading screen at a time, whichever one is actually on screen.
  //
  // On a cold start the boot splash is still up — held by the effect above —
  // so a second, generic spinner stacked on top of it is what produced the
  // custom-splash-then-circular-spinner sequence. Render nothing and let the
  // splash do its job.
  //
  // But this gate also mounts warm: returning from Google lands on `/home`
  // with the app long since booted and no splash to hide behind, and there
  // `null` is a blank screen. So the fallback depends on which is true, decided
  // once at mount rather than read during every render.
  if (verdict === 'checking') {
    return splashWasUp.current ? null : <PageSpinner label="Loading…" />
  }
  // Already on the intake — rendering a redirect to it would loop.
  if (verdict === 'needs-intake' && location.pathname !== '/welcome-aboard') {
    return <Navigate to="/welcome-aboard" replace />
  }
  return <>{children}</>
}
