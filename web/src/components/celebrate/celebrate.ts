/**
 * `celebrate(occasion, options)` — the one entry point.
 *
 * Everything that decides *what* happens is in `logic.ts` and runs here, at
 * the call. Everything that *draws* is in `effects.ts`, which is loaded on
 * demand: a study session calls `preloadCelebrations()` when it opens, so the
 * ~5kB of effect code arrives while you're reading the first card rather than
 * sitting in every chunk that imports this.
 *
 * Moments queue rather than stack. Finishing a deck can cross the daily goal
 * and reach a streak milestone on the same grade; three stamps landing on top
 * of each other would read as one noise. Each waits for the previous one's
 * main beat, then goes.
 */

import { loadBotFace } from '../mascot/Bot'
import { botsEnabledNow } from '../../lib/botPreference'
import { isMobileNow } from '../../lib/useIsMobile'
import {
  lineKey,
  localKV,
  pickLine,
  planFor,
  reactorFor,
  readJSON,
  remember,
  writeJSON,
  type Facts,
  type Occasion,
  type Variant,
} from './logic'

type ElementLike = Element | { current: Element | null } | null | undefined

export type CelebrateOptions = {
  facts?: Facts
  /** Where the moment comes from — the score, the card. Read when it plays,
   *  so a ref that has moved on since the call still resolves to what's on
   *  screen now. Falls back to the middle of the viewport. */
  anchor?: ElementLike
  /** A progress bar for `sparkles` to trace. */
  bar?: ElementLike
  /** Dock density. */
  compact?: boolean
}

const RECENT_VARIANTS = 'sl:celebrate:recent:v1'
const RECENT_LINES = 'sl:celebrate:lines:v1'

type Effects = typeof import('./effects')
let effects: Promise<Effects> | null = null

export function preloadCelebrations(): Promise<Effects> {
  effects ??= import('./effects')
  // The reacting bot's face rides along, so the first moment isn't missing it.
  if (botsShownNow()) void loadBotFace().catch(() => {})
  return effects
}

let chain: Promise<void> = Promise.resolve()

export function celebrate(occasion: Occasion, options: CelebrateOptions = {}): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  // A combo is a flicker under your cursor, tied to the tap — it can't wait
  // behind a stamp that's still settling.
  if (occasion === 'combo') {
    void play(occasion, options).catch(() => {})
    return
  }
  chain = chain.then(() => play(occasion, options)).catch(() => {})
}

async function play(occasion: Occasion, options: CelebrateOptions): Promise<void> {
  // Nobody to see it. The line is still announced for assistive tech below
  // on the next visible moment — not worth queueing a replay for.
  if (document.hidden) return
  const facts = options.facts ?? {}
  const kv = localKV()

  const recent = readJSON<Variant[]>(kv, RECENT_VARIANTS, [])
  const plan = planFor(occasion, facts, recent, { compact: options.compact })
  if (plan.main && occasion !== 'combo') {
    writeJSON(kv, RECENT_VARIANTS, remember(recent, plan.main))
  }

  const key = lineKey(occasion, facts)
  let text: string | null = null
  if (key) {
    const seen = readJSON<string[]>(kv, RECENT_LINES, [])
    const line = pickLine(key, facts, seen)
    if (line) {
      text = line.text
      writeJSON(kv, RECENT_LINES, remember(seen, line.id, 12))
      announce(text)
    }
  }

  const fx = await preloadCelebrations()
  // A bot reacts beside the line (never without one — the bot is the
  // speaker, not decoration), unless the student has switched them off.
  const reactor = text && botsShownNow() ? reactorFor(occasion, facts) : null
  if (reactor) await loadBotFace().catch(() => {})
  const beat = fx.run(plan, {
    origin: centreOf(resolve(options.anchor)),
    bar: boxOf(resolve(options.bar)),
    line: text,
    bot: reactor,
    reduced: prefersReducedMotion(),
    compact: Boolean(options.compact),
  })
  await new Promise((r) => setTimeout(r, beat))
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** The non-React twin of `useBotsShown`: the preference, and not a phone. */
function botsShownNow(): boolean {
  return botsEnabledNow() && !isMobileNow()
}

function resolve(el: ElementLike): Element | null {
  if (!el) return null
  const node = 'current' in el ? el.current : el
  return node && node.isConnected ? node : null
}

function centreOf(el: Element | null): { x: number; y: number } {
  if (el) {
    const r = el.getBoundingClientRect()
    if (r.width || r.height) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.42 }
}

function boxOf(el: Element | null) {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/**
 * One persistent polite live region. A status element created at the moment
 * of the announcement is announced unreliably — some readers only watch
 * regions that existed before their content changed.
 */
let region: HTMLElement | null = null
function announce(text: string) {
  if (!region || !region.isConnected) {
    region = document.createElement('div')
    region.setAttribute('role', 'status')
    region.setAttribute('aria-live', 'polite')
    region.style.cssText =
      'position:fixed;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;'
    document.body.appendChild(region)
  }
  const r = region
  r.textContent = ''
  requestAnimationFrame(() => {
    r.textContent = text
  })
}
