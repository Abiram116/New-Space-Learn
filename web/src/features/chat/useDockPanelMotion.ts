/**
 * Which way the dock panel should move, and for how long.
 *
 * The dock has three transitions and they mean different things, but it played
 * one animation for all of them — `key={panel}` plus a single "slide in from
 * the right". That is wrong twice:
 *
 *   - **Overview → panel** is going *deeper*. Sliding in from the right is
 *     right, and it was the only case the old animation actually described.
 *   - **Panel → panel** (Notes → Quizzes) is *lateral*: same depth, different
 *     sibling. Replaying the enter animation says "you went deeper again",
 *     which is why switching tabs felt heavier than it is.
 *   - **Panel → overview** is *back*. This had no animation whatsoever: the
 *     panel unmounted the instant state changed, so returning read as the UI
 *     dropping a frame rather than as a retreat.
 *
 * The exit is the reason this is a hook rather than three class names. React
 * removes an element as soon as it stops being rendered, so an exit animation
 * needs the panel to outlive the state change — this holds the outgoing panel
 * for exactly the length of its animation, then lets it go.
 *
 * **`kind` exists so a switch does not remount the shell.** The header, the
 * scroll container and the panel's own layout are identical between siblings;
 * tearing them down and rebuilding them to change the body is wasted work and,
 * worse, it resets the scroll position. The caller keys the *body* on the panel
 * and leaves the shell alone — see ContextDock.
 */

import { useEffect, useRef, useState } from 'react'
import type { DockPanel } from './DockPanels'

/**
 * Class names are written out in full, not built from a duration constant.
 *
 * Tailwind generates utilities by scanning source for *literal* class strings,
 * so `animate-[dockIn_${MS}ms_...]` produces a class that never gets emitted —
 * the animation silently does nothing and the only symptom is a transition
 * that looks like it was never implemented.
 *
 * **Every one carries `both`, and the enter/swap pair used to not.** Without a
 * backwards fill the element paints at its natural state for the frame between
 * mount and the animation's first tick, then snaps to `from { opacity: 0 }` and
 * fades up. That full-opacity frame followed by a jump to transparent is a
 * visible blink on every panel change — it was reported as "the animation
 * spoils itself", and it is the single character `both` that fixes it.
 */
const ENTER = 'motion-safe:animate-[dockIn_260ms_var(--ease-sl)_both]'
const SWITCH = 'motion-safe:animate-[dockSwap_200ms_var(--ease-sl)_both]'
const EXIT = 'motion-safe:animate-[dockOut_220ms_var(--ease-sl)_both]'

/** Must equal the duration inside `EXIT`. */
const EXIT_MS = 220

type Kind = 'idle' | 'enter' | 'switch' | 'exit'

type View = {
  /** What to render — may be the *outgoing* panel during an exit. */
  panel: NonNullable<DockPanel> | null
  kind: Kind
  /** Applied to the panel shell. Empty on a switch: the shell is not moving. */
  shellAnimation: string
  /** Applied to the panel body, which is what actually changes on a switch. */
  bodyAnimation: string
}

export const IDLE: View = { panel: null, kind: 'idle', shellAnimation: '', bodyAnimation: '' }

/**
 * Which transition a change represents, as a pure function.
 *
 * Separated from the hook so the semantics can be asserted directly. The rule
 * being protected is not "does it animate" but *which* animation each change
 * gets — and getting that wrong is invisible to a type checker and easy to
 * regress, because every variant looks plausible in isolation.
 *
 * Returns `null` when nothing changed, so the caller can skip the state write.
 */
export function transitionFor(before: DockPanel, after: DockPanel): View | null {
  if (after === before) return null
  // Deeper: the whole panel arrives.
  if (after && !before) {
    return { panel: after, kind: 'enter', shellAnimation: ENTER, bodyAnimation: '' }
  }
  // Sideways: the shell holds still and only the contents change. Animating
  // the shell here is what made a tab change feel like another step down.
  if (after && before) {
    return { panel: after, kind: 'switch', shellAnimation: '', bodyAnimation: SWITCH }
  }
  // Back: the outgoing panel is held mounted long enough to leave.
  return { panel: before, kind: 'exit', shellAnimation: EXIT, bodyAnimation: '' }
}

export function useDockPanelMotion(panel: DockPanel): View {
  const [view, setView] = useState<View>(() =>
    panel ? { panel, kind: 'idle', shellAnimation: '', bodyAnimation: '' } : IDLE,
  )
  const previous = useRef<DockPanel>(panel)

  useEffect(() => {
    const before = previous.current
    previous.current = panel

    const next = transitionFor(before, panel)
    if (!next) return
    setView(next)

    // An exit is the only one that needs cleaning up after itself: the panel
    // is being rendered *after* it stopped being selected, so something has to
    // stop rendering it. React runs this cleanup before the next effect, which
    // is what stops a re-open during the exit window from being cancelled by
    // the previous exit's timer.
    if (next.kind === 'exit') {
      const id = window.setTimeout(() => setView(IDLE), EXIT_MS)
      return () => window.clearTimeout(id)
    }
  }, [panel])

  return view
}
