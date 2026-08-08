import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { cn } from '../../lib/cn'

/**
 * A quiet, dismissible hint.
 *
 * Rules this follows, because tips are very easy to make annoying:
 *
 * 1. **It teaches something non-obvious.** A tip that narrates what the screen
 *    already shows ("this is your deck") is noise. Every one of these explains
 *    a mechanic you would otherwise have to discover by accident — a keyboard
 *    shortcut, what a grade actually costs you, why an upload takes a moment.
 * 2. **It can be dismissed, and it stays dismissed.** Keyed in localStorage by
 *    id, so a tip a student has read never reappears. A hint you cannot get
 *    rid of stops being help and becomes furniture.
 * 3. **It is never in the way.** No modal, no overlay, no arrow pointing at
 *    something. It sits in the flow and can be ignored.
 * 4. **It states fact, not encouragement.** "Grading Again resets the interval
 *    to one day" — not "You've got this!".
 */

const STORE_PREFIX = 'sl:tip:'

export function Tip({
  id,
  children,
  icon = 'sparkle',
  className,
}: {
  /** Stable key. Changing it makes the tip reappear for everyone. */
  id: string
  children: ReactNode
  icon?: 'sparkle' | 'target' | 'clock' | 'skill' | 'deck' | 'doc' | 'note'
  className?: string
}) {
  const [dismissed, setDismissed] = useState(true)

  // Read after mount rather than in a lazy initialiser: this component renders
  // inside routes that are code-split, and touching localStorage during the
  // first render of a suspended tree is a needless synchronous read.
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORE_PREFIX + id) === '1')
    } catch {
      setDismissed(false)
    }
  }, [id])

  if (dismissed) return null

  const close = () => {
    setDismissed(true)
    try {
      localStorage.setItem(STORE_PREFIX + id, '1')
    } catch {
      /* private mode — the tip simply returns next session */
    }
  }

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-[11px] border border-line bg-well/60 px-3 py-2.5',
        className,
      )}
    >
      <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-md bg-sky-soft text-sky-deep">
        <Icon name={icon} size={12} />
      </span>
      <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-muted">{children}</p>
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss tip"
        className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-line-soft hover:text-ink-3"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}
