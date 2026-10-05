import type { AgentId } from './agents'
import { FOLLOW_MOODS } from './moods'

/**
 * One IntersectionObserver and one pointer listener shared by every bot on the
 * page. Nothing here touches React state: offscreen bots get `data-bot-off`
 * (mascot.css pauses their loops), and eye-follow writes two CSS variables.
 */

const hasWindow = typeof window !== 'undefined'

export function prefersReducedMotion(): boolean {
  return hasWindow && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

let io: IntersectionObserver | null = null

export function watchVisibility(el: Element): () => void {
  if (!hasWindow || typeof IntersectionObserver === 'undefined') return () => {}
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) e.target.toggleAttribute('data-bot-off', !e.isIntersecting)
  })
  io.observe(el)
  return () => io?.unobserve(el)
}

const lookers = new Set<SVGSVGElement>()
let px = 0
let py = 0
let frame = 0

function tick() {
  frame = 0
  const reads: [SVGSVGElement, number, number][] = []
  for (const el of lookers) {
    const follow = !el.hasAttribute('data-bot-off') && FOLLOW_MOODS.has(el.dataset.mood ?? '')
    if (!follow) {
      reads.push([el, 0, 0])
      continue
    }
    const r = el.getBoundingClientRect()
    const dx = px - (r.left + r.width / 2)
    const dy = py - (r.top + r.height * 0.45)
    const clamp = (v: number) => Math.max(-1, Math.min(1, v / 260))
    reads.push([el, clamp(dx) * 3.4, clamp(dy) * 2.6])
  }
  for (const [el, x, y] of reads) {
    el.style.setProperty('--lx', `${x.toFixed(2)}px`)
    el.style.setProperty('--ly', `${y.toFixed(2)}px`)
  }
}

function onMove(e: PointerEvent) {
  px = e.clientX
  py = e.clientY
  if (!frame) frame = requestAnimationFrame(tick)
}

export function followPointer(el: SVGSVGElement): () => void {
  if (!hasWindow || prefersReducedMotion()) return () => {}
  if (lookers.size === 0) {
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onMove, { passive: true })
  }
  lookers.add(el)
  return () => {
    lookers.delete(el)
    if (lookers.size === 0) {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onMove)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }
  }
}

/** Stable per-instance phase so a family on one screen never blinks in unison. */
export function phaseFrom(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h % 4000)
}

// ── Little lives ────────────────────────────────────────────────────────────
// Now and then a resting bot does something small: a double blink, a glance, a
// hop. Each is just a `data-life` attribute for a moment; mascot.css does the
// moving (transform and opacity only). One timer per bot, and nothing runs
// while the bot is offscreen, the tab is hidden, or motion is reduced.

export type Life = 'blink2' | 'blinks' | 'look' | 'hop' | 'tilt' | 'wiggle' | 'yawn'

/** How long each beat lasts (ms), a little longer than its keyframes. */
const LIFE_MS: Record<Life, number> = { blink2: 1000, blinks: 1300, look: 2800, hop: 1900, tilt: 2700, wiggle: 2300, yawn: 2600 }

/** What each one does when nobody is asking anything of it. [behaviour, weight] */
const TEMPER: Record<AgentId, { every: [number, number]; does: [Life, number][] }> = {
  // Nova: calm and warm. Slow blinks, soft glances.
  tutor: { every: [7, 14], does: [['blinks', 3], ['look', 3], ['tilt', 2], ['blink2', 2], ['hop', 1]] },
  // Flip: bouncy.
  cards: { every: [5, 10], does: [['hop', 3], ['blink2', 3], ['look', 2], ['wiggle', 2]] },
  // Pop: can't sit still.
  quiz: { every: [4, 8], does: [['hop', 4], ['wiggle', 3], ['blink2', 2], ['look', 2]] },
  // Jot: thoughtful. Looks off, tilts its head.
  notes: { every: [8, 15], does: [['look', 3], ['tilt', 3], ['blinks', 2], ['blink2', 1], ['wiggle', 1]] },
}

const QUIET: ReadonlySet<Life> = new Set<Life>(['blink2', 'blinks', 'look'])
const YAWN_AFTER_MS = 45_000
const YAWN_EVERY_MS = 90_000

let lastInput = Date.now()
let inputWatchers = 0
const noteInput = () => {
  lastInput = Date.now()
}
const INPUTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

function pickLife(agent: AgentId, quiet: boolean, rng: () => number): Life {
  const opts = TEMPER[agent].does.filter(([l]) => !quiet || QUIET.has(l))
  const total = opts.reduce((n, [, w]) => n + w, 0)
  let r = rng() * total
  for (const [l, w] of opts) if ((r -= w) < 0) return l
  return opts[0][0]
}

/**
 * Start a bot's idle life. `quiet` (calm or tiny bots) keeps it to blinks and
 * glances; everyone else may also hop, tilt, wiggle and, after the student has
 * been away from the keyboard a while, yawn.
 */
export function startLife(el: SVGSVGElement, agent: AgentId, quiet: boolean, rng: () => number = Math.random): () => void {
  if (!hasWindow || prefersReducedMotion()) return () => {}
  if (inputWatchers++ === 0) for (const t of INPUTS) window.addEventListener(t, noteInput, { passive: true })
  const [lo, hi] = TEMPER[agent].every
  let timer = 0
  let end = 0
  let lastYawn = Date.now()

  const clear = () => el.removeAttribute('data-life')
  const next = () => {
    timer = window.setTimeout(act, (lo + rng() * (hi - lo)) * 1000)
  }
  const act = () => {
    const free =
      el.dataset.mood === 'idle' &&
      !document.hidden &&
      !el.hasAttribute('data-bot-off') &&
      !el.hasAttribute('data-boop') &&
      !el.hasAttribute('data-poke') &&
      !el.hasAttribute('data-attn')
    if (!free) return next()
    const now = Date.now()
    const sleepy = !quiet && now - lastInput > YAWN_AFTER_MS && now - lastYawn > YAWN_EVERY_MS
    const life = sleepy ? 'yawn' : pickLife(agent, quiet, rng)
    if (sleepy) lastYawn = now
    el.setAttribute('data-life', life)
    end = window.setTimeout(() => {
      clear()
      next()
    }, LIFE_MS[life])
  }
  next()

  return () => {
    window.clearTimeout(timer)
    window.clearTimeout(end)
    clear()
    if (--inputWatchers === 0) for (const t of INPUTS) window.removeEventListener(t, noteInput)
  }
}
