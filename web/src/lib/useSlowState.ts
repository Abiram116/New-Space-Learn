/**
 * Turns a plain "is this still pending" boolean into a time-aware phase, so a
 * screen can be honest about *why* it's still waiting instead of showing an
 * undifferentiated spinner for however long a cold Render instance takes.
 *
 * `docs/operations/performance-and-cost.md` documents a real ~30-60s cold
 * start on the free plan. A skeleton that looks identical at 200ms and at
 * 25s reads as broken, not slow — and giving every screen its own guess at
 * where to draw that line is how three screens end up with three different
 * thresholds and none of them matching what actually happens in prod. This
 * hook is the one place that draws it:
 *
 *   'idle'    — `pending` is false.
 *   'fast'    — pending, under `SLOW_MS`: show the ordinary skeleton, say
 *               nothing extra. Most requests never leave this phase.
 *   'slow'    — `SLOW_MS`..`STALLED_MS`: say so — "waking up the server" is
 *               honest and, on this host, usually correct.
 *   'stalled' — past `STALLED_MS`: reassure, and offer a manual retry —
 *               at some point "just wait" stops being good advice.
 *
 * Used directly by `AsyncState` below; screens with a bespoke layout that
 * doesn't fit that wrapper (Home, Profile) call this themselves and slot the
 * phase into their own skeleton, same idea either way.
 */

import { useEffect, useRef, useState } from 'react'

export type SlowPhase = 'idle' | 'fast' | 'slow' | 'stalled'

/** Above this with no answer yet, the wait is worth naming — see the module
 *  doc. Short enough that a genuinely fast connection never sees it; long
 *  enough that it doesn't flicker on for an ordinary sub-second request. */
export const SLOW_MS = 3_000

/** Above this, "the server is waking up" stops being reassurance on its own
 *  and needs an actual way out. */
export const STALLED_MS = 20_000

export function useSlowState(pending: boolean): SlowPhase {
  const [phase, setPhase] = useState<SlowPhase>(pending ? 'fast' : 'idle')
  // Guards against a timer firing after `pending` already flipped back to
  // false in the same tick it was scheduled from a stale closure — belt and
  // braces alongside the cleanup below, cheap enough not to matter either way.
  const tokenRef = useRef(0)

  useEffect(() => {
    const token = ++tokenRef.current
    if (!pending) {
      setPhase('idle')
      return
    }
    setPhase('fast')
    const slow = window.setTimeout(() => {
      if (tokenRef.current === token) setPhase('slow')
    }, SLOW_MS)
    const stalled = window.setTimeout(() => {
      if (tokenRef.current === token) setPhase('stalled')
    }, STALLED_MS)
    return () => {
      window.clearTimeout(slow)
      window.clearTimeout(stalled)
    }
  }, [pending])

  return phase
}
