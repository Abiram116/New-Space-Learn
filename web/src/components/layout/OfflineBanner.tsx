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
 *
 * Nova tells it: asleep while the server wakes (with one of its waking
 * lines, then the specific cause when `/ready` names one), an "oops" face
 * when it can't be reached, and — only after real trouble — a short "back"
 * beat (waking → happy) before the strip goes, so recovery is seen rather
 * than inferred from a banner vanishing. With the bots off it is the same
 * strip in plain words.
 */

import { useEffect, useState } from 'react'
import { checkReady, type Readiness } from '../../api/client'
import { notifyBackendReady } from '../../lib/connectivity'
import { cn } from '../../lib/cn'
import { useBotsShown } from '../../lib/botPreference'
import { Bot } from '../mascot/Bot'
import { useBotLine } from '../mascot/useBotLine'
import { useBotMood, type BotSituation } from '../mascot/useBotMood'
import { Icon } from '../ui/Icon'

type Phase = 'online' | 'waking' | 'offline' | 'back'

/** How long the "we're back" beat holds: long enough for the bot to wake
 *  (useBotMood's `wakeMs`) and smile, short enough not to linger. */
export const BACK_MS = 3_400

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
  // A new waking line per episode of trouble, not per poll.
  const [episode, setEpisode] = useState(0)

  useEffect(() => {
    let mounted = true
    let timer: number | undefined
    let backTimer: number | undefined
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
          if (!hadTrouble) setEpisode((n) => n + 1)
          hadTrouble = true
          window.clearTimeout(backTimer)
          setPhase('offline')
          setDetail(null)
        }
        schedule(OFFLINE_POLL_MS[Math.min(failures - 1, OFFLINE_POLL_MS.length - 1)])
        return
      }

      failures = 0
      if (!result.ready) {
        if (!hadTrouble) setEpisode((n) => n + 1)
        hadTrouble = true
        window.clearTimeout(backTimer)
        setPhase('waking')
        setDetail(result)
        schedule(WAKING_POLL_MS)
        return
      }

      if (hadTrouble) {
        notifyBackendReady()
        setPhase('back')
        window.clearTimeout(backTimer)
        backTimer = window.setTimeout(() => mounted && setPhase('online'), BACK_MS)
      } else {
        setPhase((p) => (p === 'back' ? p : 'online'))
      }
      hadTrouble = false
      setDetail(null)
      schedule(HEALTHY_POLL_MS)
    }

    void poll()
    return () => {
      mounted = false
      if (timer) window.clearTimeout(timer)
      window.clearTimeout(backTimer)
    }
  }, [])

  return <Strip phase={phase} detail={detail} episode={episode} />
}

const SITUATION: Record<Phase, BotSituation> = {
  online: 'idle',
  waking: 'asleep',
  offline: 'error',
  back: 'success',
}

function Strip({ phase, detail, episode }: { phase: Phase; detail: Readiness | null; episode: number }) {
  const botsOn = useBotsShown()
  const mood = useBotMood(SITUATION[phase], { ambient: false, settleMs: 0 })
  const wakingLine = useBotLine('waking', 'tutor', {}, episode)

  if (phase === 'online') return null

  const tone =
    phase === 'waking' ? 'bg-sun-soft text-sun-deep' : phase === 'back' ? 'bg-jade-soft text-jade-deep' : 'bg-coral-soft text-coral-deep'

  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center gap-2.5 px-4 text-center text-xs',
        botsOn ? 'py-1' : 'py-2',
        tone,
      )}
    >
      {/* 40px on a strip that is otherwise one line of 12px type: the bot sits
          in the strip's own height rather than a second row. */}
      <Bot agent="tutor" mood={mood} size={40} className="-my-0.5" />
      {!botsOn && phase === 'waking' && (
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-sun-deep motion-safe:animate-pulse" />
      )}
      {!botsOn && phase === 'offline' && <Icon name="offline" size={13} className="shrink-0" />}
      {!botsOn && phase === 'back' && <Icon name="check" size={13} className="shrink-0" />}
      <span className="min-w-0 text-balance">
        {phase === 'waking' ? (
          <>
            <span className="font-semibold">{wakingLine}</span> {wakingCopy(detail)}
          </>
        ) : phase === 'back' ? (
          'You’re back online!'
        ) : (
          "We can't reach the server right now. We'll keep trying."
        )}
      </span>
    </div>
  )
}

/** A little more specific than a bare "waking up" whenever `/ready`'s own
 *  breakdown says why — still one calm sentence, never a stack trace. */
function wakingCopy(detail: Readiness | null): string {
  if (detail && !detail.database) {
    return 'Getting things connected. This should only take a moment.'
  }
  if (detail && !detail.embeddings) {
    return 'Getting things ready. Almost there.'
  }
  return 'It can take up to a minute to wake up after a quiet spell.'
}
