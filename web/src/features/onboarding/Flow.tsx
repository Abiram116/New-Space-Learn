/**
 * The stream that carries an answer into the fingerprint.
 *
 * Tapping an option sends a spray of streaks from the card you touched,
 * curving across the page into the seed, and the drawing changes on the
 * instant the first one lands. The choice visibly *feeds* the picture — which
 * is the whole claim the intake makes — instead of the two sides of the screen
 * happening to update at the same time.
 *
 * A fixed pool, positioned with `transform` alone and written straight to the
 * style (no per-frame tween objects), so a burst costs one rAF callback per
 * streak and nothing that touches layout.
 */

import { gsap } from 'gsap'
import { useImperativeHandle, useRef, type Ref } from 'react'
import { EASE_IN_OUT } from './motion'

const POOL = 42

export type Emit = {
  /** Where it comes from — usually the card that was pressed. */
  from: DOMRect
  /** The pointer, if there was one; the spray favours it. */
  origin?: { x: number; y: number } | null
  to: { x: number; y: number }
  /** A text-colour class; each streak paints in `currentColor`. */
  tone: string
  count?: number
  /** Fires once, when the first streak lands. */
  onArrive: () => void
}

export type FlowHandle = { emit: (e: Emit) => void }

export function Flow({ ref }: { ref: Ref<FlowHandle> }) {
  const layer = useRef<HTMLDivElement>(null)
  const next = useRef(0)

  useImperativeHandle(ref, () => ({
    emit({ from, origin, to, tone, count = 16, onArrive }) {
      const nodes = layer.current?.children
      if (!nodes) return onArrive()
      let arrived = false
      for (let i = 0; i < count; i++) {
        const el = nodes[next.current++ % POOL] as HTMLElement
        gsap.killTweensOf(el)
        el.className = `absolute left-0 top-0 h-[3px] w-[10px] rounded-full bg-current opacity-0 ${tone}`

        // Start inside the card, bunched toward the pointer when there is one.
        const near = origin && Math.random() < 0.6
        const x0 = near ? origin.x + (Math.random() - 0.5) * 60 : from.left + Math.random() * from.width
        const y0 = near ? origin.y + (Math.random() - 0.5) * 24 : from.top + Math.random() * from.height
        const x2 = to.x + (Math.random() - 0.5) * 24
        const y2 = to.y + (Math.random() - 0.5) * 24
        // One control point, thrown off to either side of the straight line,
        // so the spray fans out and converges rather than marching in a line.
        const dx = x2 - x0
        const dy = y2 - y0
        const len = Math.hypot(dx, dy) || 1
        const bend = (Math.random() - 0.5) * len * 0.9
        const x1 = (x0 + x2) / 2 + (-dy / len) * bend
        const y1 = (y0 + y2) / 2 + (dx / len) * bend

        const p = { t: 0 }
        gsap.to(p, {
          t: 1,
          duration: 0.62 + Math.random() * 0.4,
          delay: i * 0.016,
          ease: EASE_IN_OUT,
          onUpdate: () => {
            const t = p.t
            const u = 1 - t
            const x = u * u * x0 + 2 * u * t * x1 + t * t * x2
            const y = u * u * y0 + 2 * u * t * y1 + t * t * y2
            // Aligned to its direction of travel and stretched by speed: a
            // streak, not a dot, which is what makes it read as flowing.
            const vx = 2 * u * (x1 - x0) + 2 * t * (x2 - x1)
            const vy = 2 * u * (y1 - y0) + 2 * t * (y2 - y1)
            const stretch = 0.6 + Math.sin(Math.PI * t) * 2.2
            el.style.transform = `translate3d(${x}px,${y}px,0) rotate(${Math.atan2(vy, vx)}rad) scale(${stretch},${0.6 + 0.6 * Math.sin(Math.PI * t)})`
            el.style.opacity = String(t < 0.12 ? t / 0.12 : t > 0.88 ? (1 - t) / 0.12 : 1)
          },
          onComplete: () => {
            el.style.opacity = '0'
            if (!arrived) {
              arrived = true
              onArrive()
            }
          },
        })
      }
    },
  }))

  return (
    <div ref={layer} aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {Array.from({ length: POOL }, (_, i) => (
        <span key={i} className="absolute left-0 top-0 opacity-0" />
      ))}
    </div>
  )
}
