import type { VoiceFacts, VoiceSituation } from '../../lib/botVoice'
import type { AgentId } from './agents'
import { BotSays } from './BotSays'
import type { BotMood } from './moods'
import { useBotLine } from './useBotLine'

/**
 * A companion reacting to something that just happened: the right one for the
 * job (Pop for a quiz, Flip for a card session, Jot for a note), with a mood
 * to match and a line from their own voice. The line is drawn from real facts
 * only (`botVoice` enforces that), and it is real text, so it reads the same
 * with the bots turned off.
 */
export function Reaction({
  agent,
  situation,
  facts,
  mood,
  size = 56,
  lineKey,
  className,
}: {
  agent: AgentId
  situation: VoiceSituation
  facts?: VoiceFacts
  mood: BotMood
  size?: number
  /** Changes when this is a new moment (a new attempt), so the line is picked again. */
  lineKey?: string | number
  className?: string
}) {
  const line = useBotLine(situation, agent, facts, lineKey)
  return (
    <BotSays agent={agent} mood={mood} size={size} lineKey={line} live className={className}>
      {line}
    </BotSays>
  )
}
