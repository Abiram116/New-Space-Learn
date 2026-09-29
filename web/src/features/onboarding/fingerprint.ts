/**
 * The learning fingerprint, as numbers.
 *
 * Pure: answers in, geometry out. Nothing here knows about React or GSAP,
 * which is what lets the tests pin the one promise the drawing makes — the
 * same answers always draw the same picture — and lets the renderer tween
 * between any two states without caring how either was produced.
 *
 * One layer per answer, each on its own axis so they never fight:
 *
 *   name     → the seed. Every random choice below is drawn from it, in a
 *              fixed order, so two people with the same answers still differ.
 *   style    → the core's shape family. Several picks blend.
 *   depth    → how many rings echo the core, and how tightly.
 *   session  → the orbit: its radius, the arc it sweeps, how fast it turns.
 *   goal     → a north star, with the goal set along the dial beside it.
 *
 * Nothing is drawn that an answer did not ask for — `legend()` can name the
 * source of every mark, and that is the test of whether a mark belongs.
 */

import { STEPS, type Answers, type ChoiceStep, type Option } from './steps'

/** viewBox is SIZE × SIZE, centred on MID. */
export const SIZE = 400
export const MID = SIZE / 2
/** Points around the core contour. Fixed, so any two contours can morph. */
export const SAMPLES = 96
export const CORE_R = 44
export const MAX_RINGS = 6
export const PLATE_R = 194
export const STAR_R = 172
export const TEXT_R = 183

export type Form = 'examples' | 'intuition' | 'definition' | 'comparison'
export const FORMS: Form[] = ['examples', 'intuition', 'definition', 'comparison']

/* Keyed on the stored values in `steps.ts`. The tests fail if a step is
   reworded without updating these — a silent miss would draw nothing for an
   answer the student gave. */
export const FORM_BY_VALUE: Record<string, Form> = {
  'examples first, then the general rule': 'examples',
  'the intuition first, then the detail': 'intuition',
  'the precise definition first, then examples': 'definition',
  'comparisons against things I already know': 'comparison',
}

/** Ring scales, relative to the core. Short: two, wide apart. Deep: six,
 *  tight. Read the room: four, opening out — short near, long far. */
export const RINGS_BY_VALUE: Record<string, number[]> = {
  'Keep explanations short and direct.': [1.36, 1.74],
  'Go into real depth; I would rather have too much than too little.': [
    1.12, 1.24, 1.36, 1.48, 1.6, 1.72,
  ],
  'Match the depth to the question rather than a fixed length.': [1.12, 1.28, 1.5, 1.78],
}

/** Longer sessions sit further out and turn more slowly — unhurried. */
export const ORBIT_BY_VALUE: Record<string, { r: number; period: number }> = {
  '15': { r: 124, period: 36 },
  '30': { r: 135, period: 56 },
  '60': { r: 146, period: 84 },
  '120': { r: 156, period: 130 },
}

export type Orbit = {
  r: number
  /** Fraction of the circle the session arc covers: minutes / 120. */
  sweep: number
  /** Seconds per revolution of the ambient turn. */
  period: number
}

export type Star = {
  /** Degrees, SVG convention: 0 is 3 o'clock, positive is clockwise. */
  angle: number
  text: string
}

export type Fingerprint = {
  core: number[]
  facets: { count: number; tilt: number }
  weights: Record<Form, number>
  rings: number[]
  orbit: Orbit | null
  star: Star | null
  /** Where the orbit starts turning from, in degrees. */
  spin: number
  named: boolean
}

/* ── Seeding ──────────────────────────────────────────────────────────── */

/** FNV-1a. Case and spacing are not part of a name's identity. */
export function seedOf(name: string): number {
  const s = name.trim().toLowerCase().replace(/\s+/g, ' ')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — small, fast, and plenty for choosing angles. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Everything the name decides, drawn in a fixed order. Angles in radians
 *  except `spin` and `star`, which are degrees for the renderer. */
export function traits(name: string) {
  const r = rng(seedOf(name))
  const TAU = Math.PI * 2
  return {
    facets: 5 + Math.floor(r() * 3),
    tilt: r() * TAU,
    wobble: [r(), r(), r(), r()].map((x) => x * TAU),
    blob: [r(), r(), r()].map((x) => x * TAU),
    spin: r() * 360,
    star: -90 + (r() - 0.5) * 56,
  }
}

/* ── Layers ───────────────────────────────────────────────────────────── */

export function formsOf(styles: string[]): Form[] {
  // Sorted so the order they were tapped in cannot change the drawing.
  return FORMS.filter((f) => styles.some((v) => FORM_BY_VALUE[v] === f))
}

export function weightsOf(styles: string[]): Record<Form, number> {
  const forms = formsOf(styles)
  const w = { examples: 0, intuition: 0, definition: 0, comparison: 0 }
  for (const f of forms) w[f] = 1 / forms.length
  return w
}

/**
 * The core contour: SAMPLES radii around the centre.
 *
 * Each family is a radius function normalised to a mean of 1, so blending is
 * an average and no pick makes the core bigger — only a different shape.
 */
export function coreRadii(name: string, styles: string[]): number[] {
  const t = traits(name)
  const forms = formsOf(styles)
  const m = t.facets
  const half = Math.PI / m
  // Mean radius of a regular polygon with circumradius 1, for normalising.
  const polyMean = (Math.cos(half) / half) * Math.log(1 / Math.cos(half) + Math.tan(half))

  const family: Record<Form, (th: number) => number> = {
    // Faceted: a regular polygon, as many sides as the name decides.
    examples: (th) => {
      const p = 2 * half
      const phi = ((((th - t.tilt) % p) + p) % p) - half
      return Math.cos(half) / Math.cos(phi) / polyMean
    },
    // Soft: a few low harmonics — a pebble, not a star.
    intuition: (th) =>
      1 +
      0.13 * Math.cos(2 * th + t.blob[0]) +
      0.08 * Math.cos(3 * th + t.blob[1]) +
      0.045 * Math.cos(5 * th + t.blob[2]),
    // Precise: a true circle. Its character is in the inner rings.
    definition: () => 1,
    // Paired: two lobes either side of a waist.
    comparison: (th) => 1 + 0.3 * Math.cos(2 * th),
  }

  const out: number[] = []
  for (let i = 0; i < SAMPLES; i++) {
    const th = (i / SAMPLES) * Math.PI * 2
    let shape = 1
    if (forms.length) {
      shape = 0
      for (const f of forms) shape += family[f](th)
      shape /= forms.length
    }
    // The name's own hand, under every family: faint, but never the same twice.
    let wob = 1
    for (let k = 0; k < 4; k++) wob += (0.028 / (k + 1)) * Math.cos((k + 2) * th + t.wobble[k])
    out.push(Math.round(CORE_R * shape * wob * 100) / 100)
  }
  return out
}

export function ringsFor(depth: string | null): number[] {
  return (depth && RINGS_BY_VALUE[depth]) || []
}

export function orbitFor(session: string | null): Orbit | null {
  const spec = session ? ORBIT_BY_VALUE[session] : undefined
  if (!spec) return null
  return { ...spec, sweep: Math.min(1, Number(session) / 120) }
}

/** Long goals are shortened on the dial only; the legend carries it whole. */
export const STAR_TEXT_MAX = 52

export function starFor(name: string, goal: string): Star | null {
  const text = goal.trim().replace(/\s+/g, ' ')
  if (!text) return null
  return {
    angle: traits(name).star,
    text: text.length > STAR_TEXT_MAX ? `${text.slice(0, STAR_TEXT_MAX - 1).trimEnd()}…` : text,
  }
}

export function fingerprint(a: Answers): Fingerprint {
  const t = traits(a.name)
  return {
    core: coreRadii(a.name, a.styles),
    facets: { count: t.facets, tilt: (t.tilt * 180) / Math.PI },
    weights: weightsOf(a.styles),
    rings: ringsFor(a.depth),
    orbit: orbitFor(a.session),
    star: starFor(a.name, a.goal),
    spin: t.spin,
    named: a.name.trim().length > 0,
  }
}

/* ── Drawing ──────────────────────────────────────────────────────────── */

/**
 * A closed, smooth path through the radii: quadratic segments between
 * midpoints, so a polygon family keeps its facets but loses the pixel-sharp
 * corner that would read as a rendering error at this size.
 */
export function contourPath(radii: number[]): string {
  const n = radii.length
  const pts = radii.map((r, i) => {
    const th = (i / n) * Math.PI * 2
    return [MID + r * Math.cos(th), MID + r * Math.sin(th)]
  })
  const mid = (a: number[], b: number[]) => `${f((a[0] + b[0]) / 2)} ${f((a[1] + b[1]) / 2)}`
  let d = `M${mid(pts[n - 1], pts[0])}`
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    d += `Q${f(p[0])} ${f(p[1])} ${mid(p, pts[(i + 1) % n])}`
  }
  return `${d}Z`
}

const f = (x: number) => x.toFixed(2)

/** A full circle of radius r starting at `deg` and running clockwise — the
 *  track the goal is set along. */
export function arcPath(r: number, deg: number): string {
  const a = (deg * Math.PI) / 180
  const x = MID + r * Math.cos(a)
  const y = MID + r * Math.sin(a)
  const x2 = MID - r * Math.cos(a)
  const y2 = MID - r * Math.sin(a)
  return `M${f(x)} ${f(y)}A${r} ${r} 0 1 1 ${f(x2)} ${f(y2)}A${r} ${r} 0 1 1 ${f(x)} ${f(y)}`
}

/* ── Legend ───────────────────────────────────────────────────────────── */

export type LegendKey = 'seed' | 'core' | 'rings' | 'orbit' | 'star'
export type LegendRow = { key: LegendKey; label: string; text: string }

function options(id: string): Option[] {
  return (STEPS.find((s) => s.id === id) as ChoiceStep).options
}

/**
 * What each mark on the drawing came from, in the student's own terms: the
 * hint of the option they chose, or the words they typed. Unanswered layers
 * are simply absent — nothing is filled in on their behalf.
 */
export function legend(a: Answers): LegendRow[] {
  const rows: LegendRow[] = []
  const name = a.name.trim()
  if (name) rows.push({ key: 'seed', label: 'Seed', text: `Grown from “${name}”` })
  const styles = options('style').filter((o) => a.styles.includes(o.value))
  if (styles.length) rows.push({ key: 'core', label: 'Core', text: styles.map((o) => o.hint).join(' · ') })
  const depth = options('depth').find((o) => o.value === a.depth)
  if (depth) rows.push({ key: 'rings', label: 'Rings', text: depth.hint })
  const session = options('session').find((o) => o.value === a.session)
  if (session) rows.push({ key: 'orbit', label: 'Orbit', text: `${session.label} — ${session.hint.toLowerCase()}` })
  const goal = a.goal.trim()
  if (goal) rows.push({ key: 'star', label: 'North star', text: goal })
  return rows
}
