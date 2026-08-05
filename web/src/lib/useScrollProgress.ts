import { useEffect, useRef, useState } from 'react'

/**
 * Scroll progress for a pinned section, 0 → 1.
 *
 * One rAF-throttled listener per element, writing a single number. Callers
 * turn that number into transforms, so the whole scene animates off one
 * measurement instead of a dozen competing observers.
 *
 * Returns 1 immediately under `prefers-reduced-motion`: the reduced-motion
 * experience is the finished composition, not a frozen half-open one.
 */
export function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setProgress(1)
      return
    }

    let frame = 0
    const measure = () => {
      frame = 0
      const rect = el.getBoundingClientRect()
      // Distance travelled through the element's own scrollable overshoot.
      const total = rect.height - window.innerHeight
      if (total <= 0) {
        setProgress(rect.top <= 0 ? 1 : 0)
        return
      }
      const p = Math.min(1, Math.max(0, -rect.top / total))
      setProgress(p)
    }

    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return { ref, progress }
}

/** True once the element has been in view. Used for one-shot reveals. */
export function useInView<T extends HTMLElement>(margin = '-15%') {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: `0px 0px ${margin} 0px` },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [margin])

  return { ref, seen }
}

/** Map a value from one range to another, clamped. */
export function mapRange(v: number, a0: number, a1: number, b0: number, b1: number) {
  const t = Math.min(1, Math.max(0, (v - a0) / (a1 - a0)))
  return b0 + t * (b1 - b0)
}
