// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOT_MOODS, Reaction, scoreArc } from '.'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('scoreArc', () => {
  it('meets each band its own way, with real moods, and never a sad face for a rough score', () => {
    expect(scoreArc(95)).toEqual({ mood: 'awe', settle: 'love' })
    expect(scoreArc(85).mood).toBe('celebrate')
    expect(scoreArc(60).mood).toBe('cheer')
    expect(scoreArc(20).mood).toBe('encouraging')
    for (const s of [0, 49, 50, 79, 80, 89, 90, 100]) {
      const { mood, settle } = scoreArc(s)
      expect(BOT_MOODS).toContain(mood)
      expect(BOT_MOODS).toContain(settle)
      expect(mood).not.toBe('sad')
    }
  })
})

describe('Reaction', () => {
  it('reacts, then rests: the mood settles after a few seconds', () => {
    vi.useFakeTimers()
    const { container } = render(<Reaction agent="quiz" situation="quizGreat" facts={{ score: 95 }} mood="awe" settle="love" />)
    const svg = () => container.querySelector('svg')!
    expect(svg().dataset.mood).toBe('awe')
    act(() => void vi.advanceTimersByTime(4000))
    expect(svg().dataset.mood).toBe('love')
  })

  it('is calm and giggles when poked', () => {
    const { container } = render(<Reaction agent="cards" situation="sessionEnd" facts={{ count: 5 }} mood="cheer" />)
    expect(container.querySelector('svg')).toHaveAttribute('data-calm')
  })
})
