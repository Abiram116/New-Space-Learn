/**
 * `estimateRetention` reads FSRS's own R(t, S) — the probability of recall
 * the scheduler itself grades from — not an invented proxy. It's shown to
 * students as a plain percentage (~87%) with nothing else in the UI marking
 * it as computed, so if the maths were wrong the product would be making a
 * confident numeric claim that is false. Every expected value below is
 * computed independently against the documented formula
 * `R(t,S) = (1 + FACTOR*t/S)^DECAY`, not copied from the implementation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { estimateRetention } from './retention'
import type { Flashcard } from '../api/types'

const DAY_MS = 86_400_000
const DECAY = -0.5
const FACTOR = 19 / 81

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
    stability: 10,
    difficulty: 5,
    last_review_at: new Date().toISOString(),
    ...overrides,
  }
}

function daysAgo(days: number, now: number): string {
  return new Date(now - days * DAY_MS).toISOString()
}

function expectedRetention(elapsedDays: number, stability: number): number {
  const r = (1 + (FACTOR * elapsedDays) / stability) ** DECAY
  return Math.round(Math.min(100, Math.max(0, r * 100)))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('no FSRS state yet', () => {
  it('returns null before the first review — no stability to read', () => {
    expect(estimateRetention(card({ stability: null, last_review_at: null }))).toBeNull()
  })

  it('returns a number once a real review has set stability and last_review_at', () => {
    expect(estimateRetention(card({ stability: 5, last_review_at: new Date().toISOString() }))).not.toBeNull()
  })
})

describe('the moment of review', () => {
  it('reads 100% the instant a card is reviewed (t=0)', () => {
    const now = Date.now()
    const c = card({ stability: 10, last_review_at: daysAgo(0, now) })
    expect(estimateRetention(c)).toBe(100)
  })
})

describe('matches R(t, S) exactly', () => {
  it('at t = S, R is 90% by construction', () => {
    const now = Date.now()
    const stability = 12
    const c = card({ stability, last_review_at: daysAgo(stability, now) })
    expect(estimateRetention(c)).toBe(90)
  })

  it('at an arbitrary elapsed time', () => {
    const now = Date.now()
    const stability = 6
    const elapsed = 14
    const c = card({ stability, last_review_at: daysAgo(elapsed, now) })
    expect(estimateRetention(c)).toBe(expectedRetention(elapsed, stability))
  })
})

describe('clamped to a real percentage', () => {
  it('never exceeds 100 even when the elapsed time is negative', () => {
    // last_review_at in the future relative to now — e.g. clock skew.
    const now = Date.now()
    const c = card({ stability: 10, last_review_at: daysAgo(-5, now) })
    const result = estimateRetention(c)
    expect(result).not.toBeNull()
    expect(result as number).toBeLessThanOrEqual(100)
  })

  it('always returns an integer', () => {
    const c = card({ stability: 6.4, last_review_at: daysAgo(3, Date.now()) })
    const result = estimateRetention(c)
    expect(Number.isInteger(result)).toBe(true)
  })
})

describe('behaves like a forgetting curve, not an arbitrary number', () => {
  it('decays monotonically — more elapsed time never means higher retention', () => {
    const now = Date.now()
    const soon = card({ stability: 8, last_review_at: daysAgo(2, now) })
    const later = card({ stability: 8, last_review_at: daysAgo(9, now) })
    const rSoon = estimateRetention(soon) as number
    const rLater = estimateRetention(later) as number
    expect(rLater).toBeLessThan(rSoon)
  })

  it('a more stable card retains more at the same elapsed time', () => {
    const now = Date.now()
    const fragile = card({ stability: 3, last_review_at: daysAgo(12, now) })
    const durable = card({ stability: 30, last_review_at: daysAgo(12, now) })
    const rFragile = estimateRetention(fragile) as number
    const rDurable = estimateRetention(durable) as number
    expect(rDurable).toBeGreaterThan(rFragile)
  })
})

describe('defensive floors on malformed stored state', () => {
  it('does not throw or produce NaN for a very small stability', () => {
    const c = card({ stability: 0.1, last_review_at: daysAgo(4, Date.now()) })
    const result = estimateRetention(c)
    expect(result).not.toBeNull()
    expect(Number.isNaN(result)).toBe(false)
    expect(result as number).toBeGreaterThanOrEqual(0)
    expect(result as number).toBeLessThanOrEqual(100)
  })
})
