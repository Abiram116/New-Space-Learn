/**
 * Is the on-screen keyboard up, and how much of the screen does it cover?
 *
 * Browsers disagree about what a keyboard does to the page. iOS Safari and
 * current Chrome on Android keep the layout viewport and shrink only the
 * *visual* viewport; older Android Chrome resizes the layout viewport itself.
 * Comparing the visual viewport's height against the tallest height seen at
 * this width covers both: either way the visible area drops by the keyboard.
 *
 * The baseline resets when the width changes (rotation), so turning the phone
 * sideways isn't mistaken for a keyboard.
 */

import { useEffect, useState } from 'react'

/** Anything smaller than this is browser chrome (a URL bar collapsing), not a keyboard. */
export const KEYBOARD_MIN_PX = 120

/** Pure: does the visible height, against the full height, mean a keyboard? */
export function isKeyboardOpen(baselineHeight: number, visibleHeight: number): boolean {
  return baselineHeight - visibleHeight > KEYBOARD_MIN_PX
}

/**
 * How far a bottom-pinned element must lift to clear the keyboard. Only
 * non-zero where the keyboard covers the layout viewport (iOS), not where it
 * resizes it.
 */
export function keyboardInset(layoutHeight: number, visibleHeight: number, offsetTop: number): number {
  return Math.max(0, Math.round(layoutHeight - visibleHeight - offsetTop))
}

export type KeyboardState = {
  open: boolean
  /** Pixels of the layout viewport the keyboard covers (0 when it resizes the page). */
  inset: number
  /** The visible height right now. */
  visibleHeight: number
}

const CLOSED: KeyboardState = { open: false, inset: 0, visibleHeight: 0 }

export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>(CLOSED)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    let baseline = Math.max(window.innerHeight, vv.height)
    let width = window.innerWidth

    const update = () => {
      if (window.innerWidth !== width) {
        width = window.innerWidth
        baseline = Math.max(window.innerHeight, vv.height)
      }
      baseline = Math.max(baseline, window.innerHeight)
      const open = isKeyboardOpen(baseline, vv.height)
      const inset = open ? keyboardInset(window.innerHeight, vv.height, vv.offsetTop) : 0
      setState((prev) =>
        prev.open === open && prev.inset === inset && prev.visibleHeight === vv.height
          ? prev
          : { open, inset, visibleHeight: vv.height },
      )
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return state
}
