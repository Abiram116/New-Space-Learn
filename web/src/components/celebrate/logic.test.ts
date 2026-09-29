import { describe, expect, it } from 'vitest'
import {
  crossedGoal,
  dayKey,
  isPersonalBest,
  LINES,
  lineKey,
  onceToday,
  pickFresh,
  pickLine,
  planFor,
  readJSON,
  remember,
  scoreTier,
  streakMilestone,
  writeJSON,
  type KV,
  type Variant,
} from './logic'

function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

/** Deterministic `Math.random` stand-in cycling through the given values. */
function seq(...xs: number[]) {
  let i = 0
  return () => xs[i++ % xs.length]
}

describe('scoreTier', () => {
  it('tiers by the real score, with no fireworks under 60', () => {
    expect(scoreTier(100)).toBe('grand')
    expect(scoreTier(99)).toBe('strong')
    expect(scoreTier(80)).toBe('strong')
    expect(scoreTier(79)).toBe('light')
    expect(scoreTier(60)).toBe('light')
    expect(scoreTier(59)).toBe('none')
    expect(scoreTier(0)).toBe('none')
  })

  it('plans no effect for the none tier — only a line', () => {
    const plan = planFor('quiz', { score: 40, right: 2, total: 5 }, [])
    expect(plan.main).toBeNull()
    expect(plan.stamp).toBeNull()
    expect(lineKey('quiz', { score: 40 })).toBe('quiz:none')
  })

  it('stamps a perfect score and scales it down in the dock', () => {
    const full = planFor('quiz', { score: 100, right: 5, total: 5 }, [])
    const dock = planFor('quiz', { score: 100, right: 5, total: 5 }, [], { compact: true })
    expect(full.stamp?.big).toBe('100%')
    expect(full.ring).toBe(true)
    expect(dock.scale).toBeLessThan(full.scale)
  })
})

describe('variant rotation', () => {
  const pool: Variant[] = ['confetti', 'ribbons', 'starburst']

  it('never picks anything in the recent list when it can avoid it', () => {
    for (const r of [0, 0.5, 0.99]) {
      expect(pickFresh(pool, ['confetti', 'ribbons'], () => r)).toBe('starburst')
    }
  })

  it('falls back to "anything but the last one" when every option is recent', () => {
    const picks = new Set([0, 0.3, 0.6, 0.99].map((r) => pickFresh(pool, ['ribbons', 'starburst', 'confetti'], () => r)))
    expect(picks.has('confetti')).toBe(false)
    expect(picks.size).toBeGreaterThan(0)
  })

  it('never repeats back-to-back over a long run', () => {
    let recent: Variant[] = []
    let last: Variant | null = null
    const rand = seq(0.1, 0.7, 0.4, 0.95, 0.2, 0.55)
    for (let i = 0; i < 60; i++) {
      const plan = planFor('quiz', { score: 100, total: 4, right: 4 }, recent, { rand })
      expect(plan.main).not.toBe(last)
      last = plan.main
      recent = remember(recent, plan.main as Variant)
    }
  })

  it('remember keeps the newest N, de-duplicated, newest last', () => {
    expect(remember(['a', 'b', 'c'], 'd')).toEqual(['b', 'c', 'd'])
    expect(remember(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
    expect(remember([], 'x', 2)).toEqual(['x'])
  })

  it('handles a single-item pool', () => {
    expect(pickFresh(['ring'], ['ring'])).toBe('ring')
  })
})

describe('lines', () => {
  it('states the real numbers', () => {
    const facts = { score: 80, right: 4, total: 5 }
    for (let i = 0; i < LINES['quiz:strong'].length; i++) {
      const line = pickLine('quiz:strong', facts, [], () => i / LINES['quiz:strong'].length)
      expect(line?.text).toMatch(/80%|4 (of|out of) 5/)
    }
  })

  it('does not repeat a recent line', () => {
    const first = pickLine('goal', { goal: 20 }, [], () => 0)!
    const second = pickLine('goal', { goal: 20 }, [first.id], () => 0)!
    expect(second.id).not.toBe(first.id)
  })

  it('has no line for a combo (the verdict already speaks)', () => {
    expect(lineKey('combo', {})).toBeNull()
  })
})

describe('once-per-day guard', () => {
  it('answers true once per key per day, then false', () => {
    const kv = memoryKV()
    expect(onceToday(kv, 'goal', '2026-09-29')).toBe(true)
    expect(onceToday(kv, 'goal', '2026-09-29')).toBe(false)
    expect(onceToday(kv, 'streak', '2026-09-29')).toBe(true)
    expect(onceToday(kv, 'goal', '2026-09-30')).toBe(true)
  })

  it('degrades to "always yes" with no storage rather than throwing', () => {
    expect(onceToday(null, 'goal', '2026-09-29')).toBe(true)
    const broken: KV = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(onceToday(broken, 'goal')).toBe(true)
    expect(readJSON(broken, 'x', 7)).toBe(7)
    expect(() => writeJSON(broken, 'x', 1)).not.toThrow()
  })

  it('dayKey is the local calendar day', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('goal, streak, personal best', () => {
  it('fires the goal only on the grade that crosses it', () => {
    expect(crossedGoal(19, 20, 20)).toBe(true)
    expect(crossedGoal(20, 21, 20)).toBe(false)
    expect(crossedGoal(18, 19, 20)).toBe(false)
    expect(crossedGoal(0, 1, 0)).toBe(false)
  })

  it('only a rise to a milestone counts', () => {
    expect(streakMilestone(6, 7)).toBe(7)
    expect(streakMilestone(2, 3)).toBe(3)
    expect(streakMilestone(7, 7)).toBeNull()
    expect(streakMilestone(7, 8)).toBeNull()
    expect(streakMilestone(99, 100)).toBe(100)
  })

  it('a first attempt is never a personal best', () => {
    expect(isPersonalBest(null, 100)).toBe(false)
    expect(isPersonalBest(60, 80)).toBe(true)
    expect(isPersonalBest(80, 80)).toBe(false)
  })
})

describe('big moments', () => {
  it('a perfect score gets an encore that differs from the headline — but not in the dock', () => {
    for (const r of [0, 0.4, 0.8]) {
      const plan = planFor('quiz', { score: 100, right: 3, total: 3 }, [], { rand: () => r })
      expect(plan.encore).not.toBeNull()
      expect(plan.encore).not.toBe(plan.main)
    }
    expect(planFor('quiz', { score: 100 }, [], { compact: true }).encore).toBeNull()
    expect(planFor('quiz', { score: 85 }, []).encore).toBeNull()
  })

  it('a long streak is louder than a short one', () => {
    const short = planFor('streak', { streak: 3 }, [])
    const long = planFor('streak', { streak: 30 }, [])
    expect(long.scale).toBeGreaterThan(short.scale)
    expect(long.stamp?.big).toBe('30 days')
  })
})
