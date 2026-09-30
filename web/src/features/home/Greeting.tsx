/**
 * Nova at the top of Home (desktop) and Today (phone).
 *
 * The brief is the page's real opening — where the student stands, in their
 * own material's terms — so Nova never repeats it. Two shapes:
 *
 *   - `NovaHello`: the brief doesn't greet, so Nova does, in one short line
 *     above it (a wave on arrival, then rest).
 *   - `NovaBeside`: the brief's headline already says hello, so Nova just
 *     stands beside it and waves. No second hello.
 *
 * While the brief is slow Nova shows it (thinking, then asleep once it has
 * stalled) — the caption under the skeleton says why in words.
 */

import type { ReactNode } from 'react'
import { Bot } from '../../components/mascot/Bot'
import { BotSays } from '../../components/mascot/BotSays'
import type { BotMood } from '../../components/mascot/moods'
import { useBotLine } from '../../components/mascot/useBotLine'
import { useArrivalMood } from '../../components/mascot/useBotMood'
import { cn } from '../../lib/cn'
import type { SlowPhase } from '../../lib/useSlowState'

function useHelloMood(phase: SlowPhase | undefined): BotMood {
  const arrival = useArrivalMood('wave')
  if (phase === 'stalled') return 'sleepy'
  if (phase === 'slow') return 'thinking'
  return arrival
}

export function NovaHello({
  name,
  phase,
  size = 48,
  className,
}: {
  name: string
  /** The brief's load phase, when it is still loading. */
  phase?: SlowPhase
  size?: number
  className?: string
}) {
  const mood = useHelloMood(phase)
  const line = useBotLine('greeting', 'tutor', { name, surface: 'home', personal: true })
  return (
    <BotSays agent="tutor" mood={mood} size={size} lineKey={line} className={cn('nova-hello', className)}>
      {line}
    </BotSays>
  )
}

export function NovaBeside({
  children,
  size = 56,
  className,
}: {
  children: ReactNode
  size?: number
  className?: string
}) {
  const mood = useHelloMood(undefined)
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <Bot agent="tutor" mood={mood} size={size} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** Does the brief's headline already greet the student? */
export function briefIsGreeting(headline: string | undefined, name: string): boolean {
  if (!headline) return false
  if (/^(good (morning|afternoon|evening|night)|hi|hello|hey|welcome|morning|evening)\b/i.test(headline.trim())) return true
  return Boolean(name) && headline.toLowerCase().includes(name.toLowerCase())
}
