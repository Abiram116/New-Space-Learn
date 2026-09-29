/**
 * The intake's kinetic type: the opening title, the name moment, and the
 * masked word splits every question arrives through.
 *
 * Each word (or letter) sits in its own `overflow: hidden` box and travels by
 * `yPercent` inside it, so text is revealed by a mask sliding rather than by
 * fading — the static clip does the "wipe", the transform does the motion,
 * and neither touches layout. Nothing here measures text, so a late font swap
 * cannot leave a split measured against the wrong face.
 */

import { gsap } from 'gsap'
import { Fragment, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { OrganismEngine } from './engine'
import { DUR, EASE, EASE_IN } from './motion'

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

/** Resolve when the page's fonts are in, or after a ceiling — never hang. */
function fontsReady(ceilingMs = 900): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (!fonts) return Promise.resolve()
  return Promise.race([fonts.ready.then(() => undefined), new Promise<void>((r) => setTimeout(r, ceilingMs))])
}

/* ── Opening ─────────────────────────────────────────────────────────── */

/**
 * The title sequence. The room goes dark; particles converge from beyond the
 * edges into one luminous seed; it blooms, and the title resolves out of the
 * light — whole words coming into focus, not letters jittering in. Then the
 * title lifts away and the organism is born from the seed, travelling to its
 * place as the stage opens around it.
 *
 * The particles are the engine's; this owns the one timeline that drives them
 * (through `engine.dir`) and the type, so there is exactly one clock. Any
 * click or key fast-forwards it — never cuts, so what you skip to is still the
 * end of the same move. About 3.6 seconds uninterrupted.
 */
export function Opening({
  run,
  engine,
  veil,
  onStage,
  onEnd,
}: {
  /** False while a curtain still covers the page. */
  run: boolean
  engine: RefObject<OrganismEngine | null>
  /** The darkness the sequence starts in; lifted as the stage opens. */
  veil: RefObject<HTMLDivElement | null>
  /** The questions may start arriving. */
  onStage: () => void
  onEnd: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const cb = useRef({ onStage, onEnd })
  useEffect(() => {
    cb.current = { onStage, onEnd }
  })

  useLayoutEffect(() => {
    const el = root.current!
    const $ = (s: string) => [...el.querySelectorAll<HTMLElement>(s)]
    const words = $('[data-title] [data-word]')
    const sub = $('[data-sub]')
    const hint = $('[data-skip]')
    const sheen = $('[data-sheen]')
    gsap.set(words, { yPercent: 60, opacity: 0, filter: 'blur(14px)' })
    gsap.set([...sub, ...hint], { opacity: 0 })
    gsap.set(sheen, { backgroundPosition: '130% 0', opacity: 0 })
    if (!run) return

    let tl: gsap.core.Timeline | null = null
    let dead = false
    const hurry = () => {
      if (tl && performance.now() > armed) tl.timeScale(6)
    }
    const armed = performance.now() + 300
    window.addEventListener('pointerdown', hurry)
    window.addEventListener('keydown', hurry)

    void fontsReady().then(() => {
      if (dead) return
      const d = engine.current?.dir
      const dir = d ?? { conv: 1, birth: 1, bloom: 0 }
      // The seed hangs just above the title, so its bloom spills down onto
      // the type as it resolves — lit from above, not stamped over.
      const title = el.querySelector('[data-title]')!.getBoundingClientRect()
      if (d) {
        d.seedX = title.left + title.width / 2
        d.seedY = title.top - Math.min(150, Math.max(70, window.innerHeight * 0.11))
      }
      tl = gsap
        .timeline({ onComplete: () => cb.current.onEnd() })
        .to(dir, { conv: 1, duration: 1.3, ease: 'power2.inOut' }, 0)
        // The bloom: a fast catch and a long, soft decay.
        .to(dir, { bloom: 1, duration: 0.16, ease: 'power2.out' }, 1.18)
        .to(dir, { bloom: 0.28, duration: 1.2, ease: EASE }, 1.34)
        .to(veil.current, { opacity: 0.62, duration: 0.9, ease: EASE }, 1.2)
        .to(words, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 1.05, ease: EASE, stagger: 0.075 }, 1.26)
        .fromTo(el.querySelector('[data-title]'), { scale: 1.06 }, { scale: 1, duration: 1.6, ease: EASE }, 1.26)
        .to(sheen, { opacity: 1, duration: 0.2 }, 1.7)
        .to(sheen, { backgroundPosition: '-30% 0', duration: 1.1, ease: 'power2.inOut' }, 1.7)
        .to(sub, { opacity: 1, duration: 0.7, ease: EASE }, 1.7)
        .to(hint, { opacity: 1, duration: 0.6 }, 1.5)
        // Out: the title lifts and softens away as the organism is born.
        .to(words, { yPercent: -40, opacity: 0, filter: 'blur(10px)', duration: 0.55, ease: EASE_IN, stagger: 0.03 }, 2.5)
        .to([...sub, ...hint, ...sheen], { opacity: 0, duration: 0.4, ease: EASE_IN }, 2.5)
        .to(dir, { birth: 1, duration: 1.25, ease: 'none' }, 2.52)
        .to(dir, { bloom: 0, duration: 0.8, ease: EASE }, 2.52)
        .to(veil.current, { opacity: 0, duration: 1.1, ease: EASE }, 2.55)
        .add(() => cb.current.onStage(), 2.8)
    })

    return () => {
      dead = true
      window.removeEventListener('pointerdown', hurry)
      window.removeEventListener('keydown', hurry)
      tl?.kill()
    }
  }, [run, engine, veil])

  return (
    <div ref={root} className="pointer-events-none fixed inset-0 z-30 grid place-items-center px-4" role="status" aria-live="polite">
      <div className="flex translate-y-[4vh] flex-col items-center gap-[clamp(12px,2vh,22px)] text-center">
        <p data-title className="nameplate relative text-[clamp(34px,min(4.9vw,8.6vh),128px)] leading-[0.95] text-ink">
          {/* Unmasked, unlike the questions: the title resolves out of a blur,
              and a mask would clip the blur's halo into hard edges. */}
          {"Let's get to know you".split(' ').map((w, i, all) => (
            <Fragment key={i}>
              <span data-word className="inline-block will-change-[filter,transform]">
                {w}
              </span>
              {i < all.length - 1 && ' '}
            </Fragment>
          ))}
          {/* A single pass of light across the type once it has resolved. */}
          <span
            data-sheen
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,transparent_38%,rgba(255,236,214,0.95)_50%,transparent_62%)] bg-[length:260%_100%] bg-clip-text text-transparent"
          >
            Let's get to know you
          </span>
        </p>
        <p data-sub className="max-w-[44rem] text-[clamp(15px,1.05vw,20px)] leading-relaxed text-ink-3">
          Five quick questions. Each answer shapes your learning fingerprint.
        </p>
      </div>
      <span data-skip className="setcode absolute bottom-[max(2rem,5vh)] left-1/2 -translate-x-1/2 whitespace-nowrap">
        Click anywhere to skip
      </span>
    </div>
  )
}

/* ── The name moment ─────────────────────────────────────────────────── */

/**
 * Their name, set huge across the stage — then it dissolves. Each letter
 * crumbles into the particles it is made of, in reading order, and they stream
 * along curved paths into the organism and *stay*: the organism absorbs them
 * and takes on the name's colour signature as they land.
 *
 * The hand-off is continuous by construction: the engine lays the sampled
 * glyph points exactly under each letter before it fades, so what you see
 * change is the letter turning into grain, not one thing replacing another.
 */
export function NameBurst({
  name,
  engine,
  onLand,
  onEnd,
}: {
  name: string
  engine: RefObject<OrganismEngine | null>
  onLand: () => void
  onEnd: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const cb = useRef({ onLand, onEnd })
  useEffect(() => {
    cb.current = { onLand, onEnd }
  })

  useLayoutEffect(() => {
    const el = root.current!
    const letters = [...el.querySelectorAll<HTMLElement>('[data-letter]')]
    let landed = false
    const land = () => {
      if (landed) return
      landed = true
      cb.current.onLand()
    }
    const tl = gsap.timeline()
    tl.fromTo(letters, { yPercent: 115, opacity: 0 }, { yPercent: 0, opacity: 1, duration: DUR * 1.1, ease: EASE, stagger: 0.035 })
      .fromTo(el.firstElementChild, { scale: 1.08 }, { scale: 1, duration: DUR * 2.4, ease: EASE }, 0)
      .add(() => {
        // Reading order, left to right, a letter every 55ms.
        const order = letters
          .map((l) => ({ el: l, x: l.getBoundingClientRect().left }))
          .sort((a, b) => a.x - b.x)
          .map((l, i) => ({ el: l.el, delay: 0.12 + i * 0.055 }))
        for (const l of letters) (l.parentElement as HTMLElement).style.overflow = 'visible'
        const eng = engine.current
        if (!eng) {
          land()
          cb.current.onEnd()
          return
        }
        eng.absorb(order, { onFirst: land, onDone: () => cb.current.onEnd() })
        // Each letter fades off the top of its own grain, in its turn.
        for (const o of order) {
          gsap.to(o.el, { opacity: 0, filter: 'blur(2px)', duration: 0.32, ease: 'power1.in', delay: o.delay })
        }
      }, 1.05)
    return () => {
      tl.kill()
      gsap.killTweensOf(letters)
    }
  }, [engine])

  const size = Math.min(13, 100 / Math.max(5, name.length))
  return (
    <div ref={root} aria-hidden className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center px-4">
      <p className="nameplate text-center leading-[0.9] text-ink" style={{ fontSize: `clamp(44px, min(${size}vw, 22vh), 220px)` }}>
        <Letters text={name} />
      </p>
    </div>
  )
}
