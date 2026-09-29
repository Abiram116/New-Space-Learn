import { describe, expect, it } from 'vitest'
import { bezier, EASE } from './motion'

describe('bezier', () => {
  it('pins the ends', () => {
    expect(EASE(0)).toBe(0)
    expect(EASE(1)).toBe(1)
  })

  it('matches a linear curve exactly', () => {
    const linear = bezier(0.25, 0.25, 0.75, 0.75)
    for (const x of [0.1, 0.33, 0.5, 0.9]) expect(linear(x)).toBeCloseTo(x, 5)
  })

  it('is an ease-out — most of the travel happens early — and never runs backwards', () => {
    expect(EASE(0.3)).toBeGreaterThan(0.6)
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const y = EASE(i / 100)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
  })
})
