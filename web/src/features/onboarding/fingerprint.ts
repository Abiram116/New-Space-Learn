/**
 * The learning fingerprint — the student's own galaxy — as numbers.
 *
 * Pure: answers in, parameters out, and a field that turns parameters into
 * star positions. Nothing here knows about React, GSAP or the canvas, which is what
 * lets the tests pin the promises the drawing makes — the same answers always
 * grow the same organism, and moving between two sets of answers is a smooth
 * interpolation, never a swap — and lets the renderer (`engine.ts`) stay a
 * dumb loop over particles.
 *
 * One parameter group per answer, each on its own axis so they never fight:
 *
 *   name     → the seed and the colour signature (a warm and a cool nebula
 *              tint). Every random choice below is drawn from it, in a fixed
 *              order, so two people with the same answers still differ.
 *              Before a name the galaxy is colourless starlight.
 *   style    → morphology: a barred spiral (examples), a soft grand-design
 *              spiral (intuition), a ring galaxy (definition), an interacting
 *              pair (comparison). Several picks blend.
 *   depth    → how many arms / rings, how crisply, and how many stars.
 *   session  → the tempo of its slow differential rotation, and a faint ring
 *              of stars whose arc is the session's share of two hours.
 *   goal     → the north star: one bright gold star on the rim, with a
 *              gentle drift of stars toward it.
 *
 * Nothing is drawn that an answer did not ask for — `legend()` can name the
 * source of every structure, and that is the test of whether one belongs.
 */

import { STEPS, type Answers, type ChoiceStep, type Option } from './steps'

const TAU = Math.PI * 2
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

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

/** Short: two arms / rings, sparse. Deep: many, tight, dense. Read the room:
 *  in between, opening outward — short near the core, long far out. */
export const DEPTH_BY_VALUE: Record<string, { layers: number; crisp: number; gamma: number; density: number }> = {
  'Keep explanations short and direct.': { layers: 2, crisp: 0.86, gamma: 1, density: 0.6 },
  'Go into real depth; I would rather have too much than too little.': { layers: 6, crisp: 0.82, gamma: 1, density: 1 },
  'Match the depth to the question rather than a fixed length.': { layers: 4, crisp: 0.8, gamma: 1.55, density: 0.8 },
}

/** Longer sessions turn more slowly — majestic rather than busy — with the
 *  outer ring further out. Its arc is the session's share of two hours. */
export const SESSION_BY_VALUE: Record<string, { tempo: number; orbitR: number; sweep: number }> = {
  '15': { tempo: 0.34, orbitR: 1.04, sweep: 0.125 },
  '30': { tempo: 0.25, orbitR: 1.08, sweep: 0.25 },
  '60': { tempo: 0.17, orbitR: 1.11, sweep: 0.5 },
  '120': { tempo: 0.11, orbitR: 1.14, sweep: 1 },
}

/**
 * The palette the organism paints with, by design-token name. Parameters hold
 * *weights* over these slots rather than RGB, so the engine resolves them
 * against the live CSS tokens — a retuned palette flows straight through, and
 * the parameters stay pure numbers that interpolate.
 */
export const SLOTS = ['ink', 'brand', 'brand-300', 'sky', 'sun', 'coral', 'jade', 'azure'] as const
export type Slot = (typeof SLOTS)[number]
/** Used only when a token cannot be read (tests, a missing variable) — the
 *  engine reads the live `--color-*` tokens at runtime. */
export const FALLBACK_RGB: Record<Slot, [number, number, number]> = {
  ink: [245, 237, 228],
  brand: [255, 90, 60],
  'brand-300': [255, 139, 118],
  sky: [53, 214, 232],
  sun: [255, 197, 61],
  coral: [255, 61, 139],
  jade: [34, 211, 160],
  azure: [85, 144, 255],
}

/** Colour signatures a name can draw: always one warm and one cool tint,
 *  the way a real nebula is — never two neons fighting. */
export const SIGNATURES: [Slot, Slot][] = [
  ['sun', 'azure'],
  ['brand-300', 'sky'],
  ['coral', 'azure'],
  ['sun', 'sky'],
  ['brand-300', 'azure'],
  ['coral', 'sky'],
  ['brand', 'azure'],
  ['sun', 'brand-300'],
]

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

/** Everything the name decides, drawn in a fixed order. Radians throughout. */
export function traits(name: string) {
  const r = rng(seedOf(name))
  return {
    tilt: r() * TAU,
    spin: r() * TAU,
    star: -Math.PI / 2 + (r() - 0.5) * 1.1,
    signature: Math.floor(r() * SIGNATURES.length),
  }
}

/* ── Answers → parameters ─────────────────────────────────────────────── */

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
 * Everything the organism is, as plain numbers. Every field interpolates:
 * scalars linearly, angles along the shorter arc, vectors element-wise.
 */
export type Params = {
  /** Morphology weights, in FORMS order. All zero is an unformed nebula. */
  form: number[]
  /** Orientation of the bar / the binary's axis. */
  tilt: number
  /** Depth: sets arm and ring counts; 0 before it is answered. */
  layers: number
  /** How tightly stars hold to their arms and rings. */
  crisp: number
  /** >1 pushes rings outward — "opening out". */
  gamma: number
  /** Share of the star budget that is alive. */
  density: number
  /** How much stars drift off their paths. */
  turb: number
  /** Rotation speed, rad/s at the core; the rim turns slower. */
  tempo: number
  /** Presence of the orbit ring, 0–1. */
  orbit: number
  orbitR: number
  sweep: number
  spin: number
  /** Presence of the north star, 0–1. */
  star: number
  starAngle: number
  /** Three colours × SLOTS weights: lead, counter, highlight. */
  colour: number[]
  /** Overall brightness; rises a little with every answer. */
  energy: number
}

const ANGLES = new Set<keyof Params>(['tilt', 'spin', 'starAngle'])

function slotWeights(slot: Slot, into: number[], at: number, amount = 1) {
  into[at + SLOTS.indexOf(slot)] += amount
}

/** The colour vector: colourless (all ink) until there is a name. */
export function colourFor(name: string, goal: string): number[] {
  const out = new Array<number>(3 * SLOTS.length).fill(0)
  const n = SLOTS.length
  if (!name.trim()) {
    for (let c = 0; c < 3; c++) slotWeights('ink', out, c * n)
    return out
  }
  const [lead, counter] = SIGNATURES[traits(name).signature]
  slotWeights(lead, out, 0)
  slotWeights(counter, out, n)
  // The highlight is mostly light, tinted by the lead — and warmed toward
  // gold once there is a goal to steer by.
  const g = goal.trim() ? 0.35 : 0
  slotWeights('ink', out, 2 * n, 0.65 - g * 0.5)
  slotWeights(lead, out, 2 * n, 0.35 - g * 0.5)
  if (g) slotWeights('sun', out, 2 * n, g)
  return out
}

export function paramsFor(a: Answers): Params {
  const t = traits(a.name)
  const w = weightsOf(a.styles)
  const depth = a.depth ? DEPTH_BY_VALUE[a.depth] : undefined
  const session = a.session ? SESSION_BY_VALUE[a.session] : undefined
  const goal = a.goal.trim()
  const answered = [a.name.trim(), a.styles.length, depth, session, goal].filter(Boolean).length
  return {
    form: FORMS.map((f) => w[f]),
    tilt: t.tilt,
    layers: depth?.layers ?? 0,
    crisp: depth?.crisp ?? 0,
    gamma: depth?.gamma ?? 1,
    density: depth?.density ?? 0.72,
    // Settling into arms calms the drift; the looser, the more it wanders.
    turb: depth ? 0.6 + (1 - depth.crisp) * 1.2 : 1,
    tempo: session?.tempo ?? 0.22,
    orbit: session ? 1 : 0,
    orbitR: session?.orbitR ?? 1.06,
    sweep: session?.sweep ?? 0.25,
    spin: t.spin,
    star: goal ? 1 : 0,
    starAngle: t.star,
    colour: colourFor(a.name, goal),
    energy: 0.58 + answered * 0.084,
  }
}

/* ── Interpolation ────────────────────────────────────────────────────── */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Along the shorter way round, so a spin never unwinds a full turn. */
export function lerpAngle(a: number, b: number, t: number): number {
  if (t >= 1) return b
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return a + d * t
}

/** `t` of the way from `a` to `b`. Pure: new object, inputs untouched. */
export function lerpParams(a: Params, b: Params, t: number): Params {
  const out = {} as Record<string, number | number[]>
  for (const key of Object.keys(a) as (keyof Params)[]) {
    const x = a[key]
    const y = b[key]
    const f = ANGLES.has(key) ? lerpAngle : lerp
    out[key] = Array.isArray(x) ? x.map((v, i) => f(v, (y as number[])[i], t)) : f(x, y as number, t)
  }
  return out as unknown as Params
}

/**
 * Ease `current` toward `target` for `dt` seconds — exponential smoothing, so
 * it is frame-rate independent: two half-steps land exactly where one whole
 * step does, which is what keeps a 144Hz screen and a throttled one on the
 * same curve. `rate` is per second; ~1.4 settles in about two seconds.
 */
export function approachParams(current: Params, target: Params, dt: number, rate: number): Params {
  return lerpParams(current, target, 1 - Math.exp(-rate * dt))
}

/* ── The field ────────────────────────────────────────────────────────── */

/** One star's fixed character. All in [0, 1) except `a`, an angle. */
export type Mote = {
  /** Where it is around the disc. Advanced by the engine (differential
   *  rotation) for stars that are not locked to an arm. */
  a: number
  /** Distance from the core, 0 to rim 1. */
  l: number
  /** Scatter across its arm / ring. */
  j: number
  /** Which arm it belongs to, and which core of a binary. */
  k: number
  /** Which structure it may be recruited into (outer ring, star stream). */
  o: number
  /** Arm-or-disc membership, and phase along the ring and the stream. */
  ph: number
  /** Size and brightness class: most stars small and dim, a few bright. */
  s: number
}

/** Band centre for depth `l` with `n` bands. */
function quant(l: number, n: number) {
  return (Math.min(n - 1, Math.floor(l * n)) + 0.5) / n
}

/**
 * Where depth `l` settles for a (possibly fractional) ring count — blended
 * between the neighbouring whole counts, so interpolating from 2 to 6 slides
 * stars between rings instead of snapping them.
 */
export function band(l: number, layers: number, crisp: number): number {
  if (layers <= 0.001 || crisp <= 0) return l
  const lo = Math.max(1, Math.floor(layers))
  const hi = Math.max(1, Math.ceil(layers))
  const f = layers < 1 ? 0 : layers - Math.floor(layers)
  const q = quant(l, lo) * (1 - f) + quant(l, hi) * f
  return l + (q - l) * crisp * Math.min(1, layers)
}

/** The angle of arm `floor(k·n)` of `n`, blended across fractional counts
 *  the same way `band` is, so arms divide rather than jump. */
export function armAngle(k: number, arms: number): number {
  const at = (n: number) => (Math.min(n - 1, Math.floor(k * n)) / n) * TAU
  const lo = Math.max(1, Math.floor(arms))
  const f = arms - lo
  return f < 1e-6 ? at(lo) : at(lo) * (1 - f) + at(lo + 1) * f
}

/** A slow, smooth angle field — sums of sines, cheap enough for thousands. */
export function flow(x: number, y: number, t: number): number {
  return (
    2.1 *
    (Math.sin(x * 2.3 + t * 0.21 + 1.3) +
      Math.sin(y * 2.9 - t * 0.17 + 0.4) +
      Math.sin((x + y) * 1.7 + t * 0.13 + 4.1))
  )
}

export type Home = {
  x: number
  y: number
  alpha: number
  /** 0 lead tint, 1 counter tint, 2 near-white, 3 gold (the north star's). */
  tone: 0 | 1 | 2 | 3
  /** Phase along the star stream, or −1. */
  stream: number
  /** Size multiplier for this star in this structure. */
  size: number
}

/** The rotation of the arm pattern for time `t`, for callers without an
 *  integrated one. The engine integrates its own so tempo can ease. */
export const patternAngle = (P: Params, t: number) => t * P.tempo * 0.35

/** How present a morphology is: 0 absent, 1 chosen. A chosen style's weight
 *  is 1/n, so this saturates for any selection yet still eases in and out
 *  continuously while the weights interpolate. */
export const presence = (w: number) => clamp01(w * 4)

/**
 * Each morphology's share of the stars, in the order [barred spiral, grand
 * spiral, rings, binary, unformed nebula]. Sums to 1.
 *
 * Shares are what make a hybrid read as intentional rather than averaged:
 * each star belongs to *one* structure (see `membership`), and structures that
 * frame others — a ring around a spiral, a pair of cores that spiral arms
 * grow from — take a smaller share, so they read as the frame, not a rival.
 */
export function shares(P: Params): number[] {
  const [pe, pf, pd, pc] = P.form.map(presence)
  const spiral = Math.max(pe, pf)
  const raw = [
    pe,
    pf,
    pd * (1 - 0.55 * Math.max(spiral, pc)),
    pc * (1 - 0.25 * spiral),
    Math.max(0, 1 - Math.max(pe, pf, pd, pc)),
  ]
  const sum = raw[0] + raw[1] + raw[2] + raw[3] + raw[4] || 1
  return raw.map((v) => v / sum)
}

/** Width of the soft edge between two structures' bands of stars. */
const EDGE = 0.06
const ramp = (x: number) => clamp01(x / EDGE + 0.5)

/**
 * A star's membership in each structure, from its fixed hash `h`: the shares
 * are laid end to end along [0, 1) and the star belongs to whichever band it
 * falls in, blending only across a narrow soft edge. The weights always sum
 * to exactly 1, and they move continuously as the shares do — so toggling a
 * style moves only the stars whose band edge passes over them, and each of
 * those drifts across rather than jumping. No reshuffle, no density pop.
 */
export function membership(sh: number[], h: number, out: number[]): number[] {
  let c = 0
  const n = sh.length
  for (let i = 0; i < n; i++) {
    const a = c
    c += sh[i]
    out[i] = (i === 0 ? 1 : ramp(h - a)) - (i === n - 1 ? 0 : ramp(h - c))
  }
  return out
}

/** A star's structure hash — fixed for life, independent of which arm it is
 *  on and of what it may be recruited into. */
export const structureHash = (m: Mote) => (m.k * 5.713 + m.ph * 2.917 + m.j * 0.41) % 1

const W_ARM = 2.9
const scratch = [0, 0, 0, 0, 0]

/**
 * Where a star is, in galaxy units (radius 1, centred on 0), at time `t`.
 * `rot` is the arm pattern's rotation. Writes into `out` rather than
 * allocating: this runs for every star, every frame. `sh` is `shares(P)`,
 * passed in so a caller drawing thousands of stars computes it once.
 *
 * Each star belongs to one structure (see `membership`), and each structure
 * adapts to the others present, so hybrids compose legibly:
 *   - rings + anything → the rings move out to become a ring *around* it;
 *   - a spiral + rings → the spiral draws in to sit inside the ring;
 *   - bar + binary → the bar stretches to join the two cores;
 *   - a spiral + binary → the arms start *from* the two cores, so the pair
 *     shares one set of arms;
 *   - both spirals → crisp arms inside softer, wider arms along the same
 *     curve, like dust lanes around a bright spine.
 * Arm stars ride the rigidly turning arm pattern (a density wave, as in a
 * real spiral); disc and ring stars orbit at their own speed.
 */
export function home(P: Params, m: Mote, t: number, out: Home, rot = patternAngle(P, t), sh = shares(P)): Home {
  const pe = presence(P.form[0])
  const pf = presence(P.form[1])
  const pd = presence(P.form[2])
  const pc = presence(P.form[3])
  const arms = 2 + Math.max(0, P.layers - 2) * 0.5
  const rings = P.layers >= 2 ? P.layers : 3 - P.layers / 2
  const tight = 0.35 + 0.65 * P.crisp
  const r = 0.04 + 0.96 * m.l
  const onArm = m.ph < 0.74
  const sc = m.j - 0.5
  const dc = Math.cos(m.a)
  const ds = Math.sin(m.a)
  // Everything inside a ring draws in to leave room for it.
  const inner = 1 - 0.2 * pd
  // Arms begin at the bar's ends — or, with a binary, at its two cores.
  const r0 = 0.3 + 0.14 * pc
  const axis = rot + P.tilt
  const w = membership(sh, structureHash(m), scratch)
  let x = 0
  let y = 0

  if (w[4] > 0) {
    // A nebula not yet shaped: a soft, lumpy cloud of stars.
    const rr = r * (0.84 + 0.16 * Math.sin(3 * m.a + m.ph * TAU))
    x += w[4] * rr * dc
    y += w[4] * rr * ds
  }
  if (w[0] > 0) {
    // Barred spiral: a bar through the core, crisp arms from its ends.
    let px: number
    let py: number
    if (m.l < 0.22) {
      const u = (m.k * 2 - 1) * r0 * inner
      const v = sc * 0.07
      px = u * Math.cos(axis) - v * Math.sin(axis)
      py = u * Math.sin(axis) + v * Math.cos(axis)
    } else if (onArm) {
      const ra = r0 + (1 - r0) * ((m.l - 0.22) / 0.78)
      const th = axis + armAngle(m.k, arms) + W_ARM * Math.log(ra / r0) + sc * (0.5 - 0.38 * tight)
      const rr = ra * inner * (1 + sc * 0.05)
      px = rr * Math.cos(th)
      py = rr * Math.sin(th)
    } else {
      px = r * inner * dc
      py = r * inner * ds
    }
    x += w[0] * px
    y += w[0] * py
  }
  if (w[1] > 0) {
    // Grand-design spiral: soft, wide, sweeping arms in a cloud of light.
    let px: number
    let py: number
    if (onArm) {
      const ra = r0 * 0.8 + (1 - r0 * 0.8) * m.l
      const th = axis + armAngle(m.k, arms) + W_ARM * Math.log(ra / (r0 * 0.8)) + sc * (1 - 0.55 * tight)
      const rr = ra * inner * (1 + sc * 0.14)
      px = rr * Math.cos(th)
      py = rr * Math.sin(th)
    } else {
      px = r * 1.04 * inner * dc
      py = r * 1.04 * inner * ds
    }
    x += w[1] * px
    y += w[1] * py
  }
  if (w[2] > 0) {
    // Rings: clean concentric rings, each turning at its own speed — or,
    // around another structure, one or two rings framing it at the rim.
    const alone = 0.1 + 0.9 * Math.pow(band(m.l, rings, 0.94), P.gamma)
    // Framing: one crisp ring at the rim — two once depth asks for many.
    const around = 0.88 + 0.16 * band(m.l, 1 + clamp01((rings - 4) / 2), 0.985)
    const framed = Math.max(pe, pf, pc)
    const rr = alone + (around - alone) * framed + sc * (0.016 - 0.006 * framed)
    x += w[2] * rr * dc
    y += w[2] * rr * ds
  }
  if (w[3] > 0) {
    // An interacting pair: two cores circling each other. With a spiral
    // they are compact, and the spiral's arms grow out of them.
    const side = m.k < 0.5 ? -1 : 1
    const sub = (m.k * 2) % 1
    const rs = (0.03 + 0.4 * m.l * (1 - 0.4 * Math.max(pe, pf))) * inner
    let th = onArm ? rot * 1.4 + armAngle(sub, 2) + 2.4 * Math.log(Math.max(rs, 0.02) / 0.05) + sc * 0.55 : m.a
    if (side < 0) th = -th + Math.PI
    const d = 0.44 * inner
    x += w[3] * (d * side * Math.cos(axis) + rs * Math.cos(th))
    y += w[3] * (d * side * Math.sin(axis) + rs * Math.sin(th))
  }

  // A little drift, so no star sits exactly on its path.
  const n = flow(x, y, t * 0.5)
  const amp = 0.014 * P.turb * (0.4 + m.l)
  x += Math.cos(n) * amp
  y += Math.sin(n) * amp

  const hue = (m.k * 7.31 + m.j * 3.17) % 1
  out.tone = hue < 0.42 ? 2 : hue < 0.78 ? 0 : 1
  out.alpha = 1
  out.size = 1
  out.stream = -1

  // The outer ring: recruited from stars whose `o` falls under its share,
  // each drifting over from where it was — never a jump.
  const toOrbit = clamp01((P.orbit * 0.16 - m.o) / 0.04)
  const toStar = clamp01((m.o - (1 - P.star * 0.05)) / 0.015)
  if (toOrbit > 0) {
    const arc = P.sweep * TAU
    const ang = P.spin + rot * 0.8 + m.ph * arc
    const rr = P.orbitR * (1 + sc * 0.03)
    const edge = Math.min(m.ph, 1 - m.ph) * arc
    x += (rr * Math.cos(ang) - x) * toOrbit
    y += (rr * Math.sin(ang) - y) * toOrbit
    const ends = P.sweep >= 0.999 ? 1 : Math.min(1, edge / 0.3)
    out.alpha = 1 + (ends * 0.7 - 1) * toOrbit
    out.size = 1 - 0.3 * toOrbit
  } else if (toStar > 0) {
    // A gentle drift of stars toward the north star.
    const u = (m.ph + t * 0.045) % 1
    const a0 = P.starAngle + sc * 1.4
    const x0 = 0.35 * Math.cos(a0)
    const y0 = 0.35 * Math.sin(a0)
    const x2 = 1.12 * Math.cos(P.starAngle)
    const y2 = 1.12 * Math.sin(P.starAngle)
    const bend = (m.k - 0.5) * 0.5
    const x1 = (x0 + x2) / 2 - y2 * bend
    const y1 = (y0 + y2) / 2 + x2 * bend
    const v = 1 - u
    x += (v * v * x0 + 2 * v * u * x1 + u * u * x2 - x) * toStar
    y += (v * v * y0 + 2 * v * u * y1 + u * u * y2 - y) * toStar
    out.alpha = 1 + (0.85 * Math.sin(Math.PI * u) - 1) * toStar
    out.size = 1 - 0.3 * toStar
    if (toStar > 0.5) out.tone = 3
    out.stream = u
  }
  out.x = x
  out.y = y
  return out
}

/** Angular speed of a disc star, rad/s: differential rotation, the core
 *  turning several times faster than the rim. */
export function spinRate(P: Params, m: Mote): number {
  return P.tempo * (0.22 + 1.25 * Math.pow(1 - m.l, 1.8))
}

/* ── Legend ───────────────────────────────────────────────────────────── */

export type LegendKey = 'seed' | 'core' | 'rings' | 'orbit' | 'star'
export type LegendRow = { key: LegendKey; label: string; text: string }

function options(id: string): Option[] {
  return (STEPS.find((s) => s.id === id) as ChoiceStep).options
}

/**
 * What each structure in the organism came from, in the student's own terms:
 * the hint of the option they chose, or the words they typed. Unanswered
 * layers are simply absent — nothing is filled in on their behalf.
 */
export function legend(a: Answers): LegendRow[] {
  const rows: LegendRow[] = []
  const name = a.name.trim()
  if (name) rows.push({ key: 'seed', label: 'Name', text: `Grown from “${name}”` })
  const styles = options('style').filter((o) => a.styles.includes(o.value))
  if (styles.length) rows.push({ key: 'core', label: 'Style', text: styles.map((o) => o.hint).join(' · ') })
  const depth = options('depth').find((o) => o.value === a.depth)
  if (depth) rows.push({ key: 'rings', label: 'Depth', text: depth.hint })
  const session = options('session').find((o) => o.value === a.session)
  if (session) rows.push({ key: 'orbit', label: 'Session', text: `${session.label} — ${session.hint.toLowerCase()}` })
  const goal = a.goal.trim()
  if (goal) rows.push({ key: 'star', label: 'North star', text: goal })
  return rows
}
