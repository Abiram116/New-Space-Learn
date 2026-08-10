/**
 * SM-2 lite, client side.
 *
 * The server is the authority (`grade_card` in `api/app/routers/flashcards.py`)
 * and `api/tests/sm2_parity.mjs` already executes *this* file over 480 cases
 * to prove the two agree. So these tests deliberately do not re-check parity —
 * they pin the properties that make the preview trustworthy at all, and the
 * one behaviour a JS port is most likely to get wrong.
 */

import { describe, expect, it } from 'vitest'
import { nextSchedule } from './schedule'

const FRESH = { ease: null, interval_days: null, reps: null }

describe('nextSchedule — the rounding trap', () => {
  it('rounds half-to-even like Python, not half-up like JavaScript', () => {
    // A fresh card graded `good` twice reaches interval 1 at reps 1, then
    // round(1 * 2.5). Python's round() gives 2; Math.round would give 3.
    // Getting this wrong shows the student an interval the server will not
    // honour, which is exactly the lie this module exists to avoid.
    const once = nextSchedule(FRESH, 'good')
    const twice = nextSchedule(once, 'good')
    expect(twice.interval_days).toBe(2)
  })

  it('rounds .5 down when the floor is even', () => {
    expect(nextSchedule({ ease: 2.5, interval_days: 1, reps: 1 }, 'good').interval_days).toBe(2)
  })
})

describe('nextSchedule — invariants that must always hold', () => {
  const states = [
    FRESH,
    { ease: 2.5, interval_days: 0, reps: 0 },
    { ease: 1.3, interval_days: 1, reps: 1 },
    { ease: 2.8, interval_days: 30, reps: 9 },
    { ease: 1.9, interval_days: 7, reps: 3 },
  ]
  const grades = ['again', 'hard', 'good', 'easy'] as const

  it('never lets ease fall below the 1.3 floor', () => {
    for (const s of states) {
      for (const g of grades) {
        expect(nextSchedule(s, g).ease).toBeGreaterThanOrEqual(1.3)
      }
    }
  })

  it('never returns an interval below one day', () => {
    for (const s of states) {
      for (const g of grades) {
        expect(nextSchedule(s, g).interval_days).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('never returns a negative rep count', () => {
    for (const s of states) {
      for (const g of grades) {
        expect(nextSchedule(s, g).reps).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('tolerates a card with every field missing', () => {
    expect(() => nextSchedule({}, 'good')).not.toThrow()
  })
})

describe('nextSchedule — the grades mean what the UI says they mean', () => {
  const mature = { ease: 2.5, interval_days: 20, reps: 5 }

  it('`again` resets to one day and zeroes the streak', () => {
    const r = nextSchedule(mature, 'again')
    expect(r.interval_days).toBe(1)
    expect(r.reps).toBe(0)
  })

  it('`easy` pushes furthest out of the four', () => {
    const intervals = (['again', 'hard', 'good', 'easy'] as const).map(
      (g) => nextSchedule(mature, g).interval_days,
    )
    expect(Math.max(...intervals)).toBe(intervals[3])
  })

  it('`again` lowers ease and `easy` raises it', () => {
    expect(nextSchedule(mature, 'again').ease).toBeLessThan(mature.ease)
    expect(nextSchedule(mature, 'easy').ease).toBeGreaterThan(mature.ease)
  })
})
