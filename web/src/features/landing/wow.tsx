/**
 * The motion that makes the page feel expensive rather than merely animated.
 *
 * Everything here drives style imperatively from a rAF loop and never calls
 * setState, because these run every frame and a React re-render per frame on a
 * page this size is exactly how a "premium" landing ends up stuttering on a
 * mid-range laptop.
 *
 * One hard rule, learned from the layout bugs on this page: NONE of these may
 * wrap a section that contains `position: sticky` or `position: fixed`
 * descendants. A transform on an ancestor re-parents both — the pinned scenes
 * would unpin and the fixed lamp would stop covering the viewport. Wrap leaf
 * content only.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/ui/Icon'
import { DUR_MS, EASE_CSS } from './language'

const reduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Where knowledge is currently converging, in viewport pixels.
 *
 * A deliberately mutable singleton rather than React state or a context. The
 * writer is a scene deep inside the scroll; the reader is the dust canvas,
 * which is a `fixed` sibling of the entire page. Threading a value that
 * changes every frame between those two through the component tree would mean
 * re-rendering the whole landing on every scroll tick to move some specks.
 *
 * `pull` is 0–1 so the effect can be faded in and out rather than snapping on.
 */
export const attractor = { x: -1, y: -1, pull: 0 }

const coarse = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

/**
 * Scroll-velocity tilt. The block skews and stretches slightly in the
 * direction of travel and settles when you stop.
 *
 * This is the single cheapest thing that separates a site that feels alive
 * from one that feels like a slideshow: matter has inertia, so when the page
 * moves fast, things should lag and deform a little rather than translating
 * rigidly. The smoothing (`cur += (d - cur) * 0.12`) is what makes it settle
 * instead of snapping.
 */
export function VelocityTilt({
  children,
  className,
  max = 3.2,
}: {
  children: ReactNode
  className?: string
  max?: number
}) {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (reduced()) return
    let last = window.scrollY
    let cur = 0
    let raf = 0
    const tick = () => {
      const now = window.scrollY
      const delta = now - last
      last = now
      cur += (delta - cur) * 0.12
      const skew = Math.max(-max, Math.min(max, cur * 0.06))
      const node = el.current
      if (node) {
        node.style.transform = `skewY(${skew.toFixed(3)}deg) scaleY(${(1 + Math.abs(skew) * 0.005).toFixed(4)})`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [max])

  return (
    <div ref={el} className={className} style={{ willChange: 'transform' }}>
      {children}
    </div>
  )
}

/**
 * Magnetic pull. The control leans toward the cursor as it approaches and
 * springs back when it leaves.
 *
 * Disabled outright on coarse pointers — on a phone there is no cursor to be
 * attracted to, and leaving it on just costs a listener.
 */
export function Magnetic({
  children,
  strength = 0.28,
  className,
}: {
  children: ReactNode
  strength?: number
  className?: string
}) {
  const el = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const node = el.current
    if (!node || reduced() || coarse()) return

    let raf = 0
    let tx = 0
    let ty = 0

    const onMove = (e: PointerEvent) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const r = node.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        const radius = Math.max(r.width, r.height) * 1.5
        const dist = Math.hypot(dx, dy)
        if (dist < radius) {
          const fall = 1 - dist / radius
          tx = dx * strength * fall
          ty = dy * strength * fall
        } else {
          tx = 0
          ty = 0
        }
        node.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)`
      })
    }
    const reset = () => {
      node.style.transform = 'translate(0px, 0px)'
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', reset)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', reset)
    }
  }, [strength])

  return (
    <span
      ref={el}
      className={className}
      style={{ display: 'inline-block', transition: `transform ${DUR_MS}ms ${EASE_CSS}` }}
    >
      {children}
    </span>
  )
}

/**
 * The landing page's one call to action, used at the top and at the bottom.
 *
 * There used to be two different buttons on this page: the app's bevelled
 * `Button` in the hero and a hand-rolled link with a heavy glow at the close.
 * Two button languages on one page is the thing that makes a site feel
 * assembled rather than designed, and it is why the ending did not feel like
 * the same page as the opening.
 *
 * The interaction is deliberately the SAME VERB the rest of the page uses: a
 * wipe. Headlines wipe in by clip-path, the hero arrives line by line, and the
 * fill here wipes across from the left on the same expo curve. Nothing here
 * bevels or glows — those were borrowed gestures that belonged to neither.
 */
export function CTA({
  to,
  children,
  size = 'lg',
}: {
  to: string
  children: ReactNode
  size?: 'md' | 'lg'
}) {
  const pad = size === 'lg' ? 'px-7 py-4 text-[15.5px]' : 'px-5 py-3 text-[14px]'
  return (
    <Magnetic strength={0.22}>
      <Link
        to={to}
        className={`group relative inline-flex items-center gap-2.5 overflow-hidden rounded-[12px] bg-brand font-bold text-[#1a120f] shadow-[0_10px_30px_-16px_rgba(255,90,60,0.9)] transition-[transform,box-shadow] duration-500 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-18px_rgba(255,90,60,0.95)] ${pad}`}
        style={{ transitionTimingFunction: EASE_CSS }}
      >
        {/* The wipe. `scaleX` from the left edge on the page's own easing —
            the same movement as every headline reveal, at button scale. */}
        <span
          aria-hidden
          className="absolute inset-0 origin-left scale-x-0 bg-[#ffd7cb] transition-transform duration-500 group-hover:scale-x-100 motion-reduce:hidden"
          style={{ transitionTimingFunction: EASE_CSS }}
        />
        <span className="relative z-10">{children}</span>
        <Icon
          name="arrowRight"
          size={size === 'lg' ? 17 : 15}
          // Its two sibling transitions on this button (the lift, the wipe fill)
          // both pin transitionTimingFunction to EASE_CSS; this one didn't, so it
          // fell back to Tailwind's default ease — a different curve firing
          // alongside two correct ones on the same hover. Language.ts is
          // explicit that the button-fill case is exactly what this system
          // exists to cover.
          className="relative z-10 transition-transform duration-500 group-hover:translate-x-1"
          style={{ transitionTimingFunction: EASE_CSS }}
        />
      </Link>
    </Magnetic>
  )
}

/**
 * Knowledge threads — curves drawn from the origin point to whatever the page
 * is currently producing from it.
 *
 * They are only ever visible DURING a handover. A thread that is permanently
 * on screen is decoration; a thread that appears exactly while one thing
 * becomes another is an explanation, and traceability is the entire product
 * claim. Drawn with stroke-dashoffset so they grow along their own path
 * rather than fading up.
 */
export function Threads({
  origin,
  targets,
  progress,
  tone = 'rgba(53,214,232,0.5)',
}: {
  origin: { x: number; y: number }
  targets: { x: number; y: number }[]
  /** 0 → nothing drawn, 1 → fully drawn. Fade both ends of the handover. */
  progress: number
  tone?: string
}) {
  if (progress <= 0.02 || origin.x < 0) return null
  // Peak mid-handover, gone at both ends.
  const vis = Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI)
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      style={{ opacity: vis }}
    >
      {targets.map((t, i) => {
        // Bow each thread differently so a set never reads as a fan of
        // identical arcs.
        const bow = (i % 2 === 0 ? -1 : 1) * (36 + i * 14)
        const mx = (origin.x + t.x) / 2 + bow
        const my = (origin.y + t.y) / 2 - Math.abs(bow) * 0.4
        const d = `M ${origin.x} ${origin.y} Q ${mx} ${my} ${t.x} ${t.y}`
        const len = Math.hypot(t.x - origin.x, t.y - origin.y) * 1.6
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={tone}
            strokeWidth={1.1}
            strokeDasharray={len}
            strokeDashoffset={len * (1 - Math.min(1, progress * 1.25))}
          />
        )
      })}
      <circle cx={origin.x} cy={origin.y} r={3} fill={tone} />
    </svg>
  )
}

/**
 * Masked line reveal. Each line is wiped in from the left by a clip-path
 * driven by scroll progress, staggered per line.
 *
 * `clip-path` rather than opacity on purpose: a fade makes type *appear*,
 * a wipe makes it *arrive*, and at display sizes the difference is the whole
 * effect. Under reduced motion every line renders fully revealed.
 */
export function MaskedLines({
  lines,
  progress,
  className,
  lineClassName,
}: {
  lines: ReactNode[]
  progress: number
  className?: string
  lineClassName?: string
}) {
  const still = reduced()
  return (
    <span className={className}>
      {lines.map((line, i) => {
        const start = i * 0.16
        const p = still ? 1 : Math.max(0, Math.min(1, (progress - start) / 0.55))
        return (
          <span
            key={i}
            className={lineClassName}
            style={{
              display: 'block',
              clipPath: `inset(0 ${(100 - p * 100).toFixed(2)}% -18% 0)`,
              transform: `translateY(${((1 - p) * 10).toFixed(2)}px)`,
            }}
          >
            {line}
          </span>
        )
      })}
    </span>
  )
}

/**
 * A drafting reticle in place of the system cursor — landing page only.
 *
 * Two elements at different lags: a hard dot pinned exactly to the pointer, and
 * a ring that trails it. The gap between them is the whole effect — the dot
 * says precisely where you are, the ring gives the movement weight. One
 * element alone reads either sluggish or lifeless.
 *
 * The ring opens up over anything interactive, so the cursor answers the page
 * instead of just decorating it. Never mounts on a coarse pointer: replacing
 * the cursor on a touch device costs two always-on listeners to move something
 * nobody can see.
 */
export function DraftingCursor() {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (coarse() || reduced()) return
    let tx = -100
    let ty = -100
    let rx = -100
    let ry = -100
    let hot = false
    let raf = 0

    const onMove = (e: PointerEvent) => {
      tx = e.clientX
      ty = e.clientY
      const t = e.target as Element | null
      hot = !!t?.closest?.('a,button,[role="button"],input,textarea,label')
    }

    const tick = () => {
      rx += (tx - rx) * 0.16
      ry += (ty - ry) * 0.16
      if (dot.current) dot.current.style.transform = `translate3d(${tx - 2}px,${ty - 2}px,0)`
      if (ring.current) {
        ring.current.style.transform = `translate3d(${rx - 15}px,${ry - 15}px,0) scale(${hot ? 1.85 : 1})`
        ring.current.style.borderColor = hot
          ? 'rgba(255,90,60,0.85)'
          : 'rgba(245,237,228,0.42)'
      }
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  if (typeof window !== 'undefined' && (coarse() || reduced())) return null

  return (
    <>
      <div
        ref={dot}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] h-1 w-1 rounded-full bg-brand"
      />
      <div
        ref={ring}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] h-[30px] w-[30px] rounded-full border"
        style={{ transition: 'transform 120ms linear, border-color 220ms ease' }}
      />
    </>
  )
}

/**
 * Out-of-focus fragments of the student's own material, drifting deep in the
 * background.
 *
 * These are meant to read as *memory* rather than decoration — blurred
 * citations, a highlighted line, an equation, a page number — so they are
 * heavily blurred, very low contrast, and move slowly enough that you notice
 * them only if you stop and look. If they ever compete with the UI they are
 * wrong; contrast here should stay under the text it sits behind.
 */
const FRAGMENTS = [
  { t: 'micro-ch7.pdf · p.88', x: 8, y: 18, s: 1.0, d: 0, dur: 64 },
  { t: '∂L/∂w = 0', x: 74, y: 12, s: 1.25, d: 9, dur: 78 },
  { t: 'retrieved · 1 of 3', x: 58, y: 62, s: 0.9, d: 4, dur: 70 },
  { t: 'physiology-wk6.pdf · p.31', x: 20, y: 74, s: 1.1, d: 14, dur: 86 },
  { t: 'due today', x: 87, y: 44, s: 0.95, d: 6, dur: 58 },
  { t: 'Marbury v. Madison', x: 40, y: 34, s: 1.05, d: 19, dur: 92 },
  { t: '3 NADH · 1 FADH2', x: 66, y: 86, s: 0.85, d: 11, dur: 74 },
]

export function SourceDrift() {
  if (reduced()) return null
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {FRAGMENTS.map((f) => (
        <span
          key={f.t}
          className="absolute whitespace-nowrap font-mono text-[13px] tracking-[0.08em] text-ink"
          style={{
            left: `${f.x}%`,
            top: `${f.y}%`,
            opacity: 0.05,
            filter: 'blur(2.5px)',
            transform: `scale(${f.s})`,
            animation: `srcDrift ${f.dur}s ${f.d}s ease-in-out infinite`,
          }}
        >
          {f.t}
        </span>
      ))}
      <style>{`
        @keyframes srcDrift {
          0%,100% { transform: translate3d(0,0,0); }
          50%     { transform: translate3d(26px,-38px,0); }
        }
      `}</style>
    </div>
  )
}
