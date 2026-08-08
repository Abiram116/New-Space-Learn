/**
 * SM-2 lite, mirrored from the server.
 *
 * The authority is `api/app/routers/flashcards.py::grade_card`. This file
 * exists only so the review screen can show what a grade will cost *before*
 * you press it — the server still computes the number that gets stored, and
 * this must agree with it or the preview is a lie.
 *
 * Pure: no dates, no I/O, no card mutation.
 */

import type { Grade } from '../api/types'

/** The three fields a card carries into the scheduler. */
export type SchedulingState = {
  ease?: number | null
  interval_days?: number | null
  reps?: number | null
}

/**
 * Python's `round()` is round-half-to-even; JavaScript's `Math.round` is
 * round-half-up. That difference is reachable with the defaults — a fresh card
 * graded `good` lands on `round(1 * 2.5)`, which is 2 on the server and would
 * be 3 here. So round the way the server rounds.
 */
function roundHalfEven(x: number): number {
  const low = Math.floor(x)
  const frac = x - low
  if (frac > 0.5) return low + 1
  if (frac < 0.5) return low
  return low % 2 === 0 ? low : low + 1
}

/**
 * What this card becomes if graded `grade`. Line-for-line the server's branch
 * table — keep the two in step.
 */
export function nextSchedule(card: SchedulingState, grade: Grade): {
  ease: number
  interval_days: number
  reps: number
} {
  let ease = card.ease ?? 2.5
  let interval = card.interval_days ?? 0
  let reps = card.reps ?? 0

  if (grade === 'again') {
    ease = Math.max(1.3, ease - 0.2)
    interval = 1
    reps = 0
  } else if (grade === 'hard') {
    ease = Math.max(1.3, ease - 0.15)
    interval = Math.max(1, roundHalfEven(interval * 1.2))
    reps += 1
  } else if (grade === 'good') {
    interval = reps > 0 ? Math.max(1, roundHalfEven(interval * ease)) : 1
    reps += 1
  } else {
    ease = ease + 0.15
    interval = Math.max(2, roundHalfEven((interval || 1) * ease * 1.3))
    reps += 1
  }

  return { ease, interval_days: interval, reps }
}

/** Just the day count this grade would push the card out to. */
export function nextIntervalDays(card: SchedulingState, grade: Grade): number {
  return nextSchedule(card, grade).interval_days
}

/** A day count as something that fits on a button: `1d`, `10d`, `4mo`, `2y`. */
export function formatInterval(days: number): string {
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}y`
}

/** The label shown under a grade button — "if you press this, next time is…". */
export function nextIntervalLabel(card: SchedulingState, grade: Grade): string {
  return formatInterval(nextIntervalDays(card, grade))
}
