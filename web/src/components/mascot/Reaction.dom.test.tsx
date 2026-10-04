// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LINES, fill } from '../../lib/botVoice'
import { Reaction } from './Reaction'

afterEach(cleanup)

describe('Reaction', () => {
  it('says a line from the companion\u2019s own voice, filled with the real facts', () => {
    render(<Reaction agent="quiz" situation="quizRough" facts={{ score: 35 }} mood="encouraging" />)
    const own = (LINES.quizRough.quiz ?? []).map((l) => fill(l, 'quiz', { score: 35 }).trim())
    const shown = screen.getByText(/./, { selector: '.bot-bubble' }).textContent ?? ''
    // Never a line another companion would say, and never a number that wasn't passed in.
    expect([...own, ...(LINES.quizRough.any ?? []).map((l) => fill(l, 'quiz', { score: 35 }))]).toContain(shown)
    expect(shown).not.toMatch(/\{|\}/)
  })

  it('works with no facts at all', () => {
    render(<Reaction agent="cards" situation="sessionEnd" mood="cheer" />)
    expect(screen.getByText(/./, { selector: '.bot-bubble' }).textContent).not.toMatch(/\{|\}|undefined/)
  })
})
