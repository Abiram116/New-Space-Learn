// @vitest-environment jsdom
/**
 * Card review from the keyboard: flip, move the highlighted grade, confirm —
 * plus the guards (held keys, an Enter straight after the flip, and the
 * per-slot double-grade lock).
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Flashcard } from '../../api/types'
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
vi.mock('../../components/layout/SubspaceHeader', () => ({
  SubspaceHeader: ({ actions }: { actions?: ReactNode }) => <div>{actions}</div>,
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
function Harness() {
  const [mode, setMode] = useState<Mode>({
    kind: 'review',
    deckId: 'd',
    cards: [card('a'), card('b')],
    index: 0,
    flipped: false,
    grades: [],
  })
  latest = mode
  if (mode.kind !== 'review') return <p>done</p>
  return <Review mode={mode} setMode={setMode} onFinish={vi.fn()} showError={vi.fn()} />
}

let now = 1000
function press(key: string, init: Partial<KeyboardEventInit> = {}) {
  let notPrevented = true
  act(() => {
    notPrevented = fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
  })
  return notPrevented
}
/** Let the reader actually read the answer before a confirm key counts. */
const read = () => (now += 1000)
// `hidden`: face-up, the grade row is aria-hidden until the flip.
const gradeButton = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^${label} —`), hidden: true })

beforeEach(() => {
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  gradeCard.mockClear()
  latest = null
})

describe('review keyboard', () => {
  it('Esc ends the session without grading anything', () => {
    render(<Harness />)
    press(' ')
    press('Escape')
    expect(latest?.kind).toBe('decks')
    expect(gradeCard).not.toHaveBeenCalled()
  })

  it('Space flips, and never scrolls', () => {
    render(<Harness />)
    expect(press(' ')).toBe(false)
    expect(screen.getByRole('button', { name: 'Show question' })).toBeInTheDocument()
  })

  it('nothing grades a card that has not been flipped', () => {
    render(<Harness />)
    press('3')
    press('ArrowRight')
    expect(gradeCard).not.toHaveBeenCalled()
  })

  it('after the flip Good is highlighted, and Enter confirms it', () => {
    render(<Harness />)
    press('Enter')
    expect(gradeButton('Good')).toHaveAttribute('data-active')
    read()
    press('Enter')
    expect(gradeCard).toHaveBeenCalledWith('a', 'good')
    expect(screen.getByText('front b')).toBeInTheDocument()
  })

  it('arrows move the highlight along the scale, focus following', () => {
    render(<Harness />)
    press(' ')
    press('ArrowLeft')
    expect(gradeButton('Hard')).toHaveAttribute('data-active')
    expect(gradeButton('Hard')).toHaveFocus()
    press('ArrowUp')
    press('ArrowUp') // stops at Again
    expect(gradeButton('Again')).toHaveAttribute('data-active')
    read()
    press(' ')
    expect(gradeCard).toHaveBeenCalledWith('a', 'again')
    // Again re-queues the card at the tail.
    expect(latest?.kind === 'review' && latest.cards.map((c) => c.id)).toEqual(['a', 'b', 'a'])
  })

  it('the next card starts on Good again, with focus off the old grade', () => {
    render(<Harness />)
    press(' ')
    press('ArrowRight') // Easy
    read()
    press('Enter')
    expect(gradeCard).toHaveBeenCalledWith('a', 'easy')
    expect(gradeButton('Easy')).not.toHaveFocus()
    press(' ')
    expect(gradeButton('Good')).toHaveAttribute('data-active')
  })

  it('1–4 grade directly once flipped', () => {
    render(<Harness />)
    press(' ')
    press('4')
    expect(gradeCard).toHaveBeenCalledWith('a', 'easy')
  })

  it('an Enter straight after the flip is a double-press, not a grade', () => {
    render(<Harness />)
    press('Enter')
    press('Enter') // same instant
    expect(gradeCard).not.toHaveBeenCalled()
  })

  it('a held key never grades', () => {
    render(<Harness />)
    press(' ')
    read()
    expect(press(' ', { repeat: true })).toBe(false)
    press('3', { repeat: true })
    expect(gradeCard).not.toHaveBeenCalled()
  })

  it('one grade per card, even when a click lands on the heels of a key', () => {
    render(<Harness />)
    press(' ')
    const good = gradeButton('Good')
    act(() => {
      // Both inside one tick, before the advance can commit.
      fireEvent.keyDown(document.body, { key: '3' })
      fireEvent.click(good)
    })
    expect(gradeCard).toHaveBeenCalledTimes(1)
  })

  it('shows a legend of the keys that changes with the card side', () => {
    render(<Harness />)
    expect(screen.getByTestId('key-hints')).toHaveTextContent(/Flip the card/)
    press(' ')
    expect(screen.getByTestId('key-hints')).toHaveTextContent(/Confirm/)
  })
})
