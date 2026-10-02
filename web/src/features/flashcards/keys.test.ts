import { describe, expect, it } from 'vitest'
import { DEFAULT_GRADE_HIGHLIGHT, reviewKeyAction, type ReviewKeyState } from './keys'

const front: ReviewKeyState = { flipped: false, highlight: DEFAULT_GRADE_HIGHLIGHT, count: 4 }
const back: ReviewKeyState = { ...front, flipped: true }

describe('reviewKeyAction', () => {
  it('Good is the default highlight', () => {
    expect(DEFAULT_GRADE_HIGHLIGHT).toBe(2)
  })

  it('face-up: Space / Enter flip, and nothing grades a card you have not turned', () => {
    expect(reviewKeyAction(' ', front)).toEqual({ type: 'flip' })
    expect(reviewKeyAction('Enter', front)).toEqual({ type: 'flip' })
    for (const key of ['1', '4', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(reviewKeyAction(key, front)).toBeNull()
    }
  })

  it('flipped: Space / Enter confirm the highlighted grade', () => {
    expect(reviewKeyAction(' ', back)).toEqual({ type: 'grade', index: 2 })
    expect(reviewKeyAction('Enter', { ...back, highlight: 0 })).toEqual({ type: 'grade', index: 0 })
  })

  it('flipped: a focused grade button wins', () => {
    expect(reviewKeyAction('Enter', { ...back, focused: 3 })).toEqual({ type: 'grade', index: 3 })
  })

  it('flipped: arrows move along the scale and stop at the ends', () => {
    expect(reviewKeyAction('ArrowRight', back)).toEqual({ type: 'highlight', index: 3 })
    expect(reviewKeyAction('ArrowDown', back)).toEqual({ type: 'highlight', index: 3 })
    expect(reviewKeyAction('ArrowLeft', back)).toEqual({ type: 'highlight', index: 1 })
    expect(reviewKeyAction('ArrowUp', back)).toEqual({ type: 'highlight', index: 1 })
    expect(reviewKeyAction('ArrowRight', { ...back, highlight: 3 })).toEqual({ type: 'highlight', index: 3 })
    expect(reviewKeyAction('ArrowLeft', { ...back, highlight: 0 })).toEqual({ type: 'highlight', index: 0 })
  })

  it('flipped: 1–4 grade directly; other keys are not ours', () => {
    expect(reviewKeyAction('1', back)).toEqual({ type: 'grade', index: 0 })
    expect(reviewKeyAction('4', back)).toEqual({ type: 'grade', index: 3 })
    expect(reviewKeyAction('5', back)).toBeNull()
  })

  it('Esc ends the session, flipped or not', () => {
    expect(reviewKeyAction('Escape', front)).toEqual({ type: 'leave' })
    expect(reviewKeyAction('Escape', back)).toEqual({ type: 'leave' })
  })
})
