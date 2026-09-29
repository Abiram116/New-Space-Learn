/**
 * The app's curves, for GSAP.
 *
 * `index.css` declares `--ease-sl` and `--ease-in-out-sl`; these are the same
 * four numbers solved in JS, so a tween here and a CSS transition beside it
 * move as one system. Solved locally rather than through `CustomEase` so the
 * intake does not pull a plugin in for two curves.
 */

/** A CSS `cubic-bezier()` as a function of progress. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx

  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    // Newton first — it converges in a handful of steps for these curves.
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x
      if (Math.abs(err) < 1e-6) return sy(t)
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    // Bisection when Newton stalls on a flat stretch.
    let lo = 0
    let hi = 1
    t = x
    for (let i = 0; i < 24; i++) {
      if (sx(t) < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return sy(t)
  }
}

/** `--ease-sl`: a hard start, a long glide, no bounce. Things arriving. */
export const EASE = bezier(0.22, 1, 0.36, 1)
/** `--ease-in-out-sl`: slow at both ends. Things changing in place. */
export const EASE_IN_OUT = bezier(0.65, 0, 0.35, 1)
/** Its mirror: things leaving, which should accelerate away. */
export const EASE_IN = bezier(0.64, 0, 0.78, 0)
/** `--dur-sl`, in seconds. Heavier things move in multiples of it. */
export const DUR = 0.7
