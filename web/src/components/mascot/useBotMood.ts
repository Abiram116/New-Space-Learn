import { useEffect, useRef, useState } from 'react'
import type { BotMood } from './moods'
import { prefersReducedMotion } from './runtime'

/** App situations, in the app's words. */
export type BotSituation = 'idle' | 'loading' | 'slow' | 'error' | 'success' | 'celebrate' | 'asleep'

export const SITUATION_MOOD: Record<BotSituation, BotMood> = {
  idle: 'idle',
  loading: 'working',
  slow: 'thinking',
  error: 'oops',
  success: 'happy',
  celebrate: 'celebrate',
  asleep: 'sleepy',
}

export interface BotMoodOptions {
  /** Leaving `asleep` plays `waking` for this long first (0 skips it). */
  wakeMs?: number
  /** `success` / `celebrate` settle back to idle after this long (0 = hold). */
  settleMs?: number
  /** While idle, occasionally glance around. Off under reduced motion. */
  ambient?: boolean
}

const SETTLES: ReadonlySet<BotSituation> = new Set(['success', 'celebrate'])

/**
 * Situation → mood, with the in-between beats the raw map can't express:
 * waking up before answering, settling after a win, glancing around at rest.
 * State changes only at those beats — never per frame.
 */
export function useBotMood(situation: BotSituation, opts: BotMoodOptions = {}): BotMood {
  const { wakeMs = 2400, settleMs = 3600, ambient = true } = opts
  const [mood, setMood] = useState<BotMood>(SITUATION_MOOD[situation])
  const prev = useRef(situation)

  useEffect(() => {
    const was = prev.current
    prev.current = situation
    const timers: number[] = []
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
    const base = SITUATION_MOOD[situation]

    const rest = () => {
      setMood('idle')
      if (!ambient || prefersReducedMotion()) return
      const glance = () => {
        at(14000, () => {
          setMood('lookaround')
          at(6500, () => {
            setMood('idle')
            glance()
          })
        })
      }
      glance()
    }
    const arrive = () => {
      if (situation === 'idle') return rest()
      setMood(base)
      if (SETTLES.has(situation) && settleMs > 0) at(settleMs, rest)
    }

    if (was === 'asleep' && situation !== 'asleep' && wakeMs > 0) {
      setMood('waking')
      at(wakeMs, arrive)
    } else {
      arrive()
    }
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [situation, wakeMs, settleMs, ambient])

  return mood
}
