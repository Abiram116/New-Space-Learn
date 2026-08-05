/**
 * Motion primitives for the landing page, written in the Foil Binder's own
 * grammar rather than pulled from a general-purpose animation kit.
 *
 * The distinction matters: a generic "split text fade up" belongs to no
 * product. Here, letters arrive the way a dealt card arrives — rotating on
 * their own axis, dropping onto the table, settling. The motion is the world.
 *
 * Everything is transform/opacity only, and everything collapses to its
 * finished state under `prefers-reduced-motion`.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

function prefersReduced() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Fires once when the element first enters the viewport. */
function useReveal<T extends HTMLElement>(delay = 0) {
  const ref = useRef<T>(null)
  const [on, setOn] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReduced()) {
      setOn(true)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          window.setTimeout(() => setOn(true), delay)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [delay])

  return { ref, on }
}

/**
 * Text that deals itself onto the table, one card per word.
 *
 * Each word rotates in on X (as if landing face-up from an angle) with a
 * per-word stagger. Word-level rather than letter-level: at display size,
 * per-letter flips read as noise and hurt legibility, while per-word keeps
 * the phrase parseable the whole way in.
 */
export function DealText({
  children,
  className,
  delay = 0,
  stagger = 55,
  as: Tag = 'span',
}: {
  children: string
  className?: string
  delay?: number
  stagger?: number
  as?: 'span' | 'h1' | 'h2' | 'h3'
}) {
  const { ref, on } = useReveal<HTMLElement>(delay)
  const words = children.split(' ')

  return (
    <Tag
      ref={ref as never}
      className={cn('inline-block [perspective:900px]', className)}
      aria-label={children}
    >
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <span
            aria-hidden
            className="inline-block will-change-transform"
            style={{
              transform: on
                ? 'translateY(0) rotateX(0deg)'
                : 'translateY(0.9em) rotateX(-72deg)',
              opacity: on ? 1 : 0,
              transformOrigin: 'top center',
              transition: `transform 720ms cubic-bezier(0.16,1,0.3,1) ${i * stagger}ms, opacity 480ms ease-out ${i * stagger}ms`,
            }}
          >
            {word}
          </span>
          {i < words.length - 1 && ' '}
        </span>
      ))}
    </Tag>
  )
}

/**
 * Foil lettering: the iridescent sweep runs across the glyphs themselves.
 *
 * Deliberately not a gradient fill — the text keeps its solid ink colour and a
 * highlight passes over it, which is what actual foil stamping does. A static
 * gradient would just be gradient text, which this world has no use for.
 */
export function FoilText({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn('relative inline-block', className)}>
      <span className="relative z-10">{children}</span>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20 bg-clip-text text-transparent"
        style={{
          backgroundImage:
            'linear-gradient(105deg, transparent 42%, rgba(255,197,61,0.95) 47%, rgba(46,230,214,0.95) 50%, rgba(255,61,139,0.95) 53%, transparent 58%)',
          backgroundSize: '260% 100%',
          animation: 'foilText 4.5s ease-in-out infinite',
          WebkitBackgroundClip: 'text',
        }}
      >
        {children}
      </span>
      <style>{`
        @keyframes foilText {
          0%, 100% { background-position: 150% 0; }
          55%      { background-position: -50% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="foilText"] { animation: none !important; opacity: 0; }
        }
      `}</style>
    </span>
  )
}

/**
 * A ticker of set codes, like the spine of a binder scrolling past.
 *
 * Duplicated once and translated by exactly -50%, so the loop is seamless
 * without measuring anything at runtime.
 */
export function CodeMarquee({ items, className }: { items: string[]; className?: string }) {
  const doubled = [...items, ...items]
  return (
    <div
      className={cn(
        'relative flex overflow-hidden border-y border-line bg-well/60 py-2.5',
        className,
      )}
      aria-hidden
    >
      <div
        className="flex shrink-0 gap-8 pr-8"
        style={{ animation: 'marquee 34s linear infinite' }}
      >
        {doubled.map((item, i) => (
          <span key={i} className="setcode whitespace-nowrap">
            {item}
          </span>
        ))}
      </div>
      {/* Edges fade so the strip reads as continuous, not clipped. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-24"
        style={{ background: 'linear-gradient(90deg, var(--color-canvas), transparent)' }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-24"
        style={{ background: 'linear-gradient(270deg, var(--color-canvas), transparent)' }}
      />
      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="marquee"] { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

/**
 * Pointer parallax for a 3D stage.
 *
 * Returns a normalised -1..1 pair from the pointer's position over the
 * element, rAF-throttled. Disabled entirely for coarse pointers: on a phone
 * there is no hover, and running this on touch just costs battery.
 */
export function usePointerParallax<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  // `pos` is -1..1 for parallax offsets; `light` is 0-100% for placing the
  // lamp itself, which needs an absolute spot rather than a signed offset.
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [light, setLight] = useState({ x: 50, y: 42 })
  const [lit, setLit] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReduced() || window.matchMedia('(pointer: coarse)').matches) return

    let frame = 0
    let nextPos = { x: 0, y: 0 }
    let nextLight = { x: 50, y: 42 }

    const apply = () => {
      frame = 0
      setPos(nextPos)
      setLight(nextLight)
    }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width
      const py = (e.clientY - r.top) / r.height
      nextPos = { x: (px - 0.5) * 2, y: (py - 0.5) * 2 }
      nextLight = { x: px * 100, y: py * 100 }
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const onEnter = () => setLit(true)
    const onLeave = () => {
      nextPos = { x: 0, y: 0 }
      nextLight = { x: 50, y: 42 }
      setLit(false)
      if (!frame) frame = requestAnimationFrame(apply)
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return { ref, pos, light, lit }
}

/**
 * A moving lamp over a ruled surface.
 *
 * Two stacked layers: the grid at rest, and a brighter copy of the same grid
 * masked to a soft disc under the pointer. The lines don't move — they catch
 * the light as it passes, the way ruled foil actually behaves. When the
 * pointer leaves, the lamp eases back to a resting spot rather than snapping.
 */
export function LitGrid({
  light,
  lit,
  size = 70,
  className,
}: {
  light: { x: number; y: number }
  lit: boolean
  size?: number
  className?: string
}) {
  const lines =
    'linear-gradient(to right,var(--c) 1px,transparent 1px),' +
    'linear-gradient(to bottom,var(--c) 1px,transparent 1px)'

  return (
    <div className={cn('pointer-events-none absolute inset-0', className)} aria-hidden>
      {/* Resting grid. */}
      <div
        className="absolute inset-0 opacity-40"
        style={
          {
            '--c': '#3b3028',
            backgroundImage: lines,
            backgroundSize: `${size}px ${size}px`,
            maskImage: 'radial-gradient(85% 75% at 50% 45%, black, transparent)',
          } as CSSProperties
        }
      />
      {/* Lit copy, revealed only under the lamp. */}
      <div
        className="absolute inset-0"
        style={
          {
            '--c': '#7b5f4c',
            backgroundImage: lines,
            backgroundSize: `${size}px ${size}px`,
            opacity: lit ? 1 : 0,
            maskImage: `radial-gradient(240px 240px at ${light.x}% ${light.y}%, black 0%, rgba(0,0,0,0.45) 45%, transparent 72%)`,
            WebkitMaskImage: `radial-gradient(240px 240px at ${light.x}% ${light.y}%, black 0%, rgba(0,0,0,0.45) 45%, transparent 72%)`,
            transition: 'opacity 420ms ease-out',
          } as CSSProperties
        }
      />
      {/* The lamp itself drifts on its own clock, independent of the pointer.
          The cursor reveals the ruling it passes over; the glow is ambient and
          keeps breathing whether anyone is moving the mouse or not. Two warm
          tones only — a multicolour wash fights the foil on the cards. */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute left-1/2 top-1/2 h-[130%] w-[130%] -translate-x-1/2 -translate-y-1/2"
          style={{
            background:
              'radial-gradient(38% 34% at 34% 30%, rgba(255,138,90,0.20), transparent 70%),' +
              'radial-gradient(32% 30% at 68% 66%, rgba(255,90,60,0.13), transparent 72%)',
            animation: 'lampDrift 26s ease-in-out infinite alternate',
          }}
        />
      </div>

      <style>{`
        @keyframes lampDrift {
          0%   { transform: translate(-50%, -50%) translate(-4%, -3%) scale(1); }
          50%  { transform: translate(-50%, -50%) translate(5%, 4%) scale(1.08); }
          100% { transform: translate(-50%, -50%) translate(-2%, 6%) scale(1.03); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="lampDrift"] { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

/** A layer inside a parallax stage. `depth` is how far it sits from the glass. */
export function ParallaxLayer({
  depth,
  pos,
  className,
  style,
  children,
}: {
  depth: number
  pos: { x: number; y: number }
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <div
      className={cn('will-change-transform', className)}
      style={{
        ...style,
        transform: `translate3d(${-pos.x * depth}px, ${-pos.y * depth * 0.6}px, 0) ${style?.transform ?? ''}`,
        transition: 'transform 380ms cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      {children}
    </div>
  )
}

/** Simple fade-and-rise on first view, for prose blocks. */
export function Rise({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const { ref, on } = useReveal<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={cn('transition-all duration-700 ease-out', className)}
      style={{
        transitionDelay: `${delay}ms`,
        opacity: on ? 1 : 0,
        transform: on ? 'translateY(0)' : 'translateY(22px)',
      }}
    >
      {children}
    </div>
  )
}
