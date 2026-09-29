/**
 * The student's galaxy, rendered: one canvas, one loop, a few thousand stars.
 *
 * `fingerprint.ts` says where each star wants to be; this moves them there
 * and paints them. Everything is imperative and lives outside React — the page
 * talks to it through a handful of verbs (`setAnswers`, `emit`, `absorb`,
 * `perturb`, `condense`) and never re-renders because of it.
 *
 * **Why it reads as a galaxy, not a diagram.** Stars are round, soft points
 * from a pre-rendered glow sprite — most small and dim, a few bright with a
 * cross-glint — never streaks or tails. Behind them sits nebula dust: large
 * tinted clouds rendered once to an offscreen canvas and turned slowly with
 * the arms, and a luminous core. The disc is seen slightly inclined, so rings
 * read as ellipses and the whole thing has depth.
 *
 * **Why it feels alive rather than scripted.** Nothing here is a timeline.
 * Every star is a damped spring chasing a home that is itself moving — arm
 * stars riding a slowly turning density wave, disc stars in differential
 * rotation (the core turns faster than the rim) — and answers change the
 * *parameters* of that motion, eased frame by frame, so a new answer is a
 * galaxy re-forming, never a swap. The cursor bends nearby starlight like a
 * lens; a keystroke sends a ring of twinkle outward from the core.
 *
 * **Performance budget.**
 *   - One canvas; device pixel ratio capped at 2 and total backing pixels
 *     capped, so a 4K screen does not quadruple the fill cost.
 *   - Star count scaled to the galaxy's on-screen size, cut on phones and
 *     small CPUs, and trimmed at runtime if frames run long.
 *   - Stars are `drawImage` of a cached sprite — a few thousand blits a
 *     frame, no path building. Dust is one blit of a cached canvas,
 *     re-rendered only while the morphology is changing.
 *   - No allocation in the star loop; no DOM reads per frame (geometry is
 *     pushed in on resize/scroll); nothing touches React.
 *   - The loop stops while the tab is hidden, and for good once covered.
 */

import { gsap } from 'gsap'
import {
  FALLBACK_RGB,
  SLOTS,
  approachParams,
  home,
  paramsFor,
  rng,
  spinRate,
  type Home,
  type Mote,
  type Params,
  type Slot,
} from './fingerprint'
import type { Answers } from './steps'

type RGB = [number, number, number]
type Point = { x: number; y: number }
type Sprite = HTMLCanvasElement

type Star = Mote & {
  x: number
  y: number
  vx: number
  vy: number
  vis: number
  /** Last star-stream phase, to catch the wrap and teleport across it. */
  su: number
}

type Guest = {
  live: boolean
  x: number
  y: number
  x0: number
  y0: number
  x1: number
  y1: number
  /** Destination, in galaxy units — tracks the galaxy if it moves. */
  ox: number
  oy: number
  age: number
  delay: number
  dur: number
  /** Sits still until its delay passes (a letter's glyph). */
  hold: boolean
  group: number
  absorb: boolean
  wob: number
}

type Group = {
  sprite: Sprite
  left: number
  arrived: boolean
  onArrive?: () => void
  onDone?: () => void
}

type Spark = { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number }

/** What the page's choreography drives. Tweened by GSAP, read every frame. */
export type Direction = {
  /** Intro: stars converging from beyond the edges into the seed. */
  conv: number
  /** Intro: the galaxy growing out of the seed and travelling to its stage. */
  birth: number
  /** A flash at the seed. */
  bloom: number
  seedX: number
  seedY: number
  /** Finale: the galaxy gathering into one bright star... */
  collapse: number
  /** ...holding, gathering light... */
  hold: number
  /** ...then travelling to `toX, toY`. */
  fly: number
  toX: number
  toY: number
  /** Finale: the stars have gone into the logo. */
  gone: number
}

const MAX_GUESTS = 2200
/** Backing-store ceiling, in device pixels. ~1920×1080 at 2.3×. */
const MAX_BACKING = 4.8e6
/** The disc is seen inclined: its minor axis, and the tilt of the view. */
const INCL = 0.8
const VIEW = -0.3
const SPRITE = 64
/** Dust canvas size and the galaxy extent it covers (± this, in units). */
const DUST = 320
const DUST_EXTENT = 1.4

const TAU = Math.PI * 2
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x: number) => x * x * (3 - 2 * x)
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`
const WHITE: RGB = [255, 250, 244]

/** Resolve a design token to sRGB through the canvas itself, so any CSS
 *  colour syntax the palette uses (hex, rgb, oklch) comes out as bytes. */
function readPalette(): Record<Slot, RGB> {
  const out = { ...FALLBACK_RGB } as Record<Slot, RGB>
  try {
    const probe = document.createElement('canvas')
    probe.width = probe.height = 1
    const c = probe.getContext('2d', { willReadFrequently: true })
    const css = getComputedStyle(document.documentElement)
    if (!c) return out
    for (const slot of SLOTS) {
      const v = css.getPropertyValue(`--color-${slot}`).trim()
      if (!v) continue
      c.clearRect(0, 0, 1, 1)
      c.fillStyle = '#000'
      c.fillStyle = v
      c.fillRect(0, 0, 1, 1)
      const d = c.getImageData(0, 0, 1, 1).data
      out[slot] = [d[0], d[1], d[2]]
    }
  } catch {
    /* fall back to the constants */
  }
  return out
}

/**
 * A star: a white-hot centre, a tinted halo, nothing past it. The glint
 * variant adds a faint four-point diffraction cross — kept for the few
 * brightest stars, which is what makes a field of points read as *stars*.
 */
function makeSprite(tint: RGB, glint: boolean): Sprite {
  const c = document.createElement('canvas')
  c.width = c.height = SPRITE
  const g = c.getContext('2d')
  if (!g) return c
  const h = SPRITE / 2
  const grad = g.createRadialGradient(h, h, 0, h, h, h)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.1, rgba(mixRGB(tint, WHITE, 0.55), 0.9))
  grad.addColorStop(0.28, rgba(tint, 0.3))
  grad.addColorStop(0.6, rgba(tint, 0.06))
  grad.addColorStop(1, rgba(tint, 0))
  g.fillStyle = grad
  g.fillRect(0, 0, SPRITE, SPRITE)
  if (glint) {
    g.globalCompositeOperation = 'lighter'
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ]) {
      const lg = g.createLinearGradient(h - dx * h, h - dy * h, h + dx * h, h + dy * h)
      lg.addColorStop(0, rgba(tint, 0))
      lg.addColorStop(0.5, rgba(mixRGB(tint, WHITE, 0.6), 0.75))
      lg.addColorStop(1, rgba(tint, 0))
      g.fillStyle = lg
      if (dx) g.fillRect(0, h - 0.6, SPRITE, 1.2)
      else g.fillRect(h - 0.6, 0, 1.2, SPRITE)
    }
  }
  return c
}

/** How many stars this device and this galaxy deserve. */
function budget(r: number): number {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency || 4
  let n = Math.max(1300, Math.min(4200, r * 9))
  if (coarse || window.innerWidth < 720) n *= 0.75
  if (cores <= 4) n *= 0.75
  return Math.round(n)
}

export class OrganismEngine {
  readonly dir: Direction
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly reduced: boolean
  private readonly canvas: HTMLCanvasElement
  private dpr = 1
  private w = 0
  private h = 0
  private anchor = { x: 0, y: 0, r: 100 }
  private P: Params
  private T: Params
  private stars: Star[] = []
  private cap = 0
  private quality = 1
  private absorbed = 0
  private guests: Guest[] = []
  private groups = new Map<number, Group>()
  private nextGroup = 1
  private sparks: Spark[] = []
  private ripples: { t0: number; amp: number }[] = []
  private pointer = { x: -1e4, y: -1e4, on: 0, want: 0 }
  private palette: Record<Slot, RGB>
  private kick = 0
  private flashes: { x: number; y: number; t0: number; rgb: RGB }[] = []
  /** The arm pattern's rotation, integrated so tempo can ease. */
  private rot = 0
  private t = 0
  private last = 0
  private raf = 0
  private slowFrames = 0
  private frameEma = 1 / 60
  private dead = false
  /** Star sprites per tone ([lead, counter, white, gold]), plain and glinting. */
  private sprites: { point: Sprite; glint: Sprite }[] = []
  private spriteCols: RGB[] = []
  private dust: HTMLCanvasElement | null = null
  private dustKey: number[] = []
  private dustAt = -1
  private bright: number[] = []
  private readonly tmp: Home = { x: 0, y: 0, alpha: 1, tone: 0, stream: -1, size: 1 }
  private readonly cleanup: (() => void)[] = []

  constructor(canvas: HTMLCanvasElement, opts: { reduced: boolean; intro: boolean; answers: Answers }) {
    this.canvas = canvas
    this.reduced = opts.reduced
    this.ctx = canvas.getContext('2d')
    this.palette = readPalette()
    this.T = paramsFor(opts.answers)
    this.P = this.T
    this.dir = {
      conv: opts.intro ? 0 : 1,
      birth: opts.intro ? 0 : 1,
      bloom: 0,
      seedX: window.innerWidth / 2,
      seedY: window.innerHeight * 0.46,
      collapse: 0,
      hold: 0,
      fly: 0,
      toX: 0,
      toY: 0,
      gone: 0,
    }
    if (!this.ctx) return

    for (let i = 0; i < MAX_GUESTS; i++) {
      this.guests.push({ live: false, x: 0, y: 0, x0: 0, y0: 0, x1: 0, y1: 0, ox: 0, oy: 0, age: 0, delay: 0, dur: 1, hold: false, group: 0, absorb: false, wob: 0 })
    }

    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn as EventListener, { passive: true })
      this.cleanup.push(() => window.removeEventListener(type, fn as EventListener))
    }
    on('resize', () => this.resize())
    if (!this.reduced) {
      on('pointermove', (e) => {
        this.pointer.x = e.clientX
        this.pointer.y = e.clientY
        this.pointer.want = e.pointerType === 'mouse' ? 1 : 0.6
      })
      const leave = () => {
        this.pointer.want = 0
      }
      document.documentElement.addEventListener('pointerleave', leave)
      this.cleanup.push(() => document.documentElement.removeEventListener('pointerleave', leave))
      const vis = () => (document.hidden ? this.stop() : this.start())
      document.addEventListener('visibilitychange', vis)
      this.cleanup.push(() => document.removeEventListener('visibilitychange', vis))
    }
    this.resize()
  }

  /* ── Geometry ──────────────────────────────────────────────────────── */

  /** Where the galaxy lives on screen. Pushed in on layout changes only. */
  setAnchor(x: number, y: number, r: number) {
    this.anchor = { x, y, r }
    const want = budget(r)
    if (Math.round(want * 1.3) > this.stars.length) this.allocate(want)
    else this.cap = want
    if (this.reduced) this.paintStatic()
  }

  private resize() {
    if (!this.ctx) return
    const w = window.innerWidth
    const h = window.innerHeight
    let dpr = Math.min(2, window.devicePixelRatio || 1)
    dpr = Math.min(dpr, Math.sqrt(MAX_BACKING / (w * h)))
    this.w = w
    this.h = h
    this.dpr = Math.max(0.75, dpr)
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    if (this.reduced) this.paintStatic()
  }

  /** Grow the pool. Existing stars keep their state, so a resize never
   *  reshuffles the galaxy. */
  private allocate(n: number) {
    const total = Math.round(n * 1.3) // headroom for the stars the name brings
    const r = rng(0x0b5e55ed + this.stars.length)
    const far = Math.hypot(window.innerWidth, window.innerHeight) * 0.62
    while (this.stars.length < total) {
      const a = r() * TAU
      this.stars.push({
        a,
        // Denser toward the core, as a galaxy is.
        l: Math.pow(r(), 1.25),
        j: r(),
        k: r(),
        o: r(),
        ph: r(),
        s: r(),
        x: this.dir.seedX + Math.cos(a) * far,
        y: this.dir.seedY + Math.sin(a) * far,
        vx: 0,
        vy: 0,
        vis: 0,
        su: 0,
      })
    }
    this.cap = n
  }

  /* ── Verbs ─────────────────────────────────────────────────────────── */

  /** New answers. The galaxy eases toward them; nothing is swapped. */
  setAnswers(a: Answers, withRipple = true) {
    this.T = paramsFor(a)
    if (this.reduced) {
      this.P = this.T
      this.paintStatic()
      return
    }
    if (withRipple) this.ripple(0.9)
  }

  /** A keystroke, a tap: a ring of twinkle moving outward from the core. */
  perturb(amount = 0.5) {
    if (this.reduced) return
    this.ripple(amount)
    this.kick = Math.min(1, this.kick + amount * 0.3)
  }

  private ripple(amp: number) {
    this.ripples.push({ t0: this.t, amp })
    if (this.ripples.length > 6) this.ripples.shift()
  }

  /** A flash of light at a point, with sparks thrown off it — the impact at
   *  the logo. */
  flash(x: number, y: number, slot: Slot = 'sun') {
    if (this.reduced) return
    this.flashes.push({ x, y, t0: this.t, rgb: this.palette[slot] })
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU
      const v = 60 + Math.random() * 190
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8, age: 0, life: 0.6 + Math.random() * 0.6, size: 5 + Math.random() * 9 })
    }
  }

  /**
   * Send stars from an element into the galaxy: a choice being fed in. They
   * drift along curved paths and dissolve into the core; `onArrive` fires as
   * the first one lands, which is when the galaxy should change.
   */
  emit({ from, origin, slot, count = 44, onArrive }: { from: DOMRect; origin?: Point | null; slot: Slot; count?: number; onArrive: () => void }) {
    if (!this.ctx || this.reduced) return onArrive()
    const g = this.group(this.palette[slot], onArrive)
    const r = Math.random
    const sweep = r() < 0.5 ? -1 : 1
    for (let i = 0; i < count; i++) {
      const near = origin && r() < 0.6
      const x = near ? origin.x + (r() - 0.5) * 70 : from.left + r() * from.width
      const y = near ? origin.y + (r() - 0.5) * 26 : from.top + r() * from.height
      this.launch(g, x, y, { delay: i * 0.014 + r() * 0.06, dur: 1 + r() * 0.5, sweep, absorb: false })
    }
  }

  /**
   * Dissolve letters into the galaxy. Each letter's glyph is sampled into
   * points; they sit exactly where the letter is (under it — the page fades
   * the letter off the top of them), then lift away in the letter's turn and
   * drift in along curved paths as stars. Most of them *stay*: they join the
   * galaxy, which is how the name becomes part of it.
   */
  absorb(letters: { el: HTMLElement; delay: number }[], { onFirst, onDone }: { onFirst: () => void; onDone?: () => void }) {
    if (!this.ctx || this.reduced || !letters.length) {
      onFirst()
      onDone?.()
      return
    }
    const pts = sampleGlyphs(letters, this.w < 720 ? 900 : 1600)
    if (!pts.length) {
      onFirst()
      onDone?.()
      return
    }
    const g = this.group(this.palette.ink, onFirst, onDone)
    const room = Math.max(0, Math.round(this.cap * 0.28) - this.absorbed)
    const keep = Math.min(1, room / pts.length)
    const r = Math.random
    for (const p of pts) {
      this.launch(g, p.x, p.y, { delay: p.delay + r() * 0.16, dur: 1.15 + r() * 0.55, sweep: 1, absorb: r() < keep, hold: true })
    }
  }

  /**
   * The finale, paced to be watched: the galaxy gathers into one bright star
   * and holds a beat, gathering light; then it travels to `to` — the logo —
   * on a slow curve, trailing star dust, and strikes it. `onLand` fires at
   * the moment of impact. Not skippable: it resolves only when it has played.
   */
  condense(to: () => Point | null, onLand?: (at: Point) => void): Promise<void> {
    if (!this.ctx || this.reduced) return Promise.resolve()
    const d = this.dir
    return new Promise((resolve) => {
      gsap
        .timeline({ onComplete: resolve })
        .to(d, { collapse: 1, duration: 1.05, ease: 'power2.inOut' }, 0)
        .to(d, { hold: 1, duration: 0.45, ease: 'sine.inOut' }, 1.0)
        .add(() => {
          const p = to()
          d.toX = p?.x ?? 32
          d.toY = p?.y ?? 32
        }, 1.4)
        .to(d, { fly: 1, duration: 1.45, ease: 'sine.inOut' }, 1.45)
        .add(() => onLand?.({ x: d.toX, y: d.toY }), 2.9)
        .to(d, { gone: 1, duration: 0.22, ease: 'power1.in' }, 2.84)
        .to({}, { duration: 0.1 }, 3.06)
    })
  }

  start() {
    if (!this.ctx || this.reduced || this.raf || this.dead || document.hidden) return
    this.last = performance.now()
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop)
      this.frame(now)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  /** Stop for good and let the canvas go — once the page is covered, it
   *  must not cost a single frame of the reveal. */
  release() {
    this.dead = true
    this.stop()
    if (this.ctx) {
      this.canvas.width = this.canvas.height = 1
    }
  }

  destroy() {
    this.dead = true
    this.stop()
    gsap.killTweensOf(this.dir)
    for (const c of this.cleanup) c()
  }

  /* ── Internals ─────────────────────────────────────────────────────── */

  private tintOf(rgb: RGB): RGB {
    // Restrained: starlight is mostly white, the tint is a hint.
    return mixRGB(rgb, this.palette.ink, 0.38)
  }

  private group(rgb: RGB, onArrive?: () => void, onDone?: () => void) {
    const id = this.nextGroup++
    this.groups.set(id, { sprite: makeSprite(this.tintOf(rgb), false), left: 0, arrived: false, onArrive, onDone })
    return id
  }

  private launch(group: number, x: number, y: number, o: { delay: number; dur: number; sweep: number; absorb: boolean; hold?: boolean }) {
    const g = this.guests.find((q) => !q.live)
    const grp = this.groups.get(group)!
    if (!g) {
      if (!grp.arrived) {
        grp.arrived = true
        grp.onArrive?.()
      }
      return
    }
    const r = Math.random
    // Land somewhere inside the core, not on a single point.
    const ang = r() * TAU
    const rad = Math.sqrt(r()) * 0.45
    const ox = Math.cos(ang) * rad
    const oy = Math.sin(ang) * rad
    const tx = this.anchor.x + ox * this.anchor.r
    const ty = this.anchor.y + oy * this.anchor.r
    const dx = tx - x
    const dy = ty - y
    const len = Math.hypot(dx, dy) || 1
    // Curved, all the same way round for one stream, so it reads as one
    // drift of stars rather than a spray.
    const bend = o.sweep * len * (0.18 + r() * 0.24)
    Object.assign(g, {
      live: true,
      x,
      y,
      x0: x,
      y0: y,
      x1: (x + tx) / 2 + (-dy / len) * bend,
      y1: (y + ty) / 2 + (dx / len) * bend,
      ox,
      oy,
      age: 0,
      delay: o.delay,
      dur: o.dur,
      hold: !!o.hold,
      group,
      absorb: o.absorb,
      wob: (r() - 0.5) * 50,
    })
    grp.left++
  }

  private arrive(g: Guest) {
    g.live = false
    const grp = this.groups.get(g.group)
    if (grp) {
      if (!grp.arrived) {
        grp.arrived = true
        grp.onArrive?.()
      }
      if (--grp.left <= 0) {
        this.groups.delete(g.group)
        grp.onDone?.()
      }
    }
    this.kick = Math.min(1, this.kick + 0.003)
    if (!g.absorb) return
    const slot = Math.floor(this.cap * this.quality * this.P.density) + this.absorbed
    const p = this.stars[slot]
    if (!p) return
    this.absorbed++
    p.x = g.x
    p.y = g.y
    p.vx = p.vy = 0
    p.vis = 1
  }

  /** Colours for this frame, resolved from the interpolated weights:
   *  [lead, counter, highlight, gold]. */
  private colours(P: Params): RGB[] {
    const pal = this.palette
    const cols: RGB[] = [0, 1, 2].map((c) => {
      const acc: RGB = [0, 0, 0]
      let sum = 0
      for (let s = 0; s < SLOTS.length; s++) {
        const w = P.colour[c * SLOTS.length + s]
        if (w <= 0) continue
        const rgb = pal[SLOTS[s]]
        acc[0] += rgb[0] * w
        acc[1] += rgb[1] * w
        acc[2] += rgb[2] * w
        sum += w
      }
      return sum > 0 ? [acc[0] / sum, acc[1] / sum, acc[2] / sum] : pal.ink
    })
    cols.push(pal.sun)
    return cols
  }

  /** Rebuild the star sprites when the colours have moved enough to see. */
  private ensureSprites(cols: RGB[]) {
    const tints = [this.tintOf(cols[0]), this.tintOf(cols[1]), mixRGB(cols[2], WHITE, 0.45), mixRGB(cols[3], WHITE, 0.15)]
    const moved =
      this.sprites.length === 0 ||
      tints.some((c, i) => Math.abs(c[0] - this.spriteCols[i][0]) + Math.abs(c[1] - this.spriteCols[i][1]) + Math.abs(c[2] - this.spriteCols[i][2]) > 6)
    if (!moved) return
    this.sprites = tints.map((c) => ({ point: makeSprite(c, false), glint: makeSprite(c, true) }))
    this.spriteCols = tints
  }

  /**
   * Nebula dust: a few dozen large, soft, tinted clouds laid along the
   * galaxy's own structure, rendered once to an offscreen canvas. Re-rendered
   * only while the morphology or colours are still moving, and at most a few
   * times a second — between renders the change is too small to see.
   */
  private ensureDust(P: Params, cols: RGB[]) {
    const key = [...P.form, P.layers, P.tilt, ...P.colour]
    const moved = !this.dust || key.some((v, i) => Math.abs(v - (this.dustKey[i] ?? 1e9)) > 0.015)
    if (!moved || (this.dust && this.t - this.dustAt < 0.14)) return
    const c = this.dust ?? document.createElement('canvas')
    c.width = c.height = DUST
    const g = c.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, DUST, DUST)
    g.globalCompositeOperation = 'lighter'
    const scale = DUST / (2 * DUST_EXTENT)
    const r = rng(0xd0057)
    const out: Home = { x: 0, y: 0, alpha: 1, tone: 0, stream: -1, size: 1 }
    // A broad, faint disc glow first, so the clouds sit in something.
    const disc = g.createRadialGradient(DUST / 2, DUST / 2, 0, DUST / 2, DUST / 2, scale * 1.05)
    disc.addColorStop(0, rgba(mixRGB(cols[0], this.palette.ink, 0.5), 0.07))
    disc.addColorStop(1, rgba(cols[0], 0))
    g.fillStyle = disc
    g.fillRect(0, 0, DUST, DUST)
    for (let i = 0; i < 110; i++) {
      const m: Mote = { a: r() * TAU, l: 0.12 + 0.88 * Math.pow(r(), 0.9), j: r(), k: r(), o: 0.5, ph: r() * 0.74, s: 0 }
      home({ ...P, orbit: 0, star: 0, turb: 0 }, m, 0, out, 0)
      const x = DUST / 2 + out.x * scale
      const y = DUST / 2 + out.y * scale
      const rad = (0.06 + 0.12 * r()) * scale
      const tint = mixRGB(i % 3 === 0 ? cols[1] : cols[0], this.palette.ink, 0.25)
      const grad = g.createRadialGradient(x, y, 0, x, y, rad)
      grad.addColorStop(0, rgba(tint, 0.06))
      grad.addColorStop(0.5, rgba(tint, 0.022))
      grad.addColorStop(1, rgba(tint, 0))
      g.fillStyle = grad
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    this.dust = c
    this.dustKey = key
    this.dustAt = this.t
  }

  /** Galaxy units → screen, through the inclined view. */
  private project(gx: number, gy: number, cx: number, cy: number, R: number, out: Point) {
    const y = gy * INCL
    out.x = cx + R * (gx * Math.cos(VIEW) - y * Math.sin(VIEW))
    out.y = cy + R * (gx * Math.sin(VIEW) + y * Math.cos(VIEW))
  }

  private frame(now: number) {
    const ctx = this.ctx!
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000))
    this.last = now
    this.t += dt
    const t = this.t

    // Smoothed, so one long frame (a GC, a route chunk parsing) never costs
    // stars — only a sustained shortfall does, and it is never undone, so
    // the count cannot oscillate.
    this.frameEma += (dt - this.frameEma) * 0.05
    this.slowFrames = this.frameEma > 0.025 ? this.slowFrames + 1 : 0
    if (this.slowFrames > 90 && this.quality > 0.45) {
      this.quality *= 0.85
      this.slowFrames = 0
    }

    this.P = approachParams(this.P, this.T, dt, 1.2)
    const P = this.P
    const d = this.dir
    this.kick *= Math.exp(-dt * 2)
    const col = smooth(clamp01(d.collapse))
    this.rot += P.tempo * 0.35 * dt * (1 + col * 3)
    const rot = this.rot

    const cols = this.colours(P)
    this.ensureSprites(cols)
    this.ensureDust(P, cols)
    const sprites = this.sprites

    // Where the galaxy is this frame, after the direction.
    const pt = this.pointer
    pt.on += (pt.want - pt.on) * Math.min(1, dt * 3)
    const born = smooth(clamp01(d.birth))
    const travel = easeInOut(clamp01(d.birth))
    let cx = d.seedX + (this.anchor.x - d.seedX) * travel
    let cy = d.seedY + (this.anchor.y - d.seedY) * travel
    const breath = 1 + 0.018 * Math.sin(t * 0.9) + this.kick * 0.03
    let R = this.anchor.r * Math.max(0.018, born) * breath
    R *= 1 - 0.97 * col
    const spinBoost = 1 + col * 4
    const fly = clamp01(d.fly)
    // A graceful curve — up and over, the way a thrown thing travels.
    const ax = cx
    const ay = cy
    const mx = (ax + d.toX) / 2 + (ay - d.toY) * 0.22
    const my = Math.min(ay, d.toY) - Math.abs(ax - d.toX) * 0.16
    if (fly > 0) {
      const v = 1 - fly
      cx = v * v * ax + 2 * v * fly * mx + fly * fly * d.toX
      cy = v * v * ay + 2 * v * fly * my + fly * fly * d.toY
      R = Math.max(2, R * (1 - fly))
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, this.w, this.h)
    ctx.globalCompositeOperation = 'lighter'

    const fade = 1 - clamp01(d.gone)
    const energy = Math.min(1.3, P.energy + this.kick * 0.3 + col * 0.4 + d.hold * 0.3)

    // Nebula dust, turning with the arms; it thins out as the galaxy gathers.
    const dustA = born * (1 - col) * fade * Math.min(1, P.energy + 0.1)
    if (this.dust && dustA > 0.01) {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(VIEW)
      ctx.scale(1, INCL)
      ctx.rotate(rot)
      ctx.globalAlpha = dustA
      const e = DUST_EXTENT * R
      ctx.drawImage(this.dust, -e, -e, e * 2, e * 2)
      ctx.restore()
      ctx.globalAlpha = 1
    }

    this.drawCores(ctx, P, cols, cx, cy, R, rot, energy, fade, col)

    // Intro bloom at the seed.
    if (d.bloom > 0.001) {
      const bR = this.anchor.r * (0.35 + 1.1 * d.bloom)
      const g = ctx.createRadialGradient(d.seedX, d.seedY, 0, d.seedX, d.seedY, bR)
      g.addColorStop(0, `rgba(255,246,236,${(0.85 * d.bloom).toFixed(3)})`)
      g.addColorStop(0.18, `rgba(255,196,150,${(0.4 * d.bloom).toFixed(3)})`)
      g.addColorStop(1, 'rgba(255,160,110,0)')
      ctx.fillStyle = g
      ctx.fillRect(d.seedX - bR, d.seedY - bR, bR * 2, bR * 2)
    }

    // The seed / the gathered star: a hot point with a halo.
    const seedGlow = Math.max(smooth(clamp01((d.conv - 0.55) / 0.45)) * (1 - born), col * fade)
    if (seedGlow > 0.01) {
      const pulse = 1 + d.hold * 0.35 * Math.sin(t * 7) * (1 - fly)
      const sR = (48 + 60 * d.bloom + 40 * d.hold) * pulse
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, sR)
      g.addColorStop(0, `rgba(255,251,246,${(0.95 * seedGlow).toFixed(3)})`)
      g.addColorStop(0.12, rgba(mixRGB(cols[0], [255, 224, 190], 0.5), 0.55 * seedGlow))
      g.addColorStop(1, rgba(cols[0], 0))
      ctx.fillStyle = g
      ctx.fillRect(cx - sR, cy - sR, sR * 2, sR * 2)
    }

    const active = Math.min(this.stars.length, Math.floor(this.cap * this.quality * P.density) + this.absorbed)
    const far = Math.hypot(this.w, this.h) * 0.62
    const conv = clamp01(d.conv)
    const K = 55
    const C = 2 * Math.sqrt(K)
    const lens = Math.max(80, this.anchor.r * 0.26)
    const lens2 = lens * lens
    const sizeK = Math.max(0.75, Math.min(1.3, this.anchor.r / 420))
    const out = this.tmp
    const sp: Point = { x: 0, y: 0 }
    const bright = this.bright
    bright.length = 0

    for (let i = 0; i < this.stars.length; i++) {
      const p = this.stars[i]
      const on = i < active
      if (!on && p.vis < 0.004) continue

      p.a += spinRate(P, p) * spinBoost * dt
      home(P, p, t, out, rot)
      this.project(out.x, out.y, cx, cy, R, sp)
      let hx = sp.x
      let hy = sp.y
      let trail = 1

      if (conv < 1) {
        // Drawn in from beyond the edges on slow spirals; the core arrives
        // first, as if the dark were condensing.
        const q = easeInOut(clamp01(conv * 1.45 - p.l * 0.45))
        const ang = p.a + (1 - q) * 1.6
        const dist = far * (1 - q) * (0.8 + p.j * 0.4)
        hx = d.seedX + Math.cos(ang) * dist + (hx - d.seedX) * q
        hy = d.seedY + Math.sin(ang) * dist + (hy - d.seedY) * q
      }
      if (fly > 0) {
        // The flight: each star a little further back along the same
        // curve, so the gathered star trails a wake of star dust that
        // closes up as it lands.
        const f = Math.pow(fly, 1 + p.l * 0.9 + p.j * 0.25)
        const v = 1 - f
        hx = v * v * ax + 2 * v * f * mx + f * f * d.toX + (sp.x - cx)
        hy = v * v * ay + 2 * v * f * my + f * f * d.toY + (sp.y - cy)
        trail = 1 - 0.75 * p.l * Math.sin(Math.PI * fly)
      }

      // Waking up: appear at home rather than drifting in from wherever
      // this star was last parked.
      if (on && p.vis < 0.02 && conv >= 1 && fly === 0) {
        p.x = hx
        p.y = hy
        p.vx = p.vy = 0
      }
      if (out.stream >= 0) {
        if (out.stream < p.su) {
          p.x = hx
          p.y = hy
          p.vx = p.vy = 0
        }
        p.su = out.stream
      }

      let fx = (hx - p.x) * K - p.vx * C
      let fy = (hy - p.y) * K - p.vy * C

      // The cursor bends nearby starlight outward, like a lens.
      if (pt.on > 0.01) {
        const dx = p.x - pt.x
        const dy = p.y - pt.y
        const d2 = dx * dx + dy * dy
        if (d2 < lens2 && d2 > 1) {
          const dd = Math.sqrt(d2)
          const f = (1 - dd / lens) * (1 - dd / lens) * 1500 * pt.on
          fx += (dx / dd) * f
          fy += (dy / dd) * f
        }
      }
      // Ripples: a ring of twinkle travelling outward, with a gentle push.
      let glow = 0
      for (let k = 0; k < this.ripples.length; k++) {
        const rp = this.ripples[k]
        const age = t - rp.t0
        const front = age * this.anchor.r * 1.1
        const dx = p.x - cx
        const dy = p.y - cy
        const dd = Math.sqrt(dx * dx + dy * dy) + 0.001
        const z = (dd - front) / (this.anchor.r * 0.1)
        const g = Math.exp(-z * z) * rp.amp * Math.exp(-age * 1.5)
        glow += g
        fx += (dx / dd) * g * 2600
        fy += (dy / dd) * g * 2600
      }

      if (fly > 0) {
        p.vx = (hx - p.x) / dt
        p.vy = (hy - p.y) / dt
        p.x = hx
        p.y = hy
      } else {
        p.vx += fx * dt
        p.vy += fy * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
      }
      p.vis += ((on ? 1 : 0) - p.vis) * Math.min(1, dt * 2.4)

      const twinkle = 0.8 + 0.2 * Math.sin(t * (0.6 + 2.2 * p.j) + p.ph * 40)
      const lum = 0.36 + 0.64 * Math.pow(p.s, 2.2)
      let a = p.vis * out.alpha * lum * twinkle * energy * fade * trail * (conv < 1 ? 0.4 + 0.6 * conv : 1) + glow * 0.5
      if (a < 0.02) continue
      if (a > 1) a = 1
      const isGlint = p.s > 0.994 && fly === 0
      const size = (isGlint ? 15 + 1500 * (p.s - 0.994) : 4.6 + 9 * Math.pow(p.s, 6)) * out.size * sizeK * (1 + glow * 0.4)
      const spr = sprites[out.tone]
      ctx.globalAlpha = a
      ctx.drawImage(isGlint ? spr.glint : spr.point, p.x - size / 2, p.y - size / 2, size, size)
      if (p.s > 0.955 && bright.length < 140 && conv >= 1 && col === 0) bright.push(p.x, p.y, a)
    }
    ctx.globalAlpha = 1
    if (this.ripples.length && t - this.ripples[0].t0 > 3) this.ripples.shift()

    this.drawConstellations(ctx, cols[2], born * fade * (1 - col))
    this.drawStar(ctx, cx, cy, R, fade * (1 - col))
    this.drawGuests(ctx, dt, cx, cy, R)
    this.drawSparks(ctx, dt)
    this.drawFlashes(ctx)
  }

  /** The luminous core — elongated along the bar for a barred spiral, and
   *  doubled for an interacting pair. */
  private drawCores(ctx: CanvasRenderingContext2D, P: Params, cols: RGB[], cx: number, cy: number, R: number, rot: number, energy: number, fade: number, col: number) {
    const [ex, , , cm] = P.form
    const a = fade * (1 - col * 0.6)
    if (a < 0.01 || R < 3) return
    const core = (x: number, y: number, r: number, k: number, stretch: number, angle: number) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(VIEW)
      ctx.scale(1, INCL)
      ctx.rotate(angle)
      ctx.scale(stretch, 1)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
      g.addColorStop(0, rgba([255, 244, 230], 0.5 * energy * k * a))
      g.addColorStop(0.18, rgba(mixRGB(cols[0], [255, 226, 196], 0.55), 0.22 * energy * k * a))
      g.addColorStop(0.55, rgba(cols[0], 0.05 * energy * k * a))
      g.addColorStop(1, rgba(cols[0], 0))
      ctx.fillStyle = g
      ctx.fillRect(-r, -r, r * 2, r * 2)
      ctx.restore()
    }
    core(cx, cy, R * 0.42, 1 - cm * 0.7, 1 + ex * 1.1, rot + P.tilt)
    if (cm > 0.01) {
      const axis = P.tilt + rot * 0.35
      const sp: Point = { x: 0, y: 0 }
      for (const side of [-1, 1]) {
        this.project(0.44 * side * Math.cos(axis), 0.44 * side * Math.sin(axis), cx, cy, R, sp)
        core(sp.x, sp.y, R * 0.26, cm, 1, 0)
      }
    }
  }

  /**
   * A constellation touch: a few hair-fine lines between nearby bright
   * stars, each fading in and out on its own slow cycle. Few, faint, never
   * all at once — a hint of pattern, not a diagram.
   */
  private drawConstellations(ctx: CanvasRenderingContext2D, tint: RGB, k: number) {
    const b = this.bright
    if (k < 0.05 || b.length < 6) return
    const maxD = Math.max(60, this.anchor.r * 0.22)
    const maxD2 = maxD * maxD
    ctx.lineWidth = 0.6
    let drawn = 0
    for (let i = 0; i < b.length && drawn < 14; i += 3) {
      for (let j = i + 3; j < b.length && drawn < 14; j += 3) {
        const dx = b[i] - b[j]
        const dy = b[i + 1] - b[j + 1]
        const d2 = dx * dx + dy * dy
        if (d2 > maxD2 || d2 < 400) continue
        const phase = Math.sin(this.t * 0.22 + i * 0.37 + j * 0.11)
        if (phase < 0.35) continue
        const a = (phase - 0.35) * 0.16 * k * Math.min(b[i + 2], b[j + 2]) * (1 - Math.sqrt(d2) / maxD)
        if (a < 0.005) continue
        ctx.strokeStyle = rgba(mixRGB(tint, WHITE, 0.5), a)
        ctx.beginPath()
        ctx.moveTo(b[i], b[i + 1])
        ctx.lineTo(b[j], b[j + 1])
        ctx.stroke()
        drawn++
        break
      }
    }
  }

  /** The north star: one bright gold star on the rim, slowly glinting. */
  private drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, k: number) {
    const s = this.P.star * k
    if (s < 0.01 || !this.sprites.length) return
    const at: Point = { x: 0, y: 0 }
    this.project(Math.cos(this.P.starAngle) * 1.12, Math.sin(this.P.starAngle) * 1.12, cx, cy, R, at)
    const pulse = 0.88 + 0.12 * Math.sin(this.t * 1.6)
    const r = 34 * s * pulse
    const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r)
    g.addColorStop(0, rgba([255, 250, 236], 0.9 * s))
    g.addColorStop(0.2, rgba(this.palette.sun, 0.35 * s))
    g.addColorStop(1, rgba(this.palette.sun, 0))
    ctx.fillStyle = g
    ctx.fillRect(at.x - r, at.y - r, r * 2, r * 2)
    const size = 58 * s * pulse
    ctx.globalAlpha = s
    ctx.drawImage(this.sprites[3].glint, at.x - size / 2, at.y - size / 2, size, size)
    ctx.globalAlpha = 1
  }

  private drawGuests(ctx: CanvasRenderingContext2D, dt: number, cx: number, cy: number, R: number) {
    if (!this.groups.size || !this.sprites.length) return
    const lead = this.sprites[0].point
    for (const g of this.guests) {
      if (!g.live) continue
      g.age += dt
      const grp = this.groups.get(g.group)
      if (!grp) {
        g.live = false
        continue
      }
      const u = (g.age - g.delay) / g.dur
      if (u <= 0) {
        if (!g.hold) continue
        // A letter's grain, waiting its turn: a tiny still star.
        ctx.globalAlpha = 0.9
        ctx.drawImage(grp.sprite, g.x - 2.4, g.y - 2.4, 4.8, 4.8)
        continue
      }
      const e = easeInOut(clamp01(u))
      const x2 = cx + g.ox * R
      const y2 = cy + g.oy * R * INCL
      const v = 1 - e
      const wob = Math.sin(Math.PI * e) * g.wob
      const bx = v * v * g.x0 + 2 * v * e * g.x1 + e * e * x2
      const by = v * v * g.y0 + 2 * v * e * g.y1 + e * e * y2
      const tx = 2 * v * (g.x1 - g.x0) + 2 * e * (x2 - g.x1)
      const ty = 2 * v * (g.y1 - g.y0) + 2 * e * (y2 - g.y1)
      const tl = Math.hypot(tx, ty) || 1
      g.x = bx + (-ty / tl) * wob
      g.y = by + (tx / tl) * wob
      if (u >= 1) {
        this.arrive(g)
        continue
      }
      // It takes on the galaxy's colour as it travels.
      const size = 5.5 + 2 * Math.sin(Math.PI * e)
      const fadeOut = g.absorb ? 1 : u > 0.8 ? (1 - u) / 0.2 : 1
      ctx.globalAlpha = (1 - e) * 0.95 * fadeOut
      ctx.drawImage(grp.sprite, g.x - size / 2, g.y - size / 2, size, size)
      ctx.globalAlpha = e * 0.95 * fadeOut
      ctx.drawImage(lead, g.x - size / 2, g.y - size / 2, size, size)
    }
    ctx.globalAlpha = 1
  }

  private drawSparks(ctx: CanvasRenderingContext2D, dt: number) {
    if (!this.sparks.length || !this.sprites.length) return
    const spr = this.sprites[3].point
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]
      s.age += dt
      if (s.age > s.life) {
        this.sparks.splice(i, 1)
        continue
      }
      const k = s.age / s.life
      s.vx *= Math.exp(-dt * 2.4)
      s.vy *= Math.exp(-dt * 2.4)
      s.x += s.vx * dt
      s.y += s.vy * dt
      ctx.globalAlpha = Math.pow(1 - k, 1.4)
      const size = s.size * (1 - k * 0.5)
      ctx.drawImage(spr, s.x - size / 2, s.y - size / 2, size, size)
    }
    ctx.globalAlpha = 1
  }

  private drawFlashes(ctx: CanvasRenderingContext2D) {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]
      const age = this.t - f.t0
      if (age > 1.2) {
        this.flashes.splice(i, 1)
        continue
      }
      const k = age / 1.2
      const r = 16 + 150 * (1 - Math.pow(1 - k, 3))
      const a = Math.pow(1 - k, 1.5)
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r)
      g.addColorStop(0, rgba([255, 250, 242], 0.95 * a))
      g.addColorStop(0.25, rgba(f.rgb, 0.4 * a))
      g.addColorStop(1, rgba(f.rgb, 0))
      ctx.fillStyle = g
      ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2)
    }
  }

  /**
   * Reduced motion: one settled frame, redrawn only when something changes.
   * The same galaxy, held still — dust, core and stars, no motion.
   */
  private paintStatic() {
    const ctx = this.ctx
    if (!ctx || !this.cap) return
    const P = this.P
    const cols = this.colours(P)
    this.ensureSprites(cols)
    this.dust = null
    this.ensureDust(P, cols)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, this.w, this.h)
    ctx.globalCompositeOperation = 'lighter'
    const { x: cx, y: cy, r: R } = this.anchor
    if (this.dust) {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(VIEW)
      ctx.scale(1, INCL)
      const e = DUST_EXTENT * R
      ctx.drawImage(this.dust, -e, -e, e * 2, e * 2)
      ctx.restore()
    }
    this.drawCores(ctx, P, cols, cx, cy, R, 0, P.energy, 1, 0)
    const active = Math.floor(this.cap * P.density)
    const out = this.tmp
    const sp: Point = { x: 0, y: 0 }
    const sizeK = Math.max(0.75, Math.min(1.3, R / 420))
    for (let i = 0; i < active; i++) {
      const p = this.stars[i]
      home(P, p, 8, out, 0)
      if (out.alpha < 0.15) continue
      this.project(out.x, out.y, cx, cy, R, sp)
      const size = (4.6 + 9 * Math.pow(p.s, 6)) * sizeK
      ctx.globalAlpha = Math.min(1, (0.36 + 0.64 * Math.pow(p.s, 2.2)) * P.energy)
      ctx.drawImage(this.sprites[out.tone].point, sp.x - size / 2, sp.y - size / 2, size, size)
    }
    ctx.globalAlpha = 1
    this.drawStar(ctx, cx, cy, R, 1)
  }
}

/* ── Glyph sampling ──────────────────────────────────────────────────── */

/**
 * The pixels of each letter, in viewport coordinates, with that letter's
 * release delay. Each letter is redrawn on an offscreen canvas in its own
 * computed font, at its own on-screen box, and read back on a grid — so the
 * points form the letter the student is looking at, not an approximation.
 */
function sampleGlyphs(letters: { el: HTMLElement; delay: number }[], max: number): { x: number; y: number; delay: number }[] {
  const boxes = letters.map((l) => ({ ...l, r: l.el.getBoundingClientRect() }))
  const left = Math.min(...boxes.map((b) => b.r.left)) - 8
  const top = Math.min(...boxes.map((b) => b.r.top)) - 8
  const right = Math.max(...boxes.map((b) => b.r.right)) + 8
  const bottom = Math.max(...boxes.map((b) => b.r.bottom)) + 8
  const W = Math.ceil(right - left)
  const H = Math.ceil(bottom - top)
  if (W <= 0 || H <= 0 || W * H > 8e6) return []
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  const owner: number[] = []

  boxes.forEach((b, i) => {
    const cs = getComputedStyle(b.el)
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    try {
      // Archivo is set wide; get as close as canvas allows.
      ;(ctx as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = 'semi-expanded'
    } catch {
      /* not supported */
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    // One colour per letter so each sampled pixel knows which letter it is.
    ctx.fillStyle = `rgb(${i + 1},0,0)`
    const ch = b.el.textContent ?? ''
    const m = ctx.measureText(ch)
    const asc = m.fontBoundingBoxAscent ?? parseFloat(cs.fontSize) * 0.8
    const desc = m.fontBoundingBoxDescent ?? parseFloat(cs.fontSize) * 0.2
    // CSS half-leading: the content area is centred in the line box.
    const baseline = b.r.top + (b.r.height - (asc + desc)) / 2 + asc
    // Squeeze to the box so a font-stretch mismatch cannot overhang.
    const scale = m.width > 0 ? Math.min(1.25, Math.max(0.8, b.r.width / m.width)) : 1
    ctx.save()
    ctx.translate(b.r.left + b.r.width / 2 - left, baseline - top)
    ctx.scale(scale, 1)
    ctx.fillText(ch, 0, 0)
    ctx.restore()
    owner.push(i)
  })

  const data = ctx.getImageData(0, 0, W, H).data
  const size = parseFloat(getComputedStyle(letters[0].el).fontSize) || 80
  let step = Math.max(2, Math.round(size / 26))
  let pts: { x: number; y: number; delay: number }[] = []
  for (;;) {
    pts = []
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        const o = (y * W + x) * 4
        if (data[o + 3] > 128) {
          const i = data[o] - 1
          const b = boxes[i]
          if (b) pts.push({ x: x + left, y: y + top, delay: b.delay })
        }
      }
    }
    if (pts.length <= max || step > 12) break
    step++
  }
  return pts
}
