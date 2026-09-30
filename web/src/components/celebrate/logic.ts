/**
 * The decisions behind a celebration, with no DOM in sight: which tier a
 * score earns, which effect plays (never the one you just saw), which line is
 * said, and whether today's goal or streak has already been marked.
 *
 * Kept pure so it can be tested in the default `node` environment — the
 * effects themselves are a lazily loaded module (`effects.ts`) that this file
 * never imports.
 */

/* ── Storage ─────────────────────────────────────────────────────────── */

/** The subset of `Storage` this needs — lets tests pass a plain object. */
export type KV = Pick<Storage, 'getItem' | 'setItem'>

/** `localStorage`, or nothing. Private mode, blocked site data and SSR all
 *  land here, and none of them is worth failing a celebration over. */
export function localKV(): KV | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readJSON<T>(kv: KV | null, key: string, fallback: T): T {
  if (!kv) return fallback
  try {
    const raw = kv.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJSON(kv: KV | null, key: string, value: unknown): void {
  if (!kv) return
  try {
    kv.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode — the moment still plays, it just may repeat */
  }
}

/** Local calendar day, `YYYY-MM-DD`. The user's day, not the server's UTC one. */
export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * True exactly once per `key` per day, and marks it as it answers. A goal
 * crossed, a milestone hit — said once, then left alone for the rest of the
 * day however many sessions follow.
 */
export function onceToday(kv: KV | null, key: string, day: string = dayKey()): boolean {
  const k = `sl:celebrated:${key}`
  if (readJSON<string | null>(kv, k, null) === day) return false
  writeJSON(kv, k, day)
  return true
}

/* ── Tiers ───────────────────────────────────────────────────────────── */

export type Tier = 'grand' | 'strong' | 'light' | 'none'

/** Quiz score → how loud the moment is. Below 60 gets no fireworks: an
 *  encouraging line and the misses, which are the useful part. */
export function scoreTier(score: number): Tier {
  if (score >= 100) return 'grand'
  if (score >= 80) return 'strong'
  if (score >= 60) return 'light'
  return 'none'
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100] as const

/** The milestone the streak just reached, or null. Only an actual increase
 *  counts — a streak that was already 7 when the session began isn't news. */
export function streakMilestone(before: number, after: number): number | null {
  if (!(after > before)) return null
  return (STREAK_MILESTONES as readonly number[]).includes(after) ? after : null
}

/** The daily card goal is crossed on the one grade that takes the count from
 *  under it to at-or-over it — not on every grade after. */
export function crossedGoal(before: number, after: number, goal: number): boolean {
  return goal > 0 && before < goal && after >= goal
}

/** A retake that beats a previous score. The first attempt is never a
 *  "personal best" — there is nothing it beat. */
export function isPersonalBest(previous: number | null | undefined, score: number): boolean {
  return previous != null && score > previous
}

/** What a finished quiz says about the student's history with it. */
export type BestVerdict =
  | { kind: 'first' }
  | { kind: 'best'; previous: number; score: number }
  | { kind: 'later'; best: number; attempts: number }

/**
 * Personal-best status from the server's per-quiz facts (`previous_best` =
 * highest EARLIER score, `attempts` = count including this one).
 *
 * A best needs an earlier attempt AND a strictly higher score. A first
 * attempt is never one, and if the server sent nothing usable there is
 * nothing to say either — `first`.
 */
export function bestVerdict(
  previousBest: number | null | undefined,
  score: number,
  attempts: number | null | undefined,
): BestVerdict {
  if (previousBest == null) return { kind: 'first' }
  if (isPersonalBest(previousBest, score)) return { kind: 'best', previous: previousBest, score }
  return { kind: 'later', best: previousBest, attempts: Math.max(2, attempts ?? 2) }
}

/* ── Rotation ────────────────────────────────────────────────────────── */

/**
 * Pick from `pool`, avoiding anything in `recent` (newest last). If the pool
 * is too small to avoid all of them, it still never repeats the very last one
 * — that is the repeat you'd actually notice.
 */
export function pickFresh<T>(pool: readonly T[], recent: readonly T[], rand: () => number = Math.random): T {
  if (pool.length === 0) throw new Error('pickFresh: empty pool')
  if (pool.length === 1) return pool[0]
  let options = pool.filter((v) => !recent.includes(v))
  if (options.length === 0) {
    const last = recent[recent.length - 1]
    options = pool.filter((v) => v !== last)
  }
  return options[Math.min(options.length - 1, Math.floor(rand() * options.length))]
}

export function remember<T>(recent: readonly T[], value: T, max = 3): T[] {
  return [...recent.filter((v) => v !== value), value].slice(-max)
}

/* ── Variants and plans ──────────────────────────────────────────────── */

/** Each is a distinct piece of motion in `effects.ts`. */
export type Variant = 'confetti' | 'ribbons' | 'starburst' | 'ring' | 'sparkles'

export type Occasion =
  | 'quiz'
  | 'best'
  | 'deck'
  | 'goal'
  | 'streak'
  /** Three-plus correct in a row, mid-quiz. Small, no line — the verdict
   *  already says it. */
  | 'combo'

export type Palette = 'quiz' | 'cards' | 'goal' | 'streak'

export type Plan = {
  /** The headline effect, rotated. Null: a line and nothing else. */
  main: Variant | null
  /** A second headline effect, only for the biggest moments — a perfect
   *  sheet, a long streak. Never the same as `main`. */
  encore: Variant | null
  /** Layered on top for the bigger moments. */
  ring: boolean
  stamp: { big: string; small: string } | null
  tally: { value: number; label: string } | null
  /** Particle count / travel multiplier. */
  scale: number
  palette: Palette
}

const POOLS: Record<'grand' | 'strong' | 'light' | 'deck' | 'goal' | 'best', readonly Variant[]> = {
  grand: ['confetti', 'ribbons', 'starburst'],
  strong: ['confetti', 'starburst', 'ribbons', 'ring'],
  light: ['sparkles', 'ring'],
  deck: ['ribbons', 'confetti', 'starburst', 'sparkles'],
  goal: ['sparkles', 'starburst', 'ring'],
  best: ['ring', 'sparkles', 'starburst'],
}

export type Facts = {
  score?: number
  right?: number
  total?: number
  previous?: number
  count?: number
  goal?: number
  streak?: number
  deck?: string
}

/**
 * What plays for an occasion. `compact` is the chat dock: same moment, half
 * the particles, and no full-screen stamp competing with the conversation.
 */
export function planFor(
  occasion: Occasion,
  facts: Facts,
  recent: readonly Variant[],
  opts: { compact?: boolean; rand?: () => number } = {},
): Plan {
  const { compact = false, rand = Math.random } = opts
  const k = compact ? 0.5 : 1
  const pick = (pool: readonly Variant[]) => pickFresh(pool, recent, rand)
  const base = { ring: false, stamp: null, tally: null, encore: null } as const
  const encoreFor = (main: Variant) =>
    pickFresh(
      POOLS.grand.filter((v) => v !== main),
      [],
      rand,
    )

  switch (occasion) {
    case 'quiz': {
      const tier = scoreTier(facts.score ?? 0)
      if (tier === 'none') return { ...base, main: null, scale: 0, palette: 'quiz' }
      if (tier === 'grand') {
        const main = pick(POOLS.grand)
        return {
          ...base,
          main,
          encore: compact ? null : encoreFor(main),
          ring: true,
          stamp: { big: '100%', small: facts.total ? `${facts.total} of ${facts.total}` : 'Perfect' },
          scale: 1.2 * k,
          palette: 'quiz',
        }
      }
      if (tier === 'strong') return { ...base, main: pick(POOLS.strong), scale: 0.8 * k, palette: 'quiz' }
      return { ...base, main: pick(POOLS.light), scale: 0.55 * k, palette: 'quiz' }
    }
    case 'best':
      return {
        ...base,
        main: pick(POOLS.best),
        // No stamp: the result screen carries an inline badge beside the
        // score, and a second label landing over it read as clutter.
        scale: 0.8 * k,
        palette: 'streak',
      }
    case 'deck':
      return {
        ...base,
        main: pick(POOLS.deck),
        tally: facts.count ? { value: facts.count, label: facts.count === 1 ? 'card' : 'cards' } : null,
        scale: 0.9 * k,
        palette: 'cards',
      }
    case 'goal':
      return {
        ...base,
        main: pick(POOLS.goal),
        ring: true,
        stamp: { big: 'Goal met', small: `${facts.goal ?? 0} cards today` },
        scale: 0.9 * k,
        palette: 'goal',
      }
    case 'streak': {
      const n = facts.streak ?? 0
      const big = n >= 14
      const main = pick(big ? POOLS.grand : POOLS.strong)
      return {
        ...base,
        main,
        encore: big && !compact && main !== 'ring' ? encoreFor(main) : null,
        ring: big,
        stamp: { big: `${n} days`, small: 'in a row' },
        scale: (big ? 1.2 : 0.9) * k,
        palette: 'streak',
      }
    }
    case 'combo':
      return { ...base, main: 'sparkles', scale: 0.35, palette: 'quiz' }
  }
}

/* ── The bot who reacts ──────────────────────────────────────────────── */

/** Structural twins of the mascot's types — this file stays import-free. */
export type ReactorAgent = 'tutor' | 'cards' | 'quiz' | 'notes'
export type ReactorMood = 'celebrate' | 'cheer' | 'proud' | 'encouraging'

/**
 * Which agent reacts to a moment, and how. The quiz bot owns quiz results and
 * scales with the same tier as the effects — a rough score gets
 * `encouraging`, never a sad face (the misses are the useful part). The
 * cards bot owns decks and the daily card goal; the tutor owns the streak,
 * which is about the student, not one list. A combo is a flicker under the
 * cursor mid-quiz: no character while someone is answering.
 */
export function reactorFor(occasion: Occasion, facts: Facts): { agent: ReactorAgent; mood: ReactorMood } | null {
  switch (occasion) {
    case 'quiz': {
      const tier = scoreTier(facts.score ?? 0)
      const mood: ReactorMood =
        tier === 'grand' ? 'celebrate' : tier === 'strong' ? 'cheer' : tier === 'light' ? 'proud' : 'encouraging'
      return { agent: 'quiz', mood }
    }
    case 'best':
      return { agent: 'quiz', mood: 'proud' }
    case 'deck':
      return { agent: 'cards', mood: 'celebrate' }
    case 'goal':
      return { agent: 'cards', mood: 'cheer' }
    case 'streak':
      return { agent: 'tutor', mood: (facts.streak ?? 0) >= 14 ? 'celebrate' : 'cheer' }
    case 'combo':
      return null
  }
}

/* ── Lines ───────────────────────────────────────────────────────────── */

type Line = (f: Required<Facts>) => string

/**
 * What gets said. Every line states something true about the attempt — the
 * real score, the real count — and none of them pretends to know more than
 * the numbers do. Rotated like the effects, so the same words don't turn into
 * chrome.
 */
export const LINES: Record<string, readonly Line[]> = {
  'quiz:grand': [
    (f) => `${f.total} for ${f.total}. Every one.`,
    () => '100%. Nothing slipped past you.',
    (f) => `A clean sheet — all ${f.total} right.`,
  ],
  'quiz:strong': [
    (f) => `${f.score}% — ${f.right} of ${f.total}. That’s solid.`,
    (f) => `${f.right} out of ${f.total}. This is sticking.`,
    (f) => `${f.score}%. Most of this is yours now.`,
  ],
  'quiz:light': [
    (f) => `${f.right} of ${f.total} — more right than not.`,
    (f) => `${f.score}%. The misses below are the useful part.`,
    (f) => `${f.score}% — getting there.`,
  ],
  'quiz:none': [
    (f) => `${f.right} of ${f.total} this time. The review below is where it turns.`,
    () => 'A hard one. Each miss below says why — that’s the next step.',
    (f) => `${f.score}%. Read the misses, then take it again.`,
  ],
  best: [
    (f) => `New best on this quiz — ${f.previous}% → ${f.score}%.`,
    (f) => `Up from ${f.previous}%. The retake paid off.`,
    (f) => `Personal best: ${f.score}%, past your ${f.previous}%.`,
  ],
  deck: [
    (f) => `Deck clear — ${f.count} ${f.count === 1 ? 'card' : 'cards'} reviewed.`,
    (f) => (f.deck ? `${f.deck} is done for now.` : `All ${f.count} through. Done for now.`),
    (f) => `That’s the lot — ${f.count} reviewed, nothing left due.`,
  ],
  goal: [
    (f) => `Daily goal reached — ${f.goal} cards today.`,
    (f) => `${f.goal} cards today. That’s the goal met.`,
    (f) => `Goal met. ${f.goal} reviewed today, anything more is extra.`,
  ],
  streak: [
    (f) => `${f.streak}-day streak.`,
    (f) => `${f.streak} days in a row now.`,
    (f) => `Day ${f.streak}. The streak holds.`,
  ],
}

export function lineKey(occasion: Occasion, facts: Facts): string | null {
  if (occasion === 'combo') return null
  if (occasion === 'quiz') return `quiz:${scoreTier(facts.score ?? 0)}`
  return occasion
}

const FILL: Required<Facts> = {
  score: 0,
  right: 0,
  total: 0,
  previous: 0,
  count: 0,
  goal: 0,
  streak: 0,
  deck: '',
}

/** Returns the line and its id (for the no-repeat memory). */
export function pickLine(
  key: string,
  facts: Facts,
  recent: readonly string[],
  rand: () => number = Math.random,
): { id: string; text: string } | null {
  const pool = LINES[key]
  if (!pool?.length) return null
  const ids = pool.map((_, i) => `${key}#${i}`)
  const id = pickFresh(ids, recent, rand)
  const f = { ...FILL, ...Object.fromEntries(Object.entries(facts).filter(([, v]) => v != null)) }
  return { id, text: pool[ids.indexOf(id)](f as Required<Facts>) }
}
