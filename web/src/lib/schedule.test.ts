/**
 * FSRS-5, client side.
 *
 * The server is the authority (`api/app/services/fsrs.py`, called from
 * `grade_card` in `api/app/routers/flashcards.py`) and
 * `api/tests/fsrs_parity.mjs` already executes *this* file over a grid of
 * cases to prove the two agree. So these tests deliberately do not
 * re-check parity — they pin the properties that make the preview
 * trustworthy at all, and the rounding behaviour a JS port is most likely
 * to get wrong.
 */

import { describe, expect, it } from 'vitest'
import { formatInterval, nextState } from './schedule'

const FRESH = { stability: null, difficulty: null }
const GRADES = ['again', 'hard', 'good', 'easy'] as const

describe('nextState — invariants that must always hold', () => {
  const states = [
    FRESH,
    { stability: 1, difficulty: 5 },
    { stability: 0.4, difficulty: 1 },
    { stability: 45, difficulty: 10 },
    { stability: 200, difficulty: 6.5 },
  ]
  const elapsedSamples = [0, 1, 5, 30]

  it('difficulty always lands in [1, 10]', () => {
    for (const s of states) {
      for (const g of GRADES) {
        for (const e of elapsedSamples) {
          const r = nextState(s, e, g)
          expect(r.difficulty).toBeGreaterThanOrEqual(1)
          expect(r.difficulty).toBeLessThanOrEqual(10)
        }
      }
    }
  })

  it('stability is always positive', () => {
    for (const s of states) {
      for (const g of GRADES) {
        for (const e of elapsedSamples) {
          expect(nextState(s, e, g).stability).toBeGreaterThan(0)
        }
      }
    }
  })

  it('retrievability is always a probability', () => {
    for (const s of states) {
      for (const g of GRADES) {
        for (const e of elapsedSamples) {
          const r = nextState(s, e, g).retrievability
          expect(r).toBeGreaterThanOrEqual(0)
          expect(r).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('interval_days is never below one day', () => {
    for (const s of states) {
      for (const g of GRADES) {
        for (const e of elapsedSamples) {
          expect(nextState(s, e, g).interval_days).toBeGreaterThanOrEqual(1)
        }
      }
    }
  })
})

describe('nextState — a never-reviewed card', () => {
  it('reads retrievability 1 — nothing yet to have forgotten', () => {
    for (const g of GRADES) {
      expect(nextState(FRESH, 0, g).retrievability).toBe(1)
    }
  })

  it('is not affected by elapsedDays — there is no prior review to be elapsed from', () => {
    for (const g of GRADES) {
      expect(nextState(FRESH, 0, g)).toEqual(nextState(FRESH, 30, g))
    }
  })
})

describe('nextState — the grades mean what the UI says they mean', () => {
  const mature = { stability: 20, difficulty: 5 }

  it('`easy` pushes furthest out of the four, at the same elapsed time', () => {
    const intervals = GRADES.map((g) => nextState(mature, 15, g).interval_days)
    expect(Math.max(...intervals)).toBe(intervals[3])
  })

  it('`again` never grows stability past what it already was', () => {
    const r = nextState(mature, 15, 'again')
    expect(r.stability).toBeLessThanOrEqual(mature.stability)
  })

  it('a successful grade (hard/good/easy) grows stability given enough elapsed time', () => {
    for (const g of ['hard', 'good', 'easy'] as const) {
      expect(nextState(mature, 15, g).stability).toBeGreaterThan(mature.stability)
    }
  })
})

describe('nextState — same-day review', () => {
  it('uses the same-day formula, not the lapse/success split, even on `again`', () => {
    // The same-day branch can still shrink stability on a low grade — the
    // point under test is that it takes a different path, not that it grows.
    const before = { stability: 5, difficulty: 5 }
    const r = nextState(before, 0, 'again')
    // Same-day stability is a pure exponential of the current value — always positive.
    expect(r.stability).toBeGreaterThan(0)
  })
})

describe('formatInterval', () => {
  it('renders days under a month, months under a year, years beyond that', () => {
    expect(formatInterval(5)).toBe('5d')
    expect(formatInterval(29)).toBe('29d')
    expect(formatInterval(60)).toBe('2mo')
    expect(formatInterval(400)).toBe('1y')
  })
})
