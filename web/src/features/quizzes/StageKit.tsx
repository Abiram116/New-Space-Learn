/**
 * Small pieces shared by the full-page study stage — the quiz, its results,
 * and card review. Imports `stage.css`, which holds the scoped fluid sizing.
 */

import type { ReactNode } from 'react'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import './stage.css'

/** One key, drawn as a key. Arrows are the drawn icon, not a text glyph. */
export function Kbd({ k }: { k: string }) {
  const arrow: Record<string, number> = { up: -90, down: 90, left: 180, right: 0 }
  const rot = arrow[k]
  return (
    <kbd
      className={cn(
        'inline-grid h-[1.7em] min-w-[1.7em] place-items-center rounded-md border border-line bg-well px-1.5',
        'font-mono text-[0.92em] font-semibold leading-none text-ink-3',
        'shadow-[inset_0_-2px_0_rgba(0,0,0,0.35)]',
      )}
    >
      {rot !== undefined ? (
        <>
          <Icon name="arrowRight" size={12} style={{ transform: `rotate(${rot}deg)` }} />
          <span className="sr-only">{k} arrow</span>
        </>
      ) : (
        k
      )}
    </kbd>
  )
}

/** `keys` are drawn as keycaps, except the joiners `–`, `/` and `or`. */
export type KeyHint = { keys: string[]; label: string }

const JOINERS = new Set(['–', '/', 'or'])

/**
 * The legend for the keyboard, in one quiet line. Hidden without a fine
 * pointer (phones, tablets) — see `.stage-keys` in stage.css.
 */
export function KeyHints({ hints, className }: { hints: KeyHint[]; className?: string }) {
  return (
    <div
      className={cn(
        'stage-keys stage-label flex-wrap items-center gap-x-5 gap-y-2 text-muted',
        className,
      )}
      data-testid="key-hints"
    >
      {hints.map((h) => (
        <span key={h.label} className="inline-flex items-center gap-1">
          {h.keys.map((k, i) =>
            JOINERS.has(k) ? (
              <span key={i} className="px-0.5 text-faint">
                {k}
              </span>
            ) : (
              <Kbd key={i} k={k} />
            ),
          )}
          <span className="ml-1">{h.label}</span>
        </span>
      ))}
    </div>
  )
}

/** "3 / 8", large — where you are is the first thing a glance should find. */
export function StageCount({
  current,
  total,
  noun,
  children,
}: {
  current: number
  total: number
  noun: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <p className="flex items-baseline gap-2 leading-none" aria-label={`${noun} ${current} of ${total}`}>
        <span className="nameplate stage-count tabular-nums text-ink" aria-hidden>
          {current}
        </span>
        <span className="nameplate stage-count-total tabular-nums text-faint" aria-hidden>
          / {total}
        </span>
      </p>
      {children}
    </div>
  )
}
