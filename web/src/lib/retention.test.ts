/**
 * `estimateRetention` is a forgetting-curve *estimate*, shown to students as a
 * plain percentage (~87%) with nothing in the UI marking it as computed. If
 * the maths were wrong, the product would be making a confident numeric claim
 * that is false — the worst kind of bug in a study tool, because nobody can
 * tell by looking. This was the cheapest high-value test in the audit and it
 * had none.
 *
 * The formula is R(t) = e^(-t/S) · 100, t = days since last review, S = a
 * stability proxy from the card's own stored SM-2 state. Every expected value
 * below is computed independently with `Math.exp` against that formula, not
 * copied from the implementation — this is verifying the documented maths,
 * not mirroring whatever the code happens to do.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { estimateRetention } from './retention'
import type { Flashcard } from '../api/types'

const DAY_MS = 86_400_000

function card(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'c1',
    deck_id: 'd1',
    front: 'Q',
    back: 'A',
    source: null,
    ease: 2.5,
    interval_days: 10,
    reps: 3,
    due_at: new Date().toISOString(),
    ...overrides,
  }
}

/** `due_at` such that "last reviewed" lands exactly `daysAgo` days before now. */
function dueAtForLastReviewed(intervalDays: number, daysAgo: number, now: number): string {
  const lastReviewedAt = now - daysAgo * DAY_MS
  return new Date(lastReviewedAt + intervalDays * DAY_MS).toISOString()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('no history yet', () => {
  it('returns null with zero reps, not a guess', () => {
    expect(estimateRetention(card({ reps: 0 }))).toBeNull()
  })

  it('returns a number once there has been at least one review', () => {
    expect(estimateRetention(card({ reps: 1 }))).not.toBeNull()
  })
})

describe('the moment of review', () => {
  it('reads 100% the instant a card is reviewed (t=0)', () => {
    const now = Date.now()
    const c = card({ interval_days: 10, ease: 2.5, due_at: dueAtForLastReviewed(10, 0, now) })
    expect(estimateRetention(c)).toBe(100)
  })
})

describe('matches the forgetting-curve formula exactly', () => {
  it('at exactly the due date (t = interval_days)', () => {
    const now = Date.now()
    const interval = 10
    const ease = 2.0
    const c = card({
      interval_days: interval,
      ease,
      due_at: dueAtForLastReviewed(interval, interval, now),
    })
    // Independently computed: t = interval, S = interval * ease.
    const expected = Math.round(Math.exp(-interval / (interval * ease)) * 100)
    expect(estimateRetention(c)).toBe(expected)
  })

  it('at an arbitrary elapsed time past due', () => {
    const now = Date.now()
    const interval = 6
    const ease = 1.8
    const daysAgoReviewed = 14 // 8 days past the 6-day due date
    const c = card({
      interval_days: interval,
      ease,
      due_at: dueAtForLastReviewed(interval, daysAgoReviewed, now),
    })
    const stability = interval * ease
    const expected = Math.round(
      Math.min(100, Math.max(0, Math.exp(-daysAgoReviewed / stability) * 100)),
    )
    expect(estimateRetention(c)).toBe(expected)
  })
})

describe('clamped to a real percentage', () => {
  it('never exceeds 100 even when the elapsed time is negative', () => {
    // due_at set implies "last reviewed" is in the future relative to now —
    // e.g. clock skew, or a card just graded with a long new interval.
    const now = Date.now()
    const c = card({ interval_days: 10, ease: 2.5, due_at: dueAtForLastReviewed(10, -5, now) })
    const result = estimateRetention(c)
    expect(result).not.toBeNull()
    expect(result as number).toBeLessThanOrEqual(100)
  })

  it('never drops below 0 no matter how long it has been', () => {
    const now = Date.now()
    const c = card({
      interval_days: 1,
      ease: 1.3,
      due_at: dueAtForLastReviewed(1, 5000, now), // ~13.7 years overdue
    })
    expect(estimateRetention(c)).toBe(0)
  })

  it('always returns an integer', () => {
    const c = card({ interval_days: 3, ease: 2.1 })
    const result = estimateRetention(c)
    expect(Number.isInteger(result)).toBe(true)
  })
})

describe('behaves like a forgetting curve, not an arbitrary number', () => {
  it('decays monotonically — more elapsed time never means higher retention', () => {
    const now = Date.now()
    const soon = card({ interval_days: 8, ease: 2.2, due_at: dueAtForLastReviewed(8, 2, now) })
    const later = card({ interval_days: 8, ease: 2.2, due_at: dueAtForLastReviewed(8, 9, now) })
    const rSoon = estimateRetention(soon) as number
    const rLater = estimateRetention(later) as number
    expect(rLater).toBeLessThan(rSoon)
  })

  it('a more stable card (higher ease) retains more at the same elapsed time', () => {
    const now = Date.now()
    const fragile = card({
      interval_days: 5,
      ease: 1.3,
      due_at: dueAtForLastReviewed(5, 12, now),
    })
    const durable = card({
      interval_days: 5,
      ease: 3.0,
      due_at: dueAtForLastReviewed(5, 12, now),
    })
    const rFragile = estimateRetention(fragile) as number
    const rDurable = estimateRetention(durable) as number
    expect(rDurable).toBeGreaterThan(rFragile)
  })

  it('a longer interval (more repetitions banked) retains more at the same elapsed time', () => {
    const now = Date.now()
    const young = card({ interval_days: 1, ease: 2.5, due_at: dueAtForLastReviewed(1, 20, now) })
    const mature = card({
      interval_days: 60,
      ease: 2.5,
      due_at: dueAtForLastReviewed(60, 20, now),
    })
    const rYoung = estimateRetention(young) as number
    const rMature = estimateRetention(mature) as number
    expect(rMature).toBeGreaterThan(rYoung)
  })
})

describe('defensive floors on malformed stored state', () => {
  it('does not throw or produce NaN for an ease below the SM-2 floor', () => {
    // `ease` is floored at 1.3 by the scheduler (decisions.md), but this
    // function reads whatever is actually in the row — it must not trust that.
    const c = card({ interval_days: 4, ease: 0.4, reps: 2 })
    const result = estimateRetention(c)
    expect(result).not.toBeNull()
    expect(Number.isNaN(result)).toBe(false)
    expect(result as number).toBeGreaterThanOrEqual(0)
    expect(result as number).toBeLessThanOrEqual(100)
  })

  it('does not throw for a zero interval', () => {
    const c = card({ interval_days: 0, ease: 2.5, reps: 1 })
    const result = estimateRetention(c)
    expect(Number.isNaN(result)).toBe(false)
  })
})
