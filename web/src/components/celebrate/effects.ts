/**
 * The motion itself. Loaded on demand by `celebrate.ts`.
 *
 * Two kinds of piece, each used where it's cheapest:
 *   - canvas for anything with more than ~20 moving parts (confetti, ribbons,
 *     starbursts). One layer, one clear, a few hundred fills per frame — far
 *     cheaper than a hundred promoted DOM nodes.
 *   - a handful of DOM nodes animated with WAAPI for the rest (rings,
 *     sparkles, the stamp, the tally, the line). Transform and opacity only,
 *     so they run on the compositor.
 *
 * Every piece removes itself; the stage it lives on goes when the last one
 * does. A tab going hidden tears every stage down at once — nothing keeps
 * animating for nobody.
 */

import './celebrate.css'
import { EASE } from './easing'
import type { Palette, Plan, Variant } from './logic'

type Pt = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }

export type RunContext = {
  origin: Pt
  bar: Box | null
  line: string | null
  reduced: boolean
  compact: boolean
}

const TOKENS: Record<Palette, string[]> = {
  quiz: ['--color-brand', '--color-sun', '--color-mint', '--color-sky', '--color-coral'],
  cards: ['--color-sky', '--color-mint', '--color-azure', '--color-sun'],
  goal: ['--color-mint', '--color-jade', '--color-sun', '--color-sky'],
  streak: ['--color-brand', '--color-sun', '--color-coral', '--color-brand-300'],
}
const FALLBACK: Record<string, string> = {
  '--color-brand': '#ff5a3c',
  '--color-brand-300': '#ff8b76',
  '--color-sun': '#ffc53d',
  '--color-mint': '#b8ff3c',
  '--color-sky': '#35d6e8',
  '--color-coral': '#ff3d8b',
  '--color-azure': '#5590ff',
  '--color-jade': '#22d3a0',
}

function colours(p: Palette): string[] {
  const cs = getComputedStyle(document.documentElement)
  return TOKENS[p].map((v) => cs.getPropertyValue(v).trim() || FALLBACK[v])
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

/** A darker `#rrggbb` — the back face of a ribbon. Anything else passes through. */
function shade(hex: string, k: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * k)
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}

/* ── Stage ───────────────────────────────────────────────────────────── */

function stage(): { root: HTMLElement; track: (p: Promise<unknown>) => void } {
  const root = document.createElement('div')
  root.className = 'sl-cel'
  root.setAttribute('aria-hidden', 'true')
  document.body.appendChild(root)
  const pending: Promise<unknown>[] = []
  // Removal waits a tick so pieces added in the same call are all counted.
  queueMicrotask(() => {
    void Promise.allSettled(pending).then(() => root.remove())
  })
  return { root, track: (p) => void pending.push(p) }
}

let watching = false
function watchVisibility() {
  if (watching) return
  watching = true
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) document.querySelectorAll('.sl-cel').forEach((n) => n.remove())
  })
}

function piece(root: HTMLElement, className: string, tone?: string): HTMLElement {
  const el = document.createElement('div')
  el.className = className
  if (tone) el.style.setProperty('--tone', tone)
  root.appendChild(el)
  return el
}

/** WAAPI where it exists (not jsdom), resolving when the piece is done. */
function animate(el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
  if (typeof el.animate !== 'function') {
    el.remove()
    return Promise.resolve()
  }
  const a = el.animate(frames, { fill: 'both', ...opts })
  return a.finished.then(
    () => el.remove(),
    () => el.remove(),
  )
}

/* ── Canvas ──────────────────────────────────────────────────────────── */

type Draw = (ctx: CanvasRenderingContext2D, dt: number, w: number, h: number) => boolean

function canvasLoop(root: HTMLElement, draw: Draw): Promise<void> {
  const c = document.createElement('canvas')
  const ctx = c.getContext?.('2d')
  if (!ctx) return Promise.resolve()
  // 1.5× is indistinguishable from 2× on particles this size and clears 44%
  // fewer pixels every frame.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  const w = window.innerWidth
  const h = window.innerHeight
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  root.appendChild(c)
  return new Promise((done) => {
    let last = performance.now()
    const frame = (now: number) => {
      if (!c.isConnected) return done()
      // Frame-rate independent: `dt` is in 60fps frames, capped so a dropped
      // frame doesn't teleport everything.
      const dt = Math.min(3, (now - last) / 16.667)
      last = now
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (draw(ctx, dt, w, h)) requestAnimationFrame(frame)
      else {
        c.remove()
        done()
      }
    }
    requestAnimationFrame(frame)
  })
}

/** Paper confetti from the origin: flat rectangles that flip as they fall. */
function confetti(root: HTMLElement, o: Pt, s: number, cols: string[]) {
  const n = Math.round(150 * s)
  const parts = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + rnd(-0.95, 0.95)
    const v = rnd(8, 19) * Math.sqrt(0.4 + s * 0.6)
    return {
      x: o.x,
      y: o.y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      w: rnd(6, 11),
      h: rnd(3, 6),
      r: rnd(0, Math.PI * 2),
      vr: rnd(-0.3, 0.3),
      t: rnd(0, Math.PI * 2),
      vt: rnd(0.08, 0.2),
      c: cols[i % cols.length],
      round: Math.random() < 0.22,
      life: 0,
      max: rnd(130, 200),
    }
  })
  return canvasLoop(root, (ctx, dt, _w, h) => {
    let alive = false
    const drag = Math.pow(0.982, dt)
    for (const p of parts) {
      if (p.life > p.max || p.y > h + 30) continue
      alive = true
      p.vx *= drag
      p.vy = p.vy * drag + 0.3 * dt
      p.x += p.vx * dt + Math.sin(p.t) * 0.6
      p.y += p.vy * dt
      p.r += p.vr * dt
      p.t += p.vt * dt
      p.life += dt
      ctx.globalAlpha = Math.min(1, (p.max - p.life) / 40)
      ctx.fillStyle = p.c
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.r)
      ctx.scale(1, Math.cos(p.t))
      if (p.round) {
        ctx.beginPath()
        ctx.arc(0, 0, p.h, 0, Math.PI * 2)
        ctx.fill()
      } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }
    ctx.globalAlpha = 1
    return alive
  })
}

/** Streamers thrown in from both lower corners, twisting as they fly. */
function ribbons(root: HTMLElement, s: number, cols: string[]) {
  const n = Math.round(10 + 14 * s)
  const H = window.innerHeight
  const W = window.innerWidth
  const lift = Math.sqrt(H / 900)
  const rs = Array.from({ length: n }, (_, i) => {
    const left = i % 2 === 0
    return {
      x: left ? rnd(-20, W * 0.08) : rnd(W * 0.92, W + 20),
      y: H + 10,
      vx: (left ? 1 : -1) * rnd(4, 10) * lift,
      vy: -rnd(15, 24) * lift,
      ph: rnd(0, Math.PI * 2),
      width: rnd(6, 10),
      // Pairs share a colour so both corners throw the whole palette.
      c: cols[(i >> 1) % cols.length],
      back: shade(cols[(i >> 1) % cols.length], 0.55),
      pts: [] as Pt[],
      life: -rnd(0, 18), // a ragged launch, not a volley
      max: rnd(150, 200),
    }
  })
  return canvasLoop(root, (ctx, dt) => {
    let alive = false
    const drag = Math.pow(0.985, dt)
    ctx.lineCap = 'round'
    for (const r of rs) {
      r.life += dt
      if (r.life < 0) {
        alive = true
        continue
      }
      if (r.life > r.max) continue
      alive = true
      r.vx *= drag
      r.vy = r.vy * drag + 0.26 * dt
      r.ph += 0.16 * dt
      r.x += r.vx * dt + Math.sin(r.ph) * 1.4
      r.y += r.vy * dt
      r.pts.push({ x: r.x, y: r.y })
      if (r.pts.length > 20) r.pts.shift()
      // One alpha per ribbon: per-segment alpha makes the overlapping round
      // joints bead like a string of pearls.
      ctx.globalAlpha = Math.min(1, (r.max - r.life) / 35)
      const n = r.pts.length
      for (let i = 1; i < n; i++) {
        // The twist: width and shade swing with a phase running down the
        // ribbon's length, so it reads as a strip turning over in the air —
        // the darker face is its back. The tail tapers to a point.
        const twist = Math.sin(r.ph * 0.6 + i * 0.5)
        ctx.strokeStyle = twist > 0 ? r.c : r.back
        ctx.lineWidth = r.width * (0.2 + 0.8 * Math.abs(twist)) * (0.35 + (0.65 * i) / n)
        ctx.beginPath()
        ctx.moveTo(r.pts[i - 1].x, r.pts[i - 1].y)
        ctx.lineTo(r.pts[i].x, r.pts[i].y)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    return alive
  })
}

/** One to three firework bursts clustered on the origin. */
function starburst(root: HTMLElement, o: Pt, s: number, cols: string[]) {
  const count = s > 1 ? 3 : s > 0.6 ? 2 : 1
  const offsets: Pt[] = [
    { x: 0, y: 0 },
    { x: -150 * s, y: -60 * s },
    { x: 160 * s, y: -30 * s },
  ]
  type Spark = { x: number; y: number; vx: number; vy: number; c: string; life: number; max: number }
  const bursts = offsets.slice(0, count).map((off, b) => {
    const cx = o.x + off.x
    const cy = o.y + off.y
    const n = Math.round(34 + 20 * s)
    const tint = cols[b % cols.length]
    const sparks: Spark[] = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + rnd(-0.08, 0.08)
      const v = rnd(2.6, 7) * (0.7 + s * 0.35)
      return {
        x: cx,
        y: cy,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        c: Math.random() < 0.7 ? tint : cols[(b + 1) % cols.length],
        life: 0,
        max: rnd(55, 85),
      }
    })
    return { cx, cy, delay: b * 13, t: 0, sparks }
  })
  return canvasLoop(root, (ctx, dt) => {
    let alive = false
    const drag = Math.pow(0.955, dt)
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineWidth = 2
    for (const b of bursts) {
      b.t += dt
      if (b.t < b.delay) {
        alive = true
        continue
      }
      const age = b.t - b.delay
      if (age < 14) {
        // The flash at the moment of the burst.
        ctx.globalAlpha = 1 - age / 14
        ctx.fillStyle = '#fff6ec'
        ctx.beginPath()
        ctx.arc(b.cx, b.cy, 6 + age * 3, 0, Math.PI * 2)
        ctx.fill()
      }
      for (const p of b.sparks) {
        if (p.life > p.max) continue
        alive = true
        p.vx *= drag
        p.vy = p.vy * drag + 0.045 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.life += dt
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.max)
        ctx.strokeStyle = p.c
        ctx.beginPath()
        ctx.moveTo(p.x - p.vx * 3.2, p.y - p.vy * 3.2)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    return alive
  })
}

/* ── DOM pieces ──────────────────────────────────────────────────────── */

/** Three rings and a soft disc blooming out of the origin. */
function ring(root: HTMLElement, o: Pt, s: number, cols: string[], delay = 0): Promise<unknown> {
  const reach = 1.6 + s * 1.8
  const pos = `translate(${o.x - 60}px, ${o.y - 60}px)`
  const jobs = [0, 1, 2].map((i) =>
    animate(
      piece(root, 'sl-cel-ring', cols[i % cols.length]),
      [
        { transform: `${pos} scale(0.2)`, opacity: 0.95 },
        { transform: `${pos} scale(${reach - i * 0.35})`, opacity: 0 },
      ],
      { duration: 1100 + i * 140, delay: delay + i * 130, easing: EASE.expo },
    ),
  )
  jobs.push(
    animate(
      piece(root, 'sl-cel-disc', cols[0]),
      [
        { transform: `${pos} scale(0.3)`, opacity: 0.6 },
        { transform: `${pos} scale(${reach * 0.9})`, opacity: 0 },
      ],
      { duration: 900, delay, easing: EASE.expo },
    ),
  )
  return Promise.all(jobs)
}

const STAR =
  '<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M12 0c.7 6.2 5.1 10.9 12 12-6.9 1.1-11.3 5.8-12 12-.7-6.2-5.1-10.9-12-12C6.9 10.9 11.3 6.2 12 0z"/></svg>'

/** Four-point stars — traced along a progress bar when there is one, or
 *  thrown in a loose halo round the origin when there isn't. */
function sparkles(root: HTMLElement, o: Pt, bar: Box | null, s: number, cols: string[]): Promise<unknown> {
  const n = Math.max(7, Math.round(24 * s))
  const jobs: Promise<unknown>[] = []
  for (let i = 0; i < n; i++) {
    let x: number
    let y: number
    if (bar) {
      x = bar.x + (bar.w * i) / (n - 1)
      y = bar.y + bar.h / 2 + rnd(-9, 9)
    } else {
      const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2)
      const d = rnd(34, 110) * Math.max(0.6, s)
      x = o.x + Math.cos(a) * d
      y = o.y + Math.sin(a) * d
    }
    const size = rnd(9, 18) * (bar ? 1 : Math.max(0.7, s))
    const el = piece(root, 'sl-cel-spark', cols[i % cols.length])
    el.innerHTML = STAR
    el.style.width = el.style.height = `${size}px`
    const at = `translate(${x - size / 2}px, ${y - size / 2}px)`
    const up = `translate(${x - size / 2}px, ${y - size / 2 - rnd(10, 24)}px)`
    jobs.push(
      animate(
        el,
        [
          { transform: `${at} scale(0) rotate(0deg)`, opacity: 0 },
          { transform: `${at} scale(1.15) rotate(50deg)`, opacity: 1, offset: 0.35 },
          { transform: `${up} scale(0) rotate(120deg)`, opacity: 0 },
        ],
        { duration: rnd(700, 950), delay: bar ? i * 32 : i * 14, easing: 'ease-out' },
      ),
    )
  }
  if (bar) {
    // A glint running the length of the bar, just ahead of the stars.
    const g = piece(root, 'sl-cel-glint')
    g.style.height = `${bar.h + 8}px`
    jobs.push(
      animate(
        g,
        [
          { transform: `translate(${bar.x - 70}px, ${bar.y - 4}px)`, opacity: 0 },
          { opacity: 1, offset: 0.2 },
          { opacity: 1, offset: 0.8 },
          { transform: `translate(${bar.x + bar.w}px, ${bar.y - 4}px)`, opacity: 0 },
        ],
        { duration: 32 * n + 200, easing: EASE.inOut },
      ),
    )
  }
  return Promise.all(jobs)
}

/** A rubber stamp landing on the page — hard in, a small bounce, held, then lifted away. */
function stamp(
  root: HTMLElement,
  o: Pt,
  text: { big: string; small: string },
  tone: string,
  compact: boolean,
  reduced: boolean,
): Promise<unknown> {
  const el = piece(root, compact ? 'sl-cel-stamp sl-cel-stamp--compact' : 'sl-cel-stamp', tone)
  const big = document.createElement('b')
  big.textContent = text.big
  const small = document.createElement('span')
  small.textContent = text.small
  el.append(big, small)
  const at = `translate(${o.x}px, ${o.y}px) translate(-50%, -50%)`
  if (reduced) {
    return animate(
      el,
      [
        { transform: `${at} rotate(-6deg)`, opacity: 0 },
        { transform: `${at} rotate(-6deg)`, opacity: 1, offset: 0.12 },
        { transform: `${at} rotate(-6deg)`, opacity: 1, offset: 0.85 },
        { transform: `${at} rotate(-6deg)`, opacity: 0 },
      ],
      { duration: 2600, easing: 'linear' },
    )
  }
  return animate(
    el,
    [
      { transform: `${at} scale(2.3) rotate(-16deg)`, opacity: 0, easing: 'ease-in' },
      { transform: `${at} scale(0.9) rotate(-6deg)`, opacity: 1, offset: 0.13, easing: 'ease-out' },
      { transform: `${at} scale(1.05) rotate(-6deg)`, opacity: 1, offset: 0.21, easing: 'ease-in-out' },
      { transform: `${at} scale(1) rotate(-6deg)`, opacity: 1, offset: 0.28 },
      { transform: `${at} scale(1) rotate(-6deg)`, opacity: 1, offset: 0.84, easing: 'ease-in' },
      { transform: `${at} translateY(-22px) scale(0.97) rotate(-6deg)`, opacity: 0 },
    ],
    { duration: compact ? 2300 : 2800 },
  )
}

/** "+12 cards" rising off the origin, the figure counting up as it goes. */
function tally(root: HTMLElement, o: Pt, t: { value: number; label: string }, tone: string, reduced: boolean) {
  const el = piece(root, 'sl-cel-tally', tone)
  const fig = document.createElement('b')
  const label = document.createElement('span')
  label.textContent = t.label
  el.append(fig, label)
  const set = (n: number) => (fig.textContent = `+${n}`)
  set(reduced ? t.value : 0)
  if (!reduced) {
    const start = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 900)
      set(Math.round(t.value * (1 - Math.pow(1 - k, 3))))
      if (k < 1 && el.isConnected) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  const at = (dy: number) => `translate(${o.x}px, ${o.y + dy}px) translate(-50%, -50%)`
  return animate(
    el,
    reduced
      ? [
          { transform: at(-56), opacity: 0 },
          { transform: at(-56), opacity: 1, offset: 0.15 },
          { transform: at(-56), opacity: 1, offset: 0.8 },
          { transform: at(-56), opacity: 0 },
        ]
      : [
          { transform: `${at(-20)} scale(0.8)`, opacity: 0 },
          { transform: `${at(-56)} scale(1)`, opacity: 1, offset: 0.18 },
          { transform: `${at(-84)} scale(1)`, opacity: 1, offset: 0.78 },
          { transform: `${at(-110)} scale(0.96)`, opacity: 0 },
        ],
    { duration: 2400, easing: 'ease-out' },
  )
}

/** The copy line: a slip dropping in at the top, stacking under any that's
 *  still showing. */
function caption(root: HTMLElement, o: Pt, text: string, tone: string, reduced: boolean) {
  const live = document.querySelectorAll('.sl-cel-line').length
  const el = piece(root, 'sl-cel-line', tone)
  const dot = document.createElement('i')
  const span = document.createElement('span')
  span.textContent = text
  el.append(dot, span)
  const x = Math.min(Math.max(o.x, 180), window.innerWidth - 180)
  const y = 16 + live * 48
  const at = (dy: number) => `translate(${x}px, ${y + dy}px) translateX(-50%)`
  return animate(
    el,
    reduced
      ? [
          { transform: at(0), opacity: 0 },
          { transform: at(0), opacity: 1, offset: 0.06 },
          { transform: at(0), opacity: 1, offset: 0.9 },
          { transform: at(0), opacity: 0 },
        ]
      : [
          { transform: at(-14), opacity: 0, easing: EASE.spring },
          { transform: at(0), opacity: 1, offset: 0.08 },
          { transform: at(0), opacity: 1, offset: 0.9, easing: 'ease-in' },
          { transform: at(-8), opacity: 0 },
        ],
    { duration: 4400 },
  )
}

/** Reduced motion: light arriving and leaving, with nothing moving. */
function glow(root: HTMLElement, o: Pt, tone: string) {
  const el = piece(root, 'sl-cel-disc', tone)
  const pos = `translate(${o.x - 60}px, ${o.y - 60}px) scale(1.8)`
  return animate(
    el,
    [
      { transform: pos, opacity: 0 },
      { transform: pos, opacity: 0.5, offset: 0.25 },
      { transform: pos, opacity: 0 },
    ],
    { duration: 1800, easing: 'ease-in-out' },
  )
}

/* ── Run ─────────────────────────────────────────────────────────────── */

const MAIN: Record<Variant, (root: HTMLElement, c: RunContext, s: number, cols: string[]) => Promise<unknown>> = {
  confetti: (r, c, s, cols) => confetti(r, c.origin, s, cols),
  ribbons: (r, _c, s, cols) => ribbons(r, s, cols),
  starburst: (r, c, s, cols) => starburst(r, c.origin, s, cols),
  ring: (r, c, s, cols) => ring(r, c.origin, s, cols),
  sparkles: (r, c, s, cols) => sparkles(r, c.origin, c.bar, s, cols),
}

/**
 * Play a plan. Returns how long the queue should wait before the next moment
 * may start — the main beat, not the whole tail, so a following moment
 * overlaps the falling confetti rather than waiting it out.
 */
export function run(plan: Plan, c: RunContext): number {
  watchVisibility()
  const cols = colours(plan.palette)
  const tone = cols[0]
  const { root, track } = stage()

  if (c.line) track(caption(root, c.origin, c.line, tone, c.reduced))

  if (c.reduced) {
    if (plan.main || plan.stamp) track(glow(root, c.origin, tone))
    if (plan.stamp) track(stamp(root, c.origin, plan.stamp, tone, c.compact, true))
    if (plan.tally) track(tally(root, c.origin, plan.tally, tone, true))
    return plan.stamp ? 1400 : 700
  }

  if (plan.main) track(MAIN[plan.main](root, c, plan.scale, cols))
  // The encore lands a beat later, so the big moments arrive in two waves
  // rather than one wall.
  if (plan.encore) {
    const encore = plan.encore
    const later = new Promise((r) => setTimeout(r, 380))
    track(later.then(() => root.isConnected && MAIN[encore](root, c, plan.scale * 0.8, cols)))
  }
  if (plan.ring && plan.main !== 'ring') track(ring(root, c.origin, plan.scale * 0.8, cols, 120))
  if (plan.stamp) {
    track(stamp(root, c.origin, plan.stamp, tone, c.compact, false))
    // The ink thump when it lands.
    track(ring(root, c.origin, 0.25, [tone], 330))
  }
  if (plan.tally) track(tally(root, c.origin, plan.tally, tone, false))

  if (plan.stamp) return 1900
  if (plan.main) return 1100
  return 600
}
