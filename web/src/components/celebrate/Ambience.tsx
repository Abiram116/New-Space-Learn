/**
 * The room a study session happens in.
 *
 * Three pools of lamp-light drifting behind the work, slow enough that you
 * never see one move — you only notice the table isn't quite where you left
 * it. As the session advances the warm pool brightens and the cool one
 * recedes; a right answer sends a pulse of light out from under the card, a
 * miss dims the room for a breath and lets it come back. It never flashes red
 * and never goes dark: a miss is information, not a punishment.
 *
 * Imperative on purpose. Progress and pulses write straight to four DOM
 * nodes through refs, so a grade never re-renders anything to move the light.
 *
 * Budget: four layers, all transform/opacity. The drift is a CSS animation
 * (compositor thread) that pauses while the tab is hidden; reduced motion gets
 * the same light, standing still, and no pulses.
 */

import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { AmbienceContext, useAmbienceField, type AmbienceHandle } from './useAmbience'
import './celebrate.css'

/** The light itself: an absolutely positioned layer behind its parent's
 *  content. The parent needs `relative isolate`. */
export function AmbienceField({
  field,
  compact = false,
}: {
  field: AmbienceHandle
  compact?: boolean
}) {
  const { nodes } = field

  useEffect(() => {
    const sync = () => {
      const root = nodes.current.root
      if (!root) return
      if (document.hidden) root.dataset.paused = ''
      else delete root.dataset.paused
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [nodes])

  const pool = (colour: string): CSSProperties => ({ ['--c' as string]: colour })

  return (
    <div
      ref={(el) => void (nodes.current.root = el)}
      aria-hidden
      className="sl-amb"
      data-compact={compact ? '' : undefined}
    >
      <div ref={(el) => void (nodes.current.warm = el)} className="sl-amb-slot sl-amb-warm">
        <div className="sl-amb-drift">
          <div className="sl-amb-blob" style={pool('var(--color-brand)')} />
        </div>
      </div>
      <div ref={(el) => void (nodes.current.cool = el)} className="sl-amb-slot sl-amb-cool">
        <div className="sl-amb-drift">
          <div className="sl-amb-blob" style={pool('var(--color-azure)')} />
        </div>
      </div>
      <div className="sl-amb-slot sl-amb-low">
        <div className="sl-amb-drift">
          <div className="sl-amb-blob" style={pool('var(--color-sun)')} />
        </div>
      </div>
      <div ref={(el) => void (nodes.current.pulse = el)} className="sl-amb-pulse" />
    </div>
  )
}

/**
 * A room around `children`, with its ambience on context. The outer box is
 * the positioning frame and never scrolls, so the light stays put while
 * `innerClassName` (pass `overflow-y-auto` for a scrolling session) moves.
 */
export function StudyAmbience({
  children,
  compact = false,
  className,
  innerClassName,
}: {
  children: ReactNode
  compact?: boolean
  className?: string
  innerClassName?: string
}) {
  const field = useAmbienceField()
  return (
    <div className={cn('relative isolate flex min-h-0 flex-1 flex-col', className)}>
      <AmbienceField field={field} compact={compact} />
      <AmbienceContext.Provider value={field.api}>
        <div className={cn('flex min-h-0 flex-1 flex-col', innerClassName)}>{children}</div>
      </AmbienceContext.Provider>
    </div>
  )
}
