/**
 * Backend connectivity, end to end.
 *
 * Polls `GET /ready` — not `/health` (see `client.ts`'s `checkReady` and
 * `main.py`'s own comment for why liveness and readiness are different
 * questions) — and shows a calm banner while trouble is suspected. Two
 * failure shapes read very differently to a student, so they get distinct
 * copy and distinct urgency:
 *
 *   - **waking** — the server answered, but isn't ready yet (`ready: false`
 *     while the database or embeddings catch up). Almost always a Render
 *     cold start finishing, so this polls quickly and says so without alarm.
 *   - **offline** — several polls in a row got no answer at all. A real
 *     "can't reach it" state, debounced against a single blip and then
 *     backed off exponentially so a genuine outage isn't hammered.
 *
 * On the offline/waking → online transition, fires `notifyBackendReady()`
 * (`lib/connectivity.ts`) so any screen sitting on a failed load —
 * `useAsync`'s own reconnect hook — retries itself with no action from the
 * student.
 */

import { useEffect, useState } from 'react'
import { checkReady, type Readiness } from '../../api/client'
import { notifyBackendReady } from '../../lib/connectivity'
import { cn } from '../../lib/cn'
import { Icon } from '../ui/Icon'

type Phase = 'online' | 'waking' | 'offline'

/** Steady-state heartbeat once everything's healthy. */
const HEALTHY_POLL_MS = 15_000
/** Retry cadence once the server has answered but isn't ready yet — fast,
 *  because a cold start finishing is usually seconds away, not minutes. */
const WAKING_POLL_MS = 2_500
/** Backoff ladder once the server can't be reached at all — a real outage
 *  should be checked on less often the longer it lasts, not hammered. */
const OFFLINE_POLL_MS = [3_000, 6_000, 12_000, 20_000]
/** Consecutive unreachable polls before showing "offline" — one blip is not
 *  an outage and shouldn't flash a banner over it. */
const REQUIRED_FAILURES = 2

export function OfflineBanner() {
  const [phase, setPhase] = useState<Phase>('online')
  const [detail, setDetail] = useState<Readiness | null>(null)

  useEffect(() => {
    let mounted = true
    let timer: number | undefined
    let failures = 0
    // Whether the *last* poll reported anything other than a clean "ready" —
    // tracked outside React state so the read is synchronous inside the same
    // tick a fresh success is discovered, with no stale-closure risk.
    let hadTrouble = false

    const schedule = (ms: number) => {
      if (mounted) timer = window.setTimeout(poll, ms)
    }

    const poll = async () => {
      const result = await checkReady()
      if (!mounted) return

      if (result === null) {
        failures += 1
        if (failures >= REQUIRED_FAILURES) {
          hadTrouble = true
          setPhase('offline')
          setDetail(null)
        }
        schedule(OFFLINE_POLL_MS[Math.min(failures - 1, OFFLINE_POLL_MS.length - 1)])
        return
      }

      failures = 0
      if (!result.ready) {
        hadTrouble = true
        setPhase('waking')
        setDetail(result)
        schedule(WAKING_POLL_MS)
        return
      }

      if (hadTrouble) notifyBackendReady()
      hadTrouble = false
      setPhase('online')
      setDetail(null)
      schedule(HEALTHY_POLL_MS)
    }

    void poll()
    return () => {
      mounted = false
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  if (phase === 'online') return null

  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center gap-2 px-4 py-2 text-center text-xs',
        phase === 'waking' ? 'bg-sun-soft text-sun-deep' : 'bg-coral-soft text-coral-deep',
      )}
    >
      {phase === 'waking' ? (
        <>
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-sun-deep motion-safe:animate-pulse"
          />
          {wakingCopy(detail)}
        </>
      ) : (
        <>
          <Icon name="offline" size={13} className="shrink-0" />
          We can't reach the server right now — your changes will retry automatically.
        </>
      )}
    </div>
  )
}

/** A little more specific than a bare "waking up" whenever `/ready`'s own
 *  breakdown says why — still one calm sentence, never a stack trace. */
function wakingCopy(detail: Readiness | null): string {
  if (detail && !detail.database) {
    return 'Reconnecting to the database — should just be a moment.'
  }
  if (detail && !detail.embeddings) {
    return 'Warming up search — almost there.'
  }
  return 'Waking up the server — this can take up to a minute on the first request.'
}
