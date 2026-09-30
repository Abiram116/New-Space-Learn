import { useMemo } from 'react'
import { pickLine, type VoiceFacts, type VoiceSituation } from '../../lib/botVoice'
import type { AgentId } from './agents'

/**
 * One line for this moment, held steady across re-renders: a new line is
 * picked only when the situation, the agent, a fact or `key` changes — never
 * because a parent re-rendered. `key` is for "same situation, new moment"
 * (a retried run, a new waking episode).
 */
export function useBotLine(
  situation: VoiceSituation,
  agent: AgentId = 'tutor',
  facts: VoiceFacts = {},
  key?: string | number | null,
): string {
  const { name, count, score, streak, hour, surface, personal } = facts
  return useMemo(
    () => pickLine(situation, agent, { name, count, score, streak, hour, surface, personal }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the point
    [situation, agent, name, count, score, streak, hour, surface, personal, key],
  )
}
