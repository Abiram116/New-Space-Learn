import { describe, expect, it } from 'vitest'
import { suggestFor } from './suggest'

describe('suggestFor', () => {
  it('starts with a summary and moves on as the student asks', () => {
    expect(suggestFor(0)).toMatch(/Summarise/)
    expect(suggestFor(1)).not.toBe(suggestFor(0))
    expect(suggestFor(4)).toBe(suggestFor(0))
  })
  it('copes with a bad count', () => {
    expect(suggestFor(-3)).toBe(suggestFor(0))
  })
})
