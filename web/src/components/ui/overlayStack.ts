/**
 * Which dialog is on top.
 *
 * Every open `Modal` / `BottomSheet` listens for keys on `window`, so with two
 * stacked (a confirm opened over a form) one press of Escape reached both and
 * closed the pair. Each one registers here while it is open, and only the
 * last to open — the one the student is looking at — answers the keyboard.
 */
const stack: symbol[] = []

export function pushOverlay(): { isTop: () => boolean; release: () => void } {
  const id = Symbol('overlay')
  stack.push(id)
  return {
    isTop: () => stack[stack.length - 1] === id,
    release: () => {
      const i = stack.indexOf(id)
      if (i !== -1) stack.splice(i, 1)
    },
  }
}
