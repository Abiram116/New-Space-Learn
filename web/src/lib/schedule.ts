/**
 * FSRS-5, mirrored from the server.
 *
 * The authority is `api/app/services/fsrs.py`, called from
 * `api/app/routers/flashcards.py::grade_card`. This file exists only so the
 * review screen can show what a grade will cost *before* you press it — the
 * server still computes the numbers that get stored, and this must agree
 * with it or the preview is a lie.
 *
 * `nextState` is the pure core: stability/difficulty in (`null` for a card
 * that's never been reviewed), elapsed days and a grade in, next
 * stability/difficulty/retrievability/interval out — no dates, no I/O, no
 * card mutation. `nextIntervalDays`/`nextIntervalLabel` are the convenience
 * wrappers the UI actually calls: they read `last_review_at` against the
 * clock to get `elapsedDays`, then defer to the pure core.
 */

import type { Flashcard, Grade } from '../api/types'

/** The two fields a card carries into the scheduler, plus what dates it. */
export type SchedulingState = Pick<Flashcard, 'stability' | 'difficulty' | 'last_review_at'>

/** FSRS-5 default weights, w[0]..w[18]. */
const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
] as const

const DECAY = -0.5
const FACTOR = 19 / 81 // chosen so R(t=S, S) = 0.9
const DESIRED_RETENTION = 0.9

const MIN_DIFFICULTY = 1
const MAX_DIFFICULTY = 10
const MIN_INTERVAL_DAYS = 1
const MAX_INTERVAL_DAYS = 36500

/** Grades 1=again 2=hard 3=good 4=easy. */
const GRADE_NUMBER: Record<Grade, number> = { again: 1, hard: 2, good: 3, easy: 4 }

function clampDifficulty(d: number): number {
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, d))
}

/**
 * Python's `round()` is round-half-to-even; JavaScript's `Math.round` is
 * round-half-up. That difference was reachable under the old SM-2-lite
 * scheduler and cost a wrong on-screen interval, so the interval rounding
 * below goes through this instead of `Math.round`.
 */
function roundHalfEven(x: number): number {
  const low = Math.floor(x)
  const frac = x - low
  if (frac > 0.5) return low + 1
  if (frac < 0.5) return low
  return low % 2 === 0 ? low : low + 1
}

/** R(t, S) = (1 + FACTOR*t/S)^DECAY — probability of recall right now. */
export function retrievability(elapsedDays: number, stability: number): number {
  return (1 + (FACTOR * elapsedDays) / stability) ** DECAY
}

/** Days until R decays to DESIRED_RETENTION, clamped to [1, 36500]. */
export function nextIntervalFromStability(stability: number): number {
  const raw = (stability / FACTOR) * (DESIRED_RETENTION ** (1 / DECAY) - 1)
  return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, roundHalfEven(raw)))
}

/** S0(G) = w[G-1] — a never-reviewed card's stability after its first grade. */
function initialStability(grade: number): number {
  return W[grade - 1]
}

/** D0(G) = w4 - exp(w5*(G-1)) + 1, clamped to [1, 10]. */
function initialDifficulty(grade: number): number {
  return clampDifficulty(W[4] - Math.exp(W[5] * (grade - 1)) + 1)
}

/** Linear damping toward the rated grade, then mean reversion to D0(easy). */
function nextDifficulty(difficulty: number, grade: number): number {
  const damped = difficulty - W[6] * (grade - 3) * ((10 - difficulty) / 9)
  const reverted = W[7] * initialDifficulty(4) + (1 - W[7]) * damped
  return clampDifficulty(reverted)
}

/** S' after a review. Same-day review overrides the lapse/success split below. */
function nextStability(args: {
  difficulty: number
  stability: number
  r: number
  grade: number
  elapsedDays: number
}): number {
  const { difficulty, stability, r, grade, elapsedDays } = args
  if (elapsedDays < 1) {
    return stability * Math.exp(W[17] * (grade - 3 + W[18]))
  }
  if (grade === 1) {
    // lapse
    return Math.min(
      stability,
      W[11] * difficulty ** -W[12] * ((stability + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - r)),
    )
  }
  // success (hard/good/easy)
  const bonus = (grade === 2 ? W[15] : 1) * (grade === 4 ? W[16] : 1)
  const gain =
    Math.exp(W[8]) * (11 - difficulty) * stability ** -W[9] * (Math.exp(W[10] * (1 - r)) - 1) * bonus
  return stability * (1 + gain)
}

/**
 * The pure FSRS-5 core. Line-for-line the server's `fsrs.py::review` — keep
 * the two in step.
 */
export function nextState(
  card: { stability: number | null; difficulty: number | null },
  elapsedDays: number,
  grade: Grade,
): { stability: number; difficulty: number; retrievability: number; interval_days: number } {
  const g = GRADE_NUMBER[grade]
  let stability: number
  let difficulty: number
  let r: number
  if (card.stability == null || card.difficulty == null) {
    r = 1
    stability = initialStability(g)
    difficulty = initialDifficulty(g)
  } else {
    r = retrievability(elapsedDays, card.stability)
    stability = nextStability({ difficulty: card.difficulty, stability: card.stability, r, grade: g, elapsedDays })
    difficulty = nextDifficulty(card.difficulty, g)
  }
  return { stability, difficulty, retrievability: r, interval_days: nextIntervalFromStability(stability) }
}

/** Days since `lastReviewAt`, floored — day granularity, matching the server. */
function elapsedDaysSince(lastReviewAt: string | null, now: number): number {
  if (!lastReviewAt) return 0
  return Math.max(0, Math.floor((now - new Date(lastReviewAt).getTime()) / 86_400_000))
}

/**
 * Just the day count this grade would push the card out to. `now` defaults
 * to the real clock; tests pass a fixed value to stay deterministic.
 */
export function nextIntervalDays(card: SchedulingState, grade: Grade, now: number = Date.now()): number {
  const elapsed = elapsedDaysSince(card.last_review_at, now)
  return nextState({ stability: card.stability, difficulty: card.difficulty }, elapsed, grade).interval_days
}

/** A day count as something that fits on a button: `1d`, `10d`, `4mo`, `2y`. */
export function formatInterval(days: number): string {
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}y`
}

/** The label shown under a grade button — "if you press this, next time is…". */
export function nextIntervalLabel(card: SchedulingState, grade: Grade, now: number = Date.now()): string {
  return formatInterval(nextIntervalDays(card, grade, now))
}
