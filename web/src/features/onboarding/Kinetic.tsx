/**
 * The intake's kinetic type: the opening title, the name moment, and the
 * masked word splits every question arrives through.
 *
 * Each word (or letter) sits in its own `overflow: hidden` box and travels by
 * `yPercent` inside it, so text is revealed by a mask sliding rather than by
 * fading — the static clip does the "wipe", the transform does the motion,
 * and neither touches layout.
 */

import { gsap } from 'gsap'
import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import { cn } from '../../lib/cn'
import { DUR, EASE, EASE_IN, EASE_IN_OUT } from './motion'

type Point = { x: number; y: number }

const MASK = 'inline-block overflow-hidden pb-[0.14em] -mb-[0.14em] align-bottom'

/** Words, each in a mask. Animate `[data-word]`. */
export function Words({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className={MASK}>
            <span data-word className="inline-block">
              {w}
            </span>
          </span>
          {i < words.length - 1 && ' '}
        </Fragment>
      ))}
    </>
  )
}

/** Letters, each in a mask, words kept unbreakable. Animate `[data-letter]`. */
export function Letters({ text, className }: { text: string; className?: string }) {
  const words = text.split(' ')
  return (
    <span className={className} aria-label={text}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span aria-hidden className="inline-block whitespace-nowrap">
            {[...w].map((ch, j) => (
              <span key={j} className={MASK}>
                <span data-letter className="inline-block">
                  {ch}
                </span>
              </span>
            ))}
          </span>
          {i < words.length - 1 && ' '}
        </Fragment>
      ))}
    </span>
  )
}

/* ── Opening ─────────────────────────────────────────────────────────── */

/**
 * The title sequence: a point of light ignites in the dim room, the title is
 * set around it, and then the light travels to where the fingerprint will be
 * and becomes its seed.
 *
 * It starts in the room as the sign-up handoff left it — no black frame — so
 * the curtain lift and this still read as one move. Any click or key
 * fast-forwards it; it never holds anyone.
 */
export function Opening({
  run,
  target,
  onCue,
  onSeed,
  onEnd,
}: {
  /** False while a curtain still covers the page. */
  run: boolean
  target: () => Point | null
  /** The questions may start arriving. */
  onCue: () => void
  /** The light has reached the seed. */
  onSeed: () => void
  onEnd: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const cb = useRef({ onCue, onSeed, onEnd, target })
  useEffect(() => {
    cb.current = { onCue, onSeed, onEnd, target }
  })

  useLayoutEffect(() => {
    const el = root.current!
    const $ = (s: string) => [...el.querySelectorAll<HTMLElement>(s)]
    const light = $('[data-light]')[0]
    gsap.set($('[data-letter]'), { yPercent: 115, rotation: 9 })
    gsap.set($('[data-word]'), { yPercent: 115 })
    gsap.set([light, ...$('[data-glow]'), ...$('[data-ring]'), ...$('[data-skip]')], { opacity: 0 })
    if (!run) return

    const tl = gsap.timeline({ onComplete: () => cb.current.onEnd() })
    tl.fromTo(light, { scale: 0, opacity: 1 }, { scale: 1, duration: DUR * 1.2, ease: 'back.out(3)' }, 0.1)
      // Ignition: it catches, gutters, then holds.
      .fromTo(
        $('[data-glow]'),
        { scale: 0.15, opacity: 0 },
        {
          keyframes: [
            { scale: 0.55, opacity: 0.9, duration: 0.22, ease: EASE },
            { opacity: 0.3, duration: 0.12, ease: 'none' },
            { scale: 1, opacity: 1, duration: DUR * 1.4, ease: EASE },
          ],
        },
        0.1,
      )
      .fromTo($('[data-ring]'), { scale: 0.1, opacity: 0.7 }, { scale: 3.4, opacity: 0, duration: DUR * 2.4, ease: EASE, stagger: 0.35 }, 0.2)
      .to($('[data-letter]'), { yPercent: 0, rotation: 0, duration: DUR * 1.3, ease: EASE, stagger: 0.03 }, 0.5)
      .to($('[data-word]'), { yPercent: 0, duration: DUR * 1.2, ease: EASE, stagger: 0.04 }, 1.1)
      .to($('[data-skip]'), { opacity: 1, duration: DUR }, 1.4)
      // Out with momentum — up and away, fastest at the end.
      .to($('[data-letter]'), { yPercent: -115, duration: DUR * 0.7, ease: EASE_IN, stagger: 0.012 }, 2.75)
      .to($('[data-word]'), { yPercent: -115, duration: DUR * 0.6, ease: EASE_IN, stagger: 0.02 }, 2.75)
      .to($('[data-skip]'), { opacity: 0, duration: 0.3 }, 2.75)
      .add(() => cb.current.onCue(), 2.95)
      // The light travels to the stage and shrinks into the seed.
      .to(
        light,
        {
          x: () => delta(light, cb.current.target()).x,
          y: () => delta(light, cb.current.target()).y,
          scale: 0.45,
          duration: DUR * 1.4,
          ease: EASE_IN_OUT,
        },
        2.9,
      )
      .to($('[data-glow]'), { opacity: 0, scale: 0.4, duration: DUR * 1.2, ease: EASE_IN_OUT }, 2.9)
      .add(() => cb.current.onSeed(), 3.85)
      .to(light, { opacity: 0, duration: 0.25 }, 3.85)

    // Any input fast-forwards rather than cuts, so what you skip to is still
    // the end of the same move. A short guard stops the click that got you
    // here from counting.
    const armed = performance.now() + 350
    const hurry = () => {
      if (performance.now() > armed) tl.timeScale(5)
    }
    window.addEventListener('pointerdown', hurry)
    window.addEventListener('keydown', hurry)
    return () => {
      window.removeEventListener('pointerdown', hurry)
      window.removeEventListener('keydown', hurry)
      tl.kill()
    }
  }, [run])

  return (
    <div ref={root} className="pointer-events-none fixed inset-0 z-30" role="status" aria-live="polite">
      <div className="absolute left-1/2 top-[42%]">
        <div data-glow className="absolute left-0 top-0 h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,196,150,0.30),rgba(255,160,110,0.08)_55%,transparent)]" />
        <div data-ring className="absolute left-0 top-0 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(255,220,190,0.5)]" />
        <div data-ring className="absolute left-0 top-0 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(255,220,190,0.3)]" />
        <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2">
          <div data-light className="h-3 w-3 rounded-full bg-[#fff6ec] shadow-[0_0_18px_6px_rgba(255,190,140,0.55)]" />
        </div>
      </div>

      <div className="absolute inset-x-4 top-[calc(42%+3.5rem)] flex flex-col items-center gap-4 text-center">
        <p className="nameplate text-[clamp(30px,6.4vw,84px)] leading-[0.95] text-ink">
          <Letters text="Let's get to know you" />
        </p>
        <p className="max-w-md text-[15px] leading-relaxed text-ink-3">
          <Words text="Five quick questions. Each answer draws part of your learning fingerprint." />
        </p>
      </div>
      <span data-skip className="setcode absolute bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
        Click anywhere to skip
      </span>
    </div>
  )
}

/** Where `el` has to travel to put its centre on `to`. */
function delta(el: Element, to: Point | null): Point {
  if (!to) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  const x = Number(gsap.getProperty(el, 'x')) || 0
  const y = Number(gsap.getProperty(el, 'y')) || 0
  return { x: to.x - (r.left + r.width / 2) + x, y: to.y - (r.top + r.height / 2) + y }
}

/* ── The name moment ─────────────────────────────────────────────────── */

/**
 * Their name, set huge across the stage — then every letter peels off and
 * falls into the seed of the fingerprint, which is the point of the question:
 * the drawing is grown from you.
 */
export function NameCondense({
  name,
  target,
  onLand,
  onEnd,
}: {
  name: string
  target: () => Point | null
  onLand: () => void
  onEnd: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const cb = useRef({ onLand, onEnd, target })
  useEffect(() => {
    cb.current = { onLand, onEnd, target }
  })

  useLayoutEffect(() => {
    const letters = [...root.current!.querySelectorAll<HTMLElement>('[data-letter]')]
    const spin = letters.map(() => (Math.random() - 0.5) * 120)
    const tl = gsap.timeline({ onComplete: () => cb.current.onEnd() })
    tl.fromTo(letters, { yPercent: 120, rotation: 12 }, { yPercent: 0, rotation: 0, duration: DUR * 1.1, ease: EASE, stagger: 0.035 })
      .fromTo(root.current!.firstElementChild, { scale: 1.1 }, { scale: 1, duration: DUR * 2.2, ease: EASE }, 0)
      // The masks let go so the letters can leave them.
      .add(() => {
        for (const l of letters) (l.parentElement as HTMLElement).style.overflow = 'visible'
      }, 1)
      .to(
        letters,
        {
          x: (i: number) => delta(letters[i], cb.current.target()).x,
          y: (i: number) => delta(letters[i], cb.current.target()).y,
          rotation: (i: number) => spin[i],
          scale: 0.06,
          duration: DUR * 1.2,
          ease: EASE_IN_OUT,
          stagger: { each: 0.03, from: 'center' },
        },
        1,
      )
      .to(letters, { opacity: 0, duration: 0.15, stagger: { each: 0.03, from: 'center' } }, 1 + DUR * 1.2 - 0.15)
      .add(() => cb.current.onLand(), 1 + DUR * 1.05)
    return () => {
      tl.kill()
    }
  }, [])

  const size = Math.min(13, 100 / Math.max(5, name.length))
  return (
    <div ref={root} aria-hidden className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center px-4">
      <p className={cn('nameplate text-center leading-[0.9] text-ink')} style={{ fontSize: `clamp(40px, ${size}vw, 176px)` }}>
        <Letters text={name} />
      </p>
    </div>
  )
}
