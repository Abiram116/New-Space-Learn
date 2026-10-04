import { useEffect, useState } from 'react'
import { BotProgress } from '../../components/mascot/BotProgress'
import type { AgentId } from '../../components/mascot/agents'
import { useBotLine } from '../../components/mascot/useBotLine'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { AGENT_DONE_CTA, type AgentKey } from './agents'
import { CARD_COUNT, QUIZ_COUNT, type AgentRun } from './useAgentRuns'

/** After this long, say why it is taking a while instead of leaving a bar. */
export const SLOW_AFTER_S = 6

/** Which bot does which job: Flip deals cards, Pop writes quizzes, Jot notes. */
export const AGENT_BOT: Record<AgentKey, AgentId> = {
  flashcards: 'cards',
  quiz: 'quiz',
  notes: 'notes',
}

/** What the run was asked to make — the only number "generating" may say. */
const REQUESTED: Partial<Record<AgentKey, number>> = { flashcards: CARD_COUNT, quiz: QUIZ_COUNT }

/** True once a running run has gone `SLOW_AFTER_S` without an answer. */
function useSlowRun(startedAt: number, running: boolean): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    setSlow(false)
    if (!running) return
    const left = startedAt + SLOW_AFTER_S * 1000 - Date.now()
    if (left <= 0) {
      setSlow(true)
      return
    }
    const t = window.setTimeout(() => setSlow(true), left)
    return () => window.clearTimeout(t)
  }, [startedAt, running])
  return slow
}

/**
 * The in-thread receipt for an agent run, told by the agent who is doing it:
 * the bot working with its own clock while the run is in flight, happy with
 * an obvious way in when it lands, and a non-blaming "oops" with Retry if it
 * fails. The facts (what was asked for, how many came back, what went wrong)
 * sit under the bot's line, so switching the bots off loses no information.
 * One polite live region for the whole card, so each change is heard once.
 */
export function AgentRunCard({
  run,
  onOpen,
  onRetry,
  onDismiss,
}: {
  run: AgentRun
  onOpen: (run: AgentRun) => void
  onRetry: (run: AgentRun) => void
  onDismiss: (run: AgentRun) => void
}) {
  const running = run.status === 'running'
  const slow = useSlowRun(run.startedAt, running)
  const agent = AGENT_BOT[run.agent]

  const situation = running ? 'generating' : run.status === 'done' ? 'success' : 'error'
  const count = running ? REQUESTED[run.agent] : run.status === 'done' ? run.count : undefined
  // A retry restarts the clock, so `startedAt` doubles as "a new moment".
  const line = useBotLine(situation, agent, { count }, run.startedAt)

  const mood = running ? (slow ? 'thinking' : 'working') : run.status === 'done' ? 'done' : 'oops'

  const detail = running ? (
    <>
      {run.title}
      {slow && <span> · Still working — the server can be slow to wake up</span>}
    </>
  ) : run.status === 'done' ? (
    <>
      {run.doneText} <span className="text-faint">· opening…</span>
    </>
  ) : (
    <span className="text-coral-deep">{run.error}</span>
  )

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'chat-run-card flex items-center gap-3 rounded-2xl border py-3 pl-3 pr-4',
        run.status === 'error' ? 'border-coral/40 bg-coral-soft' : 'border-line bg-raised',
      )}
    >
      <BotProgress
        agent={agent}
        mood={mood}
        size={48}
        line={line}
        detail={detail}
        startedAt={running ? run.startedAt : undefined}
        running={running}
        live={false}
        className="min-w-0 flex-1 [&_.bot-progress-line]:font-semibold"
      />

      {run.status === 'done' && run.href && (
        <button
          type="button"
          onClick={() => onOpen(run)}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-[13.5px] font-bold text-[#1a120f] transition hover:brightness-110 active:scale-95"
        >
          {AGENT_DONE_CTA[run.agent]} <Icon name="arrowRight" size={13} />
        </button>
      )}
      {run.status === 'error' && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onRetry(run)}
            className="flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-[13.5px] font-bold text-[#1a120f] transition hover:brightness-110 active:scale-95"
          >
            <Icon name="refresh" size={13} /> Retry
          </button>
          <button
            type="button"
            onClick={() => onDismiss(run)}
            aria-label="Dismiss"
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-line-soft hover:text-ink"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
