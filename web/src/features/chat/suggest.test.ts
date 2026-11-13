import { describe, expect, it } from 'vitest'
import { nextSuggestion, suggestFor } from './suggest'

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

describe('nextSuggestion', () => {
  it('offers the first starter not yet asked', () => {
    expect(nextSuggestion(['What is attention?', 'How does masking work?'], ['what is attention?'])).toBe(
      'How does masking work?',
    )
  })
  it('falls back to the generic ideas once every starter was asked', () => {
    expect(nextSuggestion(['What is attention?'], ['What is attention?'])).toBe(suggestFor(1))
  })
  it('falls back when the topic has no starters', () => {
    expect(nextSuggestion([], [])).toBe(suggestFor(0))
  })
})

describe('topicStarters', () => {
  it('opens a topic with no files from its own name', async () => {
    const { topicStarters } = await import('./suggest')
    expect(topicStarters('Reinforcement Learning Basics', 'Deep Reinforcement Learning')).toEqual([
      'What is Reinforcement Learning Basics?',
      'What do I need to know about Reinforcement Learning Basics?',
      'Why does Reinforcement Learning Basics matter in Deep Reinforcement Learning?',
      'Give me a simple example of Reinforcement Learning Basics',
    ])
    expect(topicStarters('  ', 'x')).toEqual([])
    expect(topicStarters('Graphs', 'Graphs')[2]).toBe('Why does Graphs matter?')
  })
})
