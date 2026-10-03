// @vitest-environment jsdom
/**
 * Card review on a phone: one big "Show answer", then four grades with their
 * next interval under each, a swipe as a shortcut, haptics on grade — and none
 * of the desktop keyboard legend. Grading itself is the same code as desktop.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Flashcard } from '../../api/types'
import { mockPhone } from '../quizzes/phoneTestUtils'
import type { Mode } from './model'

const gradeCard = vi.fn((..._args: unknown[]) => Promise.resolve())
vi.mock('../../api/flashcards', () => ({
  gradeCard: (...args: unknown[]) => gradeCard(...args),
}))
vi.mock('../../components/celebrate', () => ({
  AmbienceField: () => null,
  noteCardGraded: vi.fn(),
  useAmbienceField: () => ({ api: { progress: vi.fn(), pulse: vi.fn() }, nodes: { current: {} } }),
  useStudySession: () => {},
}))

import { Review } from './Review'

function card(id: string): Flashcard {
  return {
    id,
    deck_id: 'd',
    front: `front ${id}`,
    back: `back ${id}`,
    source: null,
    ease: 2.5,
    interval_days: 0,
    reps: 0,
    due_at: new Date().toISOString(),
    stability: null,
    difficulty: null,
    last_review_at: null,
  }
}

let latest: Mode | null = null
function Harness({ n = 2 }: { n?: number }) {
  const [mode, setMode] = useState<Mode>({
    kind: 'review',
    deckId: 'd',
    cards: Array.from({ length: n }, (_, i) => card(String.fromCharCode(97 + i))),
    index: 0,
    flipped: false,
    grades: [],
  })
  latest = mode
  if (mode.kind !== 'review') return <p>done</p>
  return <Review
      mode={mode}
      setMode={setMode}
      onFinish={vi.fn()}
      onExit={() => setMode({ kind: 'decks' })}
      title="Deck"
      showError={vi.fn()}
    />
}

let restore: () => void
const vibrate = vi.fn()
beforeEach(() => {
  restore = mockPhone()
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  restore()
  gradeCard.mockClear()
  vibrate.mockClear()
  latest = null
})

describe('phone card review', () => {
  it('shows the count, a single Show answer, and no keyboard legend', () => {
    render(<Harness />)
    expect(screen.getByTestId('phone-review')).toBeInTheDocument()
    expect(screen.getByLabelText('Card 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show answer' })).toBeInTheDocument()
    expect(screen.queryByTestId('key-hints')).not.toBeInTheDocument()
    // No grade buttons until the card is turned.
    expect(screen.queryByRole('button', { name: /^Good/ })).not.toBeInTheDocument()
  })

  it('flips, then offers four grades with the next interval under each', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    for (const label of ['Again', 'Hard', 'Good', 'Easy']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label} — next in `) })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Show answer' })).not.toBeInTheDocument()
  })

  it('grading advances, records the grade and ticks a haptic', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    fireEvent.click(screen.getByRole('button', { name: /^Good — next in / }))
    expect(gradeCard).toHaveBeenCalledWith('a', 'good')
    expect(vibrate).toHaveBeenCalledWith(10)
    expect(screen.getByLabelText('Card 2 of 2')).toBeInTheDocument()
    // The next card arrives face-up again.
    expect(screen.getByRole('button', { name: 'Show answer' })).toBeInTheDocument()
  })

  it('Again still re-queues the card at the tail', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    fireEvent.click(screen.getByRole('button', { name: /^Again — next in / }))
    expect(screen.getByLabelText('Card 2 of 3')).toBeInTheDocument()
  })

  it('the close button ends the session', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(latest?.kind).toBe('decks')
  })

  it('explains the swipe the first time only', () => {
    const { unmount } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    expect(screen.getByText(/Swipe left for Again, right for Good/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Good — next in / }))
    unmount()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    expect(screen.queryByText(/Swipe left/)).not.toBeInTheDocument()
  })

  it('swiping a flipped card right grades Good; short drags and unflipped cards do nothing', () => {
    render(<Harness />)
    const layer = screen.getByRole('button', { name: 'Flip card' }).parentElement!.parentElement!
    const drag = (dx: number) => {
      fireEvent.pointerDown(layer, { clientX: 100, clientY: 200, pointerId: 1, pointerType: 'touch', button: 0 })
      fireEvent.pointerMove(layer, { clientX: 100 + dx / 2, clientY: 202, pointerId: 1, pointerType: 'touch' })
      fireEvent.pointerMove(layer, { clientX: 100 + dx, clientY: 204, pointerId: 1, pointerType: 'touch' })
      fireEvent.pointerUp(layer, { clientX: 100 + dx, clientY: 204, pointerId: 1, pointerType: 'touch' })
    }
    // Not flipped: swiping must not grade an unseen answer.
    drag(200)
    expect(gradeCard).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    drag(30)
    expect(gradeCard).not.toHaveBeenCalled()

    drag(220)
    // jsdom has no WAAPI, so the card leaves at once.
    act(() => {})
    expect(gradeCard).toHaveBeenCalledWith('a', 'good')
  })

  it('swiping left grades Again', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    const layer = within(screen.getByTestId('phone-review')).getByRole('button', { name: 'Show question' })
      .parentElement!.parentElement!
    fireEvent.pointerDown(layer, { clientX: 300, clientY: 200, pointerId: 2, pointerType: 'touch', button: 0 })
    fireEvent.pointerMove(layer, { clientX: 250, clientY: 201, pointerId: 2, pointerType: 'touch' })
    fireEvent.pointerMove(layer, { clientX: 80, clientY: 203, pointerId: 2, pointerType: 'touch' })
    fireEvent.pointerUp(layer, { clientX: 80, clientY: 203, pointerId: 2, pointerType: 'touch' })
    expect(gradeCard).toHaveBeenCalledWith('a', 'again')
  })
})
