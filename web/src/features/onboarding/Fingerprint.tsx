/**
 * The learning fingerprint, drawn — and assembled in front of the student.
 *
 * `fingerprint.ts` decides what the picture is; this decides how it arrives.
 * It mounts once for the whole intake and never remounts: every answer tweens
 * the drawing from where it is to where it now should be, so the student
 * watches one object become theirs rather than a slideshow of five pictures.
 *
 * **Three depths.** The orbit, the plate and a particle layer are separate
 * `<svg>`s stacked in a "camera". The camera pushes in on every answer; the
 * layers drift against the cursor at different rates, so the drawing reads as
 * an object with depth rather than a flat diagram.
 *
 * **What moves, and how.** Transforms and opacity, `stroke-dashoffset` for
 * anything drawn, and a `d` morph on the core contour. Nothing touches layout
 * and nothing animates a filter. The one endless motion — the orbit's turn —
 * rotates its own `<svg>` as a whole so the compositor spins it without a
 * repaint, and it stops while the drawing is offscreen.
 *
 * **Particles are material, not decoration.** They only exist mid-motion. Every
 * mark that stays traces back to an answer; `legend()` can name each one.
 *
 * Under reduced motion every change lands as its final frame, instantly.
 */

import { gsap } from 'gsap'
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react'
import { cn } from '../../lib/cn'
import {
  CORE_R,
  MAX_RINGS,
  MID,
  PLATE_R,
  SIZE,
  STAR_R,
  arcPath,
  contourPath,
  coreRadii,
  legend,
  orbitFor,
  ringsFor,
  rng,
  starFor,
  traits,
  weightsOf,
  type LegendKey,
  type Orbit,
} from './fingerprint'
import { DUR, EASE, EASE_IN, EASE_IN_OUT } from './motion'
import type { Answers } from './steps'

const ORIGIN = `${MID} ${MID}`
/* Drawn strokes use a normalised length. Large, not 1: GSAP rounds px values
   mid-tween, and on a path of length 1 that rounds every draw to on or off. */
const PL = 1000
const DASH = `${PL} ${PL}`
const TAU = Math.PI * 2
const polar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180
  return [MID + r * Math.cos(a), MID + r * Math.sin(a)]
}

/* The dial: a tick every 5°, a long one every 30°. */
const TICKS = Array.from({ length: 72 }, (_, i) => {
  const major = i % 6 === 0
  const [x1, y1] = polar(major ? PLATE_R - 9 : PLATE_R - 5, i * 5)
  const [x2, y2] = polar(PLATE_R, i * 5)
  return { x1, y1, x2, y2, rest: major ? 0.34 : 0.13 }
})

/* The finale's spray. A fixed seed: the same loose material for everyone. */
const MOTES = (() => {
  const r = rng(0x5eed)
  return Array.from({ length: 32 }, () => ({ a: r() * TAU, d: 120 + r() * 110, s: 0.6 + r() * 1.1 }))
})()

const FACETS_MAX = 7
const INNER = [0.36, 0.66]
const TEXT_TOP = 172
const TEXT_BOTTOM = 182
/** How far each layer drifts against the cursor, in px at full deflection. */
const DEPTH = { orbit: 14, plate: 6, motes: 22 }

const BEAT_TONE: Record<LegendKey, string> = {
  seed: 'stroke-ink',
  core: 'stroke-brand-300',
  rings: 'stroke-ink',
  orbit: 'stroke-sky',
  star: 'stroke-sun',
}

export type Beat = { n: number; key: LegendKey }

type Props = {
  /** What to draw. The parent may hold this back a beat behind the real
   *  answers so a change lands when the particles carrying it arrive. */
  answers: Answers
  reduced: boolean
  /** False until the opening has placed the seed. */
  ready: boolean
  /** Bumped on every answer that lands — one push-in and ripple each. */
  beat: Beat
  finale: boolean
  className?: string
}

export function Fingerprint({ answers, reduced, ready, beat, finale, className }: Props) {
  const uid = useId().replace(/[^\w-]/g, '')
  const root = useRef<HTMLDivElement>(null)
  const contours = useRef<SVGPathElement[]>([])
  /** The radii on screen now — a morph starts here, not at the last target,
   *  so a change mid-tween bends instead of jumping. */
  const drawn = useRef<number[] | null>(null)
  const spin = useRef<gsap.core.Tween | null>(null)
  const entered = useRef(false)

  const name = answers.name.trim()
  const named = name.length > 0
  const stylesKey = [...answers.styles].sort().join('|')
  /* eslint-disable react-hooks/exhaustive-deps -- keyed on the sorted styles, not the array */
  const core = useMemo(() => coreRadii(answers.name, answers.styles), [answers.name, stylesKey])
  const weights = useMemo(() => weightsOf(answers.styles), [stylesKey])
  /* eslint-enable react-hooks/exhaustive-deps */
  const rings = useMemo(() => ringsFor(answers.depth), [answers.depth])
  const orbit = useMemo(() => orbitFor(answers.session), [answers.session])
  const star = useMemo(() => starFor(answers.name, answers.goal), [answers.name, answers.goal])
  const trait = useMemo(() => traits(answers.name), [answers.name])
  const tilt = (trait.tilt * 180) / Math.PI

  const q = (key: string) => [...(root.current?.querySelectorAll<SVGElement>(`[data-fp~="${key}"]`) ?? [])]
  const one = (key: string) => q(key)[0]

  /** A tween — or, under reduced motion, its last frame, now. */
  const to = (t: gsap.TweenTarget, v: gsap.TweenVars) =>
    reduced
      ? gsap.set(t, { ...v, duration: 0, delay: 0, stagger: 0, ease: 'none' })
      : gsap.to(t, { overwrite: 'auto', ...v })

  const draw = (r: number[]) => {
    const d = contourPath(r)
    for (const p of contours.current) p.setAttribute('d', d)
  }

  /* ── Mount: resting states, set before the first paint ─────────────── */
  useLayoutEffect(() => {
    const el = root.current!
    contours.current = [...el.querySelectorAll<SVGPathElement>('[data-fp~="contour"]')]
    gsap.set(q('ring'), { svgOrigin: ORIGIN, scale: 1, opacity: 0 })
    gsap.set([...q('spoke'), ...q('inner')], { strokeDashoffset: PL, opacity: 0 })
    gsap.set([one('twin'), one('fill'), one('trace'), one('shock'), one('orbit-svg'), one('star-set'), one('goal-text')], { opacity: 0 })
    gsap.set(one('arc'), { strokeDashoffset: PL })
    gsap.set(q('mote'), { opacity: 0 })
    gsap.set(one('band'), { rotation: 18, xPercent: -160, opacity: 1 })
    const nodes = el.querySelectorAll('*')
    return () => {
      spin.current?.kill()
      gsap.killTweensOf(nodes)
      gsap.killTweensOf(el)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Parallax: the layers drift against the cursor ─────────────────── */
  useEffect(() => {
    if (reduced || !window.matchMedia?.('(pointer: fine)').matches) return
    const layers = (['orbit', 'plate', 'motes'] as const).map((k) => {
      const el = one(`${k}-svg`)
      return {
        x: gsap.quickTo(el, 'x', { duration: 1.2, ease: 'power3.out' }),
        y: gsap.quickTo(el, 'y', { duration: 1.2, ease: 'power3.out' }),
        depth: DEPTH[k],
      }
    })
    const onMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1
      const ny = (e.clientY / window.innerHeight) * 2 - 1
      for (const l of layers) {
        l.x(nx * l.depth)
        l.y(ny * l.depth)
      }
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [reduced]) // eslint-disable-line react-hooks/exhaustive-deps

  /* The endless turn stops while nobody can see it. */
  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => {
      if (!spin.current) return
      if (e.isIntersecting) spin.current.resume()
      else spin.current.pause()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  /* ── Entrance: the dial draws itself around the seed ──────────────── */
  useLayoutEffect(() => {
    const el = root.current!
    if (!ready) {
      gsap.set(el, { autoAlpha: 0 })
      return
    }
    entered.current = true
    gsap.set(el, { autoAlpha: 1 })
    if (reduced) {
      gsap.set(one('plate'), { strokeDashoffset: 0 })
      gsap.set(q('tick'), { opacity: (i: number) => TICKS[i].rest })
      gsap.set(one('seed'), { svgOrigin: ORIGIN, scale: named ? 1 : 0.4, opacity: 1 })
      gsap.set(one('name-text'), { opacity: 1 })
      return
    }
    const tl = gsap.timeline()
    tl.fromTo(one('seed'), { svgOrigin: ORIGIN, scale: 0, opacity: 0 }, { scale: named ? 1 : 0.4, opacity: 1, duration: DUR * 1.4, ease: 'back.out(2)' }, 0)
      .add(() => shock('stroke-brand-300', 3.2), 0.05)
      .fromTo(one('crosshair'), { opacity: 0, scale: 0.2, svgOrigin: ORIGIN }, { opacity: 1, scale: 1, duration: DUR * 1.4, ease: EASE }, 0.1)
      .fromTo(one('plate'), { strokeDashoffset: PL }, { strokeDashoffset: 0, duration: DUR * 2, ease: EASE_IN_OUT }, 0.15)
      .fromTo(q('tick'), { opacity: 0 }, { opacity: 0.9, duration: 0.1, stagger: 0.016, ease: 'none' }, 0.25)
      .to(q('tick'), { opacity: (i: number) => TICKS[i].rest, duration: 0.6, stagger: 0.016, ease: EASE }, 0.35)
      .fromTo(one('name-text'), { opacity: 0, rotation: -24, svgOrigin: ORIGIN }, { opacity: 1, rotation: 0, duration: DUR * 2, ease: EASE }, 0.6)
    return () => {
      tl.progress(1).kill()
    }
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Seed: gaining a name pops it to full size ─────────────────────── */
  const wasNamed = useRef(named)
  useLayoutEffect(() => {
    if (wasNamed.current === named) return
    wasNamed.current = named
    if (!entered.current) return
    to(one('seed'), { svgOrigin: ORIGIN, scale: named ? 1 : 0.4, duration: DUR * 1.2, ease: named ? 'back.out(1.8)' : EASE_IN_OUT })
  }, [named]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Each keystroke of the name nudges the seed — it is listening. */
  useLayoutEffect(() => {
    if (!entered.current || reduced || !named) return
    gsap.fromTo(one('pulse'), { svgOrigin: ORIGIN, scale: 1.07 }, { scale: 1, duration: DUR, ease: EASE, overwrite: 'auto' })
  }, [name]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Core: the contour morphs, and the form twists as it settles ───── */
  const lastStyles = useRef(stylesKey)
  useLayoutEffect(() => {
    const from = drawn.current
    const target = core
    const restyled = lastStyles.current !== stylesKey
    lastStyles.current = stylesKey
    if (!from || reduced || !entered.current) {
      drawn.current = target.slice()
      draw(target)
      return
    }
    // A change of family is the big move; a keystroke in the name is a nudge.
    const start = from.slice()
    const p = { t: 0 }
    const morph = gsap.to(p, {
      t: 1,
      duration: restyled ? DUR * 1.7 : DUR * 0.8,
      ease: restyled ? EASE_IN_OUT : EASE,
      onUpdate: () => {
        const cur = drawn.current!
        for (let i = 0; i < cur.length; i++) cur[i] = start[i] + (target[i] - start[i]) * p.t
        draw(cur)
      },
    })
    if (restyled) {
      // Anticipation, then the twist: a small wind-up against the direction
      // of travel before the form swings through and settles.
      gsap.timeline()
        .to(one('form'), { svgOrigin: ORIGIN, rotation: 6, duration: 0.18, ease: EASE_IN_OUT, overwrite: 'auto' })
        .to(one('form'), { rotation: -28, duration: DUR * 0.7, ease: EASE_IN_OUT })
        .to(one('form'), { rotation: 0, duration: DUR * 1.8, ease: 'elastic.out(1, 0.55)' })
    }
    return () => {
      morph.kill()
    }
  }, [core]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Family marks: facets, inner rings, the twin, the fill ─────────── */
  useLayoutEffect(() => {
    const spokes = q('spoke')
    const shown = spokes.slice(0, trait.facets)
    const w = weights
    to(spokes.slice(trait.facets), { opacity: 0, duration: 0.3 })
    if (w.examples > 0) {
      to(shown, { strokeDashoffset: 0, opacity: 0.3 + 0.45 * w.examples, duration: DUR * 1.2, stagger: 0.07, ease: EASE, delay: 0.3 })
    } else {
      to(shown, { strokeDashoffset: PL, opacity: 0, duration: DUR * 0.6, ease: EASE_IN })
    }
    if (w.definition > 0) {
      to(q('inner'), { strokeDashoffset: 0, opacity: 0.3 + 0.45 * w.definition, duration: DUR * 1.8, stagger: 0.2, ease: EASE_IN_OUT, delay: 0.2 })
    } else {
      to(q('inner'), { strokeDashoffset: PL, opacity: 0, duration: DUR * 0.6, ease: EASE_IN })
    }
    to(one('twin'), {
      opacity: w.comparison > 0 ? 0.25 + 0.4 * w.comparison : 0,
      x: w.comparison > 0 ? 10 : 0,
      duration: DUR * 1.8,
      ease: 'elastic.out(1, 0.6)',
      delay: w.comparison > 0 ? 0.35 : 0,
    })
    to(one('fill'), { opacity: 0.05 + 0.18 * w.intuition, duration: DUR * 1.4, ease: EASE })
  }, [weights, trait.facets]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Rings: thrown outward from the core, each landing a beat late ─── */
  useLayoutEffect(() => {
    const tl = gsap.timeline()
    q('ring').forEach((el, i) => {
      const s = rings[i]
      if (s === undefined) {
        tl.add(to(el, { svgOrigin: ORIGIN, scale: 1, opacity: 0, duration: DUR * 0.8, ease: EASE_IN_OUT }), 0)
      } else {
        const o = 0.55 - (0.38 * i) / Math.max(1, rings.length - 1)
        tl.add(to(el, { svgOrigin: ORIGIN, scale: s, opacity: o, duration: DUR * 1.6, ease: 'back.out(1.6)' }), 0.07 * i)
      }
    })
    return () => {
      tl.kill()
    }
  }, [rings]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Orbit: the session arc draws, the satellite rides it, it spins up ─ */
  const prevOrbit = useRef<Orbit | null>(null)
  useLayoutEffect(() => {
    const prev = prevOrbit.current
    prevOrbit.current = orbit
    const svg = one('orbit-svg')
    if (!orbit) {
      to(svg, { opacity: 0, duration: DUR * 0.6 })
      if (spin.current) gsap.to(spin.current, { timeScale: 0.0001, duration: DUR, overwrite: true })
      return
    }
    // React has already set the track to its new radius; scale back to the
    // old one and glide, so a changed answer resizes rather than redraws.
    if (prev && prev.r !== orbit.r && !reduced) {
      gsap.fromTo(one('orbit-scale'), { svgOrigin: ORIGIN, scale: prev.r / orbit.r }, { scale: 1, duration: DUR * 1.6, ease: EASE_IN_OUT, overwrite: 'auto' })
    }
    to(svg, { opacity: 1, duration: DUR * 0.5 })
    if (!prev && !reduced) {
      gsap.fromTo(one('track'), { svgOrigin: ORIGIN, scale: 0.55, opacity: 0 }, { scale: 1, opacity: 1, duration: DUR * 1.8, ease: EASE })
    }
    to(one('arc'), { strokeDashoffset: PL * (1 - orbit.sweep), duration: DUR * 2.4, ease: EASE_IN_OUT, delay: prev ? 0 : 0.25 })
    to(one('sat'), { svgOrigin: ORIGIN, rotation: orbit.sweep * 360, duration: DUR * 2.4, ease: EASE_IN_OUT, delay: prev ? 0 : 0.25 })

    if (reduced) return
    if (!spin.current) {
      gsap.set(svg, { rotation: trait.spin })
      spin.current = gsap.to(svg, { rotation: trait.spin + 360, duration: 1, ease: 'none', repeat: -1 })
      spin.current.timeScale(0.0001)
    }
    // Whipped round once, then eased down to the session's own tempo: a pace
    // is something you settle into.
    gsap.timeline()
      .to(spin.current, { timeScale: 1 / 3, duration: DUR, ease: EASE_IN, delay: 0.4, overwrite: true })
      .to(spin.current, { timeScale: 1 / orbit.period, duration: DUR * 4, ease: EASE })
  }, [orbit]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── North star: a spark flies out along the bearing and ignites ───── */
  const hasStar = star !== null
  useLayoutEffect(() => {
    if (!entered.current && !hasStar) return
    const set = one('star-set')
    if (!hasStar) {
      to([set, one('goal-text')], { opacity: 0, duration: DUR * 0.6 })
      return
    }
    if (reduced) {
      gsap.set([set, one('goal-text')], { opacity: 1 })
      gsap.set(one('bearing'), { strokeDashoffset: 0 })
      gsap.set(one('star'), { scale: 1, rotation: 0, opacity: 1 })
      return
    }
    const run = STAR_R - 12 - CORE_R * 2
    const tl = gsap.timeline()
    tl.set(set, { opacity: 1 })
      .set(one('star'), { opacity: 0, scale: 0, rotation: -180, transformOrigin: '50% 50%' })
      .set(q('spark'), { opacity: 0 })
      .fromTo(one('comet'), { x: 0, opacity: 0 }, { x: run, opacity: 1, duration: DUR * 1.1, ease: EASE_IN_OUT })
      .fromTo(one('bearing'), { strokeDashoffset: PL }, { strokeDashoffset: 0, duration: DUR * 1.1, ease: EASE_IN_OUT }, '<')
      .to(one('comet'), { opacity: 0, duration: 0.12 })
      .to(one('star'), { opacity: 1, scale: 1, rotation: 0, duration: DUR * 1.4, ease: 'back.out(2.4)' }, '<')
      .add(() => burst(), '<')
      .fromTo(one('goal-text'), { opacity: 0, rotation: -32, svgOrigin: ORIGIN }, { opacity: 1, rotation: 0, duration: DUR * 2, ease: EASE }, '<0.1')
    return () => {
      tl.progress(1).kill()
    }
  }, [hasStar, star?.angle]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Typing the goal makes the star flicker and swell — it is listening too. */
  const lastGoal = useRef(star?.text)
  useLayoutEffect(() => {
    const had = lastGoal.current
    lastGoal.current = star?.text
    if (reduced || !had || !star || had === star.text) return
    gsap.fromTo(one('star'), { scale: 1.45, rotation: 22 }, { scale: 1, rotation: 0, duration: DUR, ease: EASE, overwrite: 'auto' })
    gsap.fromTo(one('halo'), { transformOrigin: '50% 50%', scale: 0.6, opacity: 0.7 }, { scale: 1.8, opacity: 0, duration: DUR, ease: EASE, overwrite: 'auto' })
  }, [star?.text]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Every answer: push in, ripple out, the dial takes a reading ───── */
  const lastBeat = useRef(beat.n)
  useLayoutEffect(() => {
    if (beat.n === lastBeat.current) return
    lastBeat.current = beat.n
    if (reduced || !entered.current) return
    shock(BEAT_TONE[beat.key], 3.9)
    sweep(beat.key === 'star' && star ? star.angle : -90, 0.9)
    push(1.055)
  }, [beat.n]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Finale: spin up, bloom, a sweep of light, and it signs itself ──── */
  useEffect(() => {
    if (!finale || reduced) return
    const tl = gsap.timeline()
    const cam = one('camera')
    tl.to(cam, { scale: 0.94, rotation: 3, duration: 0.3, ease: EASE_IN_OUT, overwrite: 'auto' }, 0)
      .to(cam, { scale: 1.1, rotation: 0, duration: DUR * 1.6, ease: EASE })
      .to(cam, { scale: 1.04, duration: DUR * 2, ease: EASE_IN_OUT })
      .add(() => shock('stroke-brand-300', 4.6), 0.3)
      .add(() => sweep(-90, 1.2), 0.3)
      .fromTo(
        q('mote'),
        { x: 0, y: 0, opacity: 0.95, scale: 0.3 },
        {
          x: (i: number) => Math.cos(MOTES[i].a) * MOTES[i].d,
          y: (i: number) => Math.sin(MOTES[i].a) * MOTES[i].d,
          scale: (i: number) => MOTES[i].s,
          opacity: 0,
          duration: DUR * 2.6,
          stagger: 0.01,
          ease: EASE,
        },
        0.3,
      )
      .fromTo(one('trace'), { opacity: 1, strokeDashoffset: 0 }, { strokeDashoffset: -2 * PL, duration: DUR * 2.6, ease: EASE_IN_OUT }, 0.35)
      .to(one('trace'), { opacity: 0, duration: 0.5 }, '>-0.5')
      .fromTo(one('band'), { xPercent: -160 }, { xPercent: 520, duration: DUR * 2.2, ease: EASE_IN_OUT }, 0.7)
    q('ring')
      .slice(0, rings.length)
      .forEach((r, i) => {
        const rest = Number(gsap.getProperty(r, 'opacity'))
        tl.to(r, { opacity: 1, duration: 0.14, ease: 'none' }, 0.4 + i * 0.08).to(r, { opacity: rest, duration: 0.8, ease: EASE })
      })
    if (star) {
      tl.fromTo(one('star'), { scale: 2, rotation: 135 }, { scale: 1, rotation: 0, duration: DUR * 2, ease: 'elastic.out(1, 0.5)' }, 0.8).add(() => burst(), 0.8)
    }
    if (spin.current && orbit) {
      tl.to(spin.current, { timeScale: 1.1, duration: 0.5, ease: EASE_IN, overwrite: true }, 0.2).to(spin.current, {
        timeScale: 1 / orbit.period,
        duration: DUR * 5,
        ease: EASE,
      })
    }
    return () => {
      tl.progress(1).kill()
    }
  }, [finale]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Shared moves ──────────────────────────────────────────────────── */

  function shock(tone: string, reach: number) {
    const el = one('shock')
    if (!el) return
    el.setAttribute('class', cn('fill-none', tone))
    gsap.fromTo(el, { svgOrigin: ORIGIN, scale: 1, opacity: 0.8 }, { scale: reach, opacity: 0, duration: DUR * 1.9, ease: EASE, overwrite: 'auto' })
  }

  /** The camera: a wind-up, the push, and a slow pull back to rest. */
  function push(amount: number) {
    gsap.timeline()
      .to(one('camera'), { scale: 0.975, duration: 0.14, ease: EASE_IN_OUT, overwrite: 'auto' })
      .to(one('camera'), { scale: amount, duration: DUR * 0.6, ease: EASE })
      .to(one('camera'), { scale: 1, duration: DUR * 1.6, ease: EASE_IN_OUT })
  }

  /** The dial lighting tick by tick, clockwise from `deg`. */
  function sweep(deg: number, duration: number) {
    const ticks = q('tick')
    const start = Math.round((((deg % 360) + 360) % 360) / 5) % ticks.length
    const order = [...ticks.slice(start), ...ticks.slice(0, start)]
    const each = duration / order.length
    gsap.to(order, { opacity: 1, duration: 0.06, stagger: each, ease: 'none', overwrite: 'auto' })
    gsap.to(order, {
      opacity: (i: number) => TICKS[(start + i) % TICKS.length].rest,
      duration: 0.8,
      stagger: each,
      delay: 0.06,
      ease: EASE,
    })
  }

  function burst() {
    gsap.fromTo(q('spark'), { opacity: 1, scale: 0.3, transformOrigin: '0 0' }, { opacity: 0, scale: 1.7, duration: DUR * 1.1, ease: EASE, stagger: 0.015, overwrite: 'auto' })
    gsap.fromTo(one('halo'), { transformOrigin: '50% 50%', scale: 0.2, opacity: 0.9 }, { scale: 2.8, opacity: 0, duration: DUR * 1.5, ease: EASE, overwrite: 'auto' })
  }

  const rows = legend(answers)
  const label = rows.length
    ? `Your learning fingerprint, drawn from your answers: ${rows.map((r) => `${r.label}, ${r.text}`).join('; ')}.`
    : 'Your learning fingerprint. It draws itself as you answer.'
  const orbitR = orbit?.r ?? prevOrbit.current?.r ?? 130
  const starAngle = star?.angle ?? trait.star
  const view = `0 0 ${SIZE} ${SIZE}`
  const layer = 'absolute inset-0 h-full w-full overflow-visible'

  return (
    <div ref={root} role="img" aria-label={label} className={cn('relative aspect-square w-full select-none', className)}>
      <div data-fp="camera" className="absolute inset-0">
        {/* The orbit, alone in its own <svg> so its endless turn is one
            composited rotation rather than a repaint every frame. */}
        <svg data-fp="orbit-svg" viewBox={view} className={cn(layer, 'will-change-transform')} aria-hidden>
          <g data-fp="orbit-scale">
            <circle data-fp="track" cx={MID} cy={MID} r={orbitR} className="fill-none stroke-sky/30" strokeWidth={1} strokeDasharray="1 5" strokeLinecap="round" />
            <circle data-fp="arc" cx={MID} cy={MID} r={orbitR} pathLength={PL} strokeDasharray={DASH} className="fill-none stroke-sky/85" strokeWidth={1.6} strokeLinecap="round" />
            <g data-fp="sat">
              <circle cx={MID + orbitR} cy={MID} r={8} className="fill-sky/15" />
              <circle cx={MID + orbitR} cy={MID} r={3.2} className="fill-sky-deep" />
            </g>
          </g>
        </svg>

        <svg data-fp="plate-svg" viewBox={view} className={layer} aria-hidden>
          <defs>
            <path id={`${uid}-top`} d={arcPath(TEXT_TOP, starAngle + 5)} />
            <path id={`${uid}-bottom`} d={`M${MID - TEXT_BOTTOM} ${MID}A${TEXT_BOTTOM} ${TEXT_BOTTOM} 0 0 0 ${MID + TEXT_BOTTOM} ${MID}`} />
          </defs>

          {/* The plate: a dial the answers are measured onto. */}
          <circle data-fp="plate" cx={MID} cy={MID} r={PLATE_R} pathLength={PL} strokeDasharray={DASH} className="fill-none stroke-ink/20" strokeWidth={1} transform={`rotate(-90 ${MID} ${MID})`} />
          <g className="stroke-ink" strokeWidth={1}>
            {TICKS.map((t, i) => (
              <line key={i} data-fp="tick" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} opacity={0} />
            ))}
          </g>
          <g data-fp="crosshair" className="stroke-ink/10" strokeWidth={1} opacity={0}>
            <line x1={MID - 30} y1={MID} x2={MID + 30} y2={MID} />
            <line x1={MID} y1={MID - 30} x2={MID} y2={MID + 30} />
          </g>

          <circle data-fp="shock" cx={MID} cy={MID} r={CORE_R} className="fill-none stroke-brand-300" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />

          {/* Everything shaped by the core contour turns as one. */}
          <g data-fp="form">
            {Array.from({ length: MAX_RINGS }, (_, i) => (
              <path key={i} data-fp="contour ring" className="fill-none stroke-ink" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <g data-fp="seed" opacity={0}>
              <g data-fp="pulse">
                <path data-fp="contour fill" className="fill-brand stroke-none" />
                <g transform={`translate(${SIZE} 0) scale(-1 1)`}>
                  <path data-fp="contour twin" className="fill-none stroke-brand-300" strokeWidth={1.1} />
                </g>
                <path data-fp="contour" className="fill-none stroke-brand-300" strokeWidth={1.8} strokeLinejoin="round" />
                <path data-fp="contour trace" className="fill-none stroke-brand-deep" strokeWidth={3} strokeLinecap="round" pathLength={PL} strokeDasharray={`${PL * 0.16} ${PL * 0.84}`} />
                {Array.from({ length: FACETS_MAX }, (_, j) => {
                  const deg = tilt + (j * 360) / trait.facets
                  const [x1, y1] = polar(CORE_R * 0.18, deg)
                  const [x2, y2] = polar(CORE_R * 0.68, deg)
                  return <line key={j} data-fp="spoke" x1={x1} y1={y1} x2={x2} y2={y2} pathLength={PL} strokeDasharray={DASH} className="stroke-brand-300" strokeWidth={1} strokeLinecap="round" />
                })}
                {INNER.map((k) => (
                  <circle key={k} data-fp="inner" cx={MID} cy={MID} r={CORE_R * k} pathLength={PL} strokeDasharray={DASH} className="fill-none stroke-ink" strokeWidth={0.8} transform={`rotate(-90 ${MID} ${MID})`} />
                ))}
                <circle cx={MID} cy={MID} r={2.6} className="fill-ink" />
              </g>
            </g>
          </g>

          {/* The name along the foot of the dial, like a signature. */}
          <text data-fp="name-text" className="fill-ink-3 font-mono uppercase" fontSize={9.5} letterSpacing="0.24em" opacity={0}>
            <textPath href={`#${uid}-bottom`} startOffset="50%" textAnchor="middle">
              {name}
            </textPath>
          </text>

          {/* The north star, the bearing to it, and the goal set along the dial. */}
          <g data-fp="star-set">
            <g transform={`rotate(${starAngle} ${MID} ${MID})`}>
              <line data-fp="bearing" x1={MID + CORE_R * 2} y1={MID} x2={MID + STAR_R - 12} y2={MID} pathLength={PL} strokeDasharray={DASH} className="stroke-sun/40" strokeWidth={1} />
              <circle data-fp="comet" cx={MID + CORE_R * 2} cy={MID} r={2.8} className="fill-sun-deep" opacity={0} />
              <g transform={`translate(${MID + STAR_R} ${MID}) rotate(${-starAngle})`}>
                <circle data-fp="halo" r={12} className="fill-none stroke-sun/70" strokeWidth={1} opacity={0} />
                {Array.from({ length: 8 }, (_, k) => {
                  const x = Math.cos((k * TAU) / 8)
                  const y = Math.sin((k * TAU) / 8)
                  return <line key={k} data-fp="spark" x1={x * 9} y1={y * 9} x2={x * 17} y2={y * 17} className="stroke-sun" strokeWidth={1.2} strokeLinecap="round" opacity={0} />
                })}
                <g data-fp="star">
                  <path d="M0 -12 L2.4 -2.4 L12 0 L2.4 2.4 L0 12 L-2.4 2.4 L-12 0 L-2.4 -2.4 Z" className="fill-sun" />
                  <circle r={1.6} className="fill-canvas" />
                </g>
              </g>
            </g>
          </g>
          <text data-fp="goal-text" className="fill-sun-deep font-mono uppercase" fontSize={9.5} letterSpacing="0.16em">
            <textPath href={`#${uid}-top`}>{star?.text ?? ''}</textPath>
          </text>
        </svg>

        {/* A sweep of light for the finale, clipped to the dial. */}
        <div className="pointer-events-none absolute inset-[3%] overflow-hidden rounded-full" aria-hidden>
          <div
            data-fp="band"
            className="absolute inset-y-[-20%] left-0 w-1/4 opacity-0 bg-[linear-gradient(90deg,transparent,rgba(255,237,220,0.14),transparent)]"
          />
        </div>

        <svg data-fp="motes-svg" viewBox={view} className={cn(layer, 'pointer-events-none')} aria-hidden>
          {MOTES.map((_, i) => (
            <circle key={i} data-fp="mote" cx={MID} cy={MID} r={1.9} className={i % 3 === 0 ? 'fill-brand-300' : i % 3 === 1 ? 'fill-sun-deep' : 'fill-ink-2'} />
          ))}
        </svg>
      </div>
    </div>
  )
}

/** Where the seed sits on screen — the target for anything flying into it. */
export function seedPoint(el: Element | null): { x: number; y: number } | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}
