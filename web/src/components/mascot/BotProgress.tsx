import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { AGENTS, type AgentId } from './agents'
import { Bot } from './Bot'
import type { BotMood } from './moods'
import { watchVisibility } from './runtime'

export interface BotProgressProps {
  agent?: AgentId
  /** What the agent is doing, in its voice (see `pickLine('generating', …)`). */
  line: ReactNode
  /** Defaults to `working`; pass `oops` / `happy` when the run ends. */
  mood?: BotMood
  /** Epoch ms the run began. Defaults to mount time. */
  startedAt?: number
  /** Stop the clock (the last value stays). */
  running?: boolean
  /** Show the indeterminate bar. */
  bar?: boolean
  size?: number
  className?: string
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export function BotProgress({
  agent = 'tutor',
  line,
  mood = 'working',
  startedAt,
  running = true,
  bar = true,
  size = 56,
  className,
}: BotProgressProps) {
  const root = useRef<HTMLDivElement>(null)
  const clock = useRef<HTMLSpanElement>(null)
  const start = useRef(startedAt)

  // The clock writes its own text node once a second: no React re-renders.
  useEffect(() => {
    start.current ??= Date.now()
    const from = startedAt ?? start.current
    const paint = () => {
      if (clock.current) clock.current.textContent = formatElapsed(Date.now() - from)
    }
    paint()
    if (!running) return
    const id = window.setInterval(paint, 1000)
    return () => window.clearInterval(id)
  }, [startedAt, running])

  useEffect(() => (root.current ? watchVisibility(root.current) : undefined), [])

  return (
    <div
      ref={root}
      className={`bot-progress${className ? ` ${className}` : ''}`}
      style={{ '--bot-bar': AGENTS[agent].color } as CSSProperties}
    >
      <Bot agent={agent} mood={mood} size={size} />
      <div className="bot-progress-body">
        <div className="bot-progress-row">
          <p className="bot-progress-line" role="status">
            {line}
          </p>
          {(running || startedAt !== undefined) && (
            <span className="bot-progress-time" ref={clock} aria-hidden="true">
              0s
            </span>
          )}
        </div>
        {bar && running && (
          <div className="bot-progress-bar" aria-hidden="true">
            <i />
          </div>
        )}
      </div>
    </div>
  )
}
