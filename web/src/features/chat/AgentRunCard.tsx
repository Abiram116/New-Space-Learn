import { useEffect, useState } from 'react'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { toneSoft, toneText } from '../../lib/tone'
import { AGENT_DONE_CTA, AGENT_ICON, AGENT_TONE } from './agents'
import type { AgentRun } from './useAgentRuns'

/** After this long, say why it is taking a while instead of leaving a bar. */
export const SLOW_AFTER_S = 6

/** Whole seconds since `startedAt`, ticking once a second while `active`. */
function useElapsed(startedAt: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active, startedAt])
  return Math.max(0, Math.floor((now - startedAt) / 1000))
}

/**
 * The in-thread receipt for an agent run: progress while it works, a result
 * with an obvious way in when it lands, and an error with Retry if it fails.
 * Announced politely so a screen reader hears each change once.
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
  const elapsed = useElapsed(run.startedAt, running)
  const tone = AGENT_TONE[run.agent]

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'chat-run-card flex flex-col gap-2.5 rounded-2xl border px-4 py-3.5',
        run.status === 'error' ? 'border-coral/40 bg-coral-soft' : 'border-line bg-raised',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
            run.status === 'error' ? 'bg-well text-coral-deep' : cn(toneSoft[tone], toneText[tone]),
          )}
        >
          <Icon
            name={run.status === 'done' ? 'check' : run.status === 'error' ? 'alert' : AGENT_ICON[run.agent]}
            size={17}
          />
        </span>

        <div className="min-w-0 flex-1">
          {running && (
            <>
              <p className="text-[15px] font-semibold leading-snug text-ink">{run.title}</p>
              <p className="mt-0.5 text-[13px] text-muted">
                {elapsed}s
                {elapsed >= SLOW_AFTER_S && (
                  <span> · Still working — the server can be slow to wake up</span>
                )}
              </p>
            </>
          )}
          {run.status === 'done' && (
            <p className="text-[15px] font-semibold leading-snug text-ink">
              {run.doneText} <span className="font-normal text-muted">· opening…</span>
            </p>
          )}
          {run.status === 'error' && (
            <>
              <p className="text-[15px] font-semibold leading-snug text-ink">
                That didn’t work
              </p>
              <p className="mt-0.5 text-[13px] leading-snug text-coral-deep">{run.error}</p>
            </>
          )}
        </div>

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

      {running && <div className="chat-progress" aria-hidden />}
    </div>
  )
}
