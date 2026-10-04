import type { CSSProperties, ReactNode } from 'react'
import { AGENTS, type AgentId } from './agents'
import { Bot } from './Bot'
import type { BotMood } from './moods'
import { useBotsShown } from '../../lib/botPreference'
import './speech.css'

export interface BotSaysProps {
  agent?: AgentId
  mood?: BotMood
  /** The line. Real text: it is read, selected and translated like any copy. */
  children: ReactNode
  /** Changing this re-plays the bubble's entrance (pass the line itself when it's a string). */
  lineKey?: string | number
  layout?: 'inline' | 'stacked'
  size?: number
  /** Show the agent's name above the line. */
  showName?: boolean
  /** Announce line changes politely (status updates, not decoration). */
  live?: boolean
  look?: boolean
  /** Still at rest; expressive moods play a few beats, then hold. */
  calm?: boolean
  /** Giggles when the pointer arrives. */
  boop?: boolean
  className?: string
}

export function BotSays({
  agent = 'tutor',
  mood = 'idle',
  children,
  lineKey,
  layout = 'inline',
  size = layout === 'stacked' ? 96 : 56,
  showName = false,
  live = false,
  look = false,
  calm = false,
  boop = false,
  className,
}: BotSaysProps) {
  const meta = AGENTS[agent]
  const key = lineKey ?? (typeof children === 'string' ? children : undefined)
  const botsOn = useBotsShown()
  return (
    <div
      className={`bot-says bot-says--${layout}${botsOn ? '' : ' bot-says--plain'}${className ? ` ${className}` : ''}`}
      style={{ '--bot-name': meta.color } as CSSProperties}
    >
      <Bot agent={agent} mood={mood} size={size} look={look} calm={calm} boop={boop} />
      <div role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
        <p className="bot-bubble" key={key}>
          {showName && <span className="bot-says-name">{meta.name}</span>}
          {children}
        </p>
      </div>
    </div>
  )
}
