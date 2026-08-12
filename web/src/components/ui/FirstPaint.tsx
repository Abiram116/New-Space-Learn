/**
 * One loading screen, ever.
 *
 * The app has several things that can be "not ready yet" at startup — auth
 * resolving, a route chunk downloading, the onboarding gate deciding — and each
 * had grown its own full-page spinner. They are not mutually exclusive, so they
 * stacked: the boot splash covered the screen, a spinner rendered underneath
 * it, and the moment auth resolved the splash tore down and *revealed* the
 * spinner. Two loading screens back to back, the second one generic, which
 * makes the first look like decoration.
 *
 * The rule this enforces: while the boot splash is on screen it is the only
 * loading screen. Anything else that is waiting holds it up rather than drawing
 * over it. Once the splash is gone — a lazy chunk on a warm app, a route
 * entered by clicking — a spinner is the right answer again, because there is
 * nothing else on screen.
 *
 * Both halves matter. Rendering `null` unconditionally would leave a warm
 * navigation blank; rendering a spinner unconditionally is the bug above.
 */

import { useLayoutEffect, useRef } from 'react'
import { holdBootSplash } from '../../lib/bootSplash'
import { PageSpinner } from './PageSpinner'

export function FirstPaintFallback({ label }: { label?: string }) {
  /**
   * Captured once, at mount: was the splash still up when this began waiting?
   *
   * A ref rather than reading the DOM during render, so the answer cannot
   * change mid-render as the splash tears down underneath — which would let a
   * component render `null` on one pass and a spinner on the next for the same
   * wait.
   */
  const splashWasUp = useRef(
    typeof document !== 'undefined' && document.getElementById('boot') !== null,
  )

  /**
   * `useLayoutEffect`, and the distinction is load-bearing: `AuthProvider`
   * calls `hideBootSplash()` as soon as auth resolves, which schedules the
   * teardown on a timer. Layout effects run in the same commit, before any
   * timer can fire, so the hold is always registered before the splash could
   * act on that request. A passive effect would sometimes lose that race.
   */
  useLayoutEffect(() => {
    if (!splashWasUp.current) return
    return holdBootSplash()
  }, [])

  return splashWasUp.current ? null : <PageSpinner label={label} />
}
