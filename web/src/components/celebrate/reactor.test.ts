import { describe, expect, it } from 'vitest'
import { reactorFor } from './logic'

describe('reactorFor — which bot reacts, and how', () => {
  it('scales the quiz bot with the same tiers as the effects, never sad', () => {
    expect(reactorFor('quiz', { score: 100 })).toEqual({ agent: 'quiz', mood: 'celebrate' })
    expect(reactorFor('quiz', { score: 85 })).toEqual({ agent: 'quiz', mood: 'cheer' })
    expect(reactorFor('quiz', { score: 65 })).toEqual({ agent: 'quiz', mood: 'proud' })
    expect(reactorFor('quiz', { score: 20 })).toEqual({ agent: 'quiz', mood: 'encouraging' })
    expect(reactorFor('quiz', {})).toEqual({ agent: 'quiz', mood: 'encouraging' })
  })

  it('gives each moment to the agent who owns it', () => {
    expect(reactorFor('best', { score: 70, previous: 50 })?.agent).toBe('quiz')
    expect(reactorFor('deck', { count: 12 })?.agent).toBe('cards')
    expect(reactorFor('goal', { goal: 20 })?.agent).toBe('cards')
    expect(reactorFor('streak', { streak: 7 })).toEqual({ agent: 'tutor', mood: 'cheer' })
    expect(reactorFor('streak', { streak: 30 })).toEqual({ agent: 'tutor', mood: 'celebrate' })
  })

  it('keeps characters off the screen mid-quiz', () => {
    expect(reactorFor('combo', {})).toBeNull()
  })
})
