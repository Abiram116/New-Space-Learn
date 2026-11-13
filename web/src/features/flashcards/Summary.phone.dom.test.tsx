// @vitest-environment jsdom
/**
 * The end-of-session summary on a small phone.
 *
 * jsdom computes no layout, so this guards the classes that make it work. The
 * ledger used to be centred by `items-center` on the scroller; when it is
 * taller than the screen (a small phone, with "Review again" under the
 * tallies) that pushes its top above the scroll area, where no amount of
 * scrolling reaches it, and the score is the first thing cut off. Centring
 * with `my-auto` on the ledger itself keeps the first line reachable.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockPhone } from '../quizzes/phoneTestUtils'
import { PRACTICE_NOTE } from './model'
import { Summary } from './Summary'

let restore: () => void
beforeEach(() => {
  restore = mockPhone()
})
afterEach(() => {
  cleanup()
  restore()
})

describe('session summary on a phone', () => {
  it('scrolls from the score down when it is taller than the screen', () => {
    render(
      <MemoryRouter>
        <Summary
          grades={['good', 'again', 'easy']}
          deckName="Transformer basics"
          onDone={vi.fn()}
          nextDeck={null}
          onReviewNext={vi.fn()}
          quizHref="/quizzes"
          onPractice={vi.fn()}
        />
      </MemoryRouter>,
    )
    const ledger = screen.getByText('solid on Transformer basics').closest('.my-auto') as HTMLElement
    expect(ledger).not.toBeNull()
    const scroller = ledger.parentElement as HTMLElement
    expect(scroller).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
    expect(scroller).not.toHaveClass('items-center')

    // The way out and the practice run are both still there.
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review again' })).toBeInTheDocument()
    expect(screen.getByText(PRACTICE_NOTE)).toBeInTheDocument()
  })
})
