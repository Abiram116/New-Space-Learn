/**
 * Motion for the app itself.
 *
 * The landing page has had a full motion vocabulary since the redesign
 * (`features/landing/motion.tsx` — parallax, scroll-driven reveals, foil
 * sweeps) while the app behind it had essentially only hover colours. That
 * gap read as two different products: the pitch felt crafted, the thing it
 * was pitching felt static.
 *
 * These are deliberately smaller than the landing primitives. An app screen
 * is somewhere you work every day, so motion here has one job — to make a
 * change in state legible (this arrived, this list reordered, you moved to
 * a new page) — and must never make you wait. Nothing here animates longer
 * than ~320ms, and nothing blocks interaction.
 *
 * Everything honours `prefers-reduced-motion`: the reduced path renders the
 * final state immediately rather than a faster animation, because for
 * vestibular triggers a quick movement is still a movement.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** True when the user asked the OS for less motion. Live-updates. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * Fade + lift on mount. The workhorse: use it for anything that appears as
 * the result of loading, so content arrives rather than snapping in.
 */
export function Rise({
  children,
  delay = 0,
  distance = 8,
  className,
}: {
  children: ReactNode
  /** ms. Keep cumulative stagger under ~250ms — past that it reads as lag. */
  delay?: number
  distance?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])

  if (reduced) return <div className={className}>{children}</div>

  return (
    <div
      className={cn('transition-[opacity,transform] ease-out', className)}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : `translateY(${distance}px)`,
        transitionDuration: '320ms',
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Applies an increasing `Rise` delay to each child, so a grid or list deals
 * itself in rather than appearing all at once.
 *
 * `max` caps the total: a 40-card deck staggered at 40ms each would take
 * 1.6s to finish arriving, which is no longer motion, it's waiting.
 */
export function Stagger({
  children,
  step = 40,
  max = 240,
  className,
}: {
  children: ReactNode[]
  step?: number
  max?: number
  className?: string
}) {
  return (
    <>
      {children.map((child, i) => (
        <Rise key={i} delay={Math.min(i * step, max)} className={className}>
          {child}
        </Rise>
      ))}
    </>
  )
}

/**
 * A cross-fade keyed on the current route, so moving between pages reads as
 * a transition rather than a hard cut.
 *
 * Intentionally fade-only, with no directional slide: the app's pages aren't
 * ordered, so sliding would imply a spatial relationship that doesn't exist
 * and would fight the sidebar staying put.
 */
export function PageTransition({
  routeKey,
  children,
}: {
  routeKey: string
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(false)
  const previous = useRef(routeKey)

  useEffect(() => {
    if (reduced) return
    if (previous.current !== routeKey) {
      previous.current = routeKey
      setShown(false)
    }
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [routeKey, reduced])

  if (reduced) return <>{children}</>

  return (
    <div
      className="flex min-h-0 flex-1 flex-col transition-opacity duration-200 ease-out"
      style={{ opacity: shown ? 1 : 0 }}
    >
      {children}
    </div>
  )
}

/**
 * A number that counts up to its value instead of snapping.
 *
 * Reserved for figures the app is making a point of — a streak, a score —
 * where the count itself is the moment. Not for incidental counts, which
 * would turn every render into a slot machine.
 */
export function CountUp({
  value,
  durationMs = 520,
  className,
  style,
}: {
  value: number
  durationMs?: number
  className?: string
  style?: CSSProperties
}) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(reduced ? value : 0)
  const from = useRef(0)

  useEffect(() => {
    if (reduced) {
      setShown(value)
      return
    }
    const start = performance.now()
    const origin = from.current
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      // easeOutCubic — fast to start, settles gently on the real figure.
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(Math.round(origin + (value - origin) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, durationMs, reduced])

  return (
    <span className={className} style={style}>
      {shown}
    </span>
  )
}
