import type { AgentId } from './agents'
import { BotSays } from './BotSays'
import { useBotLine } from './useBotLine'
import { useSlowState } from '../../lib/useSlowState'

/**
 * The working bot for a list that is taking its time. Silent for the first
 * `SLOW_MS` (most loads never get here, and a character flashing on for a
 * 400ms request is noise); then the agent who owns the list says it's still
 * on it, and past `STALLED_MS` it admits the server is probably napping.
 * Sits above the caller's skeleton — the skeleton stays.
 */
export function SlowBot({
  pending,
  agent,
  size = 48,
  className,
}: {
  pending: boolean
  agent: AgentId
  size?: number
  className?: string
}) {
  const phase = useSlowState(pending)
  const stalled = phase === 'stalled'
  const line = useBotLine(stalled ? 'waking' : 'slow', agent, {}, phase)
  if (phase !== 'slow' && !stalled) return null
  return (
    <BotSays agent={agent} mood={stalled ? 'sleepy' : 'working'} size={size} live lineKey={line} className={className}>
      {line}
    </BotSays>
  )
}
