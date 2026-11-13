// @vitest-environment jsdom
/**
 * Two things a review says for itself, on desktop and on a phone:
 *
 * - what the four grades mean, once, on a first review on this device;
 * - how many grades have not reached the server. A grade that could not be
 *   sent is kept and retried (see `api/flashcards`), the session carries on,
 *   and the summary never passes an unsaved grade off as saved.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/errors'
import type { Flashcard } from '../../api/types'
import { mockPhone } from '../quizzes/phoneTestUtils'
import type { Mode } from './model'

// A stand-in for the outbox: the count is whatever the test says it is.
const outbox = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { count: 0 }
  return {
    state,
    listeners,
    set(n: number) {
      state.count = n
      for (const fn of [...listeners]) fn()
    },
  }
})
const gradeCard = vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve())
const retryUnsavedGrades = vi.fn((): Promise<number> => Promise.resolve(0))
vi.mock('../../api/flashcards', () => ({
  gradeCard: (...args: unknown[]) => gradeCard(...args),
  gradeWillRetry: (err: unknown) => err instanceof ApiError && err.code === 'network',
  unsavedGradeCount: () => outbox.state.count,
  onUnsavedGrades: (fn: () => void) => {
    outbox.listeners.add(fn)
    return () => outbox.listeners.delete(fn)
  },
  retryUnsavedGrades: () => retryUnsavedGrades(),
}))
vi.mock('../../components/celebrate', () => ({
  AmbienceField: () => null,
  celebrate: vi.fn(),
  noteCardGraded: vi.fn(),
  useAmbienceField: () => ({ api: { progress: vi.fn(), pulse: vi.fn() }, nodes: { current: {} } }),
  useStudySession: () => {},
}))
vi.mock('../../components/mascot', () => ({
  Reaction: () => null,
  scoreArc: () => ({ mood: 'idle', settle: 'idle' }),
}))
vi.mock('../../components/layout/SubspaceHeader', () => ({
  SubspaceHeader: ({ title, actions }: { title?: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}))

import { Review } from './Review'
import { Summary } from './Summary'

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

const showError = vi.fn()
function Harness({ n = 2 }: { n?: number }) {
  const [mode, setMode] = useState<Mode>({
    kind: 'review',
    deckId: 'd',
    cards: Array.from({ length: n }, (_, i) => card(String.fromCharCode(97 + i))),
    index: 0,
    flipped: false,
    grades: [],
  })
  if (mode.kind === 'summary') {
    return (
      <MemoryRouter>
        <Summary
          grades={mode.grades}
          deckName="Deck"
          onDone={vi.fn()}
          nextDeck={null}
          onReviewNext={vi.fn()}
          quizHref="/quizzes"
        />
      </MemoryRouter>
    )
  }
  if (mode.kind !== 'review') return <p>left</p>
  return (
    <Review
      mode={mode}
      setMode={setMode}
      onFinish={vi.fn()}
      onExit={() => setMode({ kind: 'decks' })}
      title="Deck"
      showError={showError}
    />
  )
}

const offline = () => new ApiError('network', "Can't reach the server.", 0)
const flipAndGrade = (grade: RegExp) => {
  // The phone has two ways to flip (the card and the big button); either will do.
  fireEvent.click(screen.getAllByRole('button', { name: /Show answer|Flip card/ })[0])
  fireEvent.click(screen.getByRole('button', { name: grade }))
}
const HELP = /forgot it.*got it, slowly.*knew it\..*knew it at once/

let restorePhone: (() => void) | null = null
beforeEach(() => {
  localStorage.clear()
  outbox.set(0)
  gradeCard.mockReset().mockImplementation(() => Promise.resolve())
  retryUnsavedGrades.mockReset().mockImplementation(() => Promise.resolve(0))
})
afterEach(() => {
  cleanup()
  restorePhone?.()
  restorePhone = null
  vi.clearAllMocks()
})

describe.each([
  ['desktop', false],
  ['phone', true],
])('first review on %s', (_name, phone) => {
  beforeEach(() => {
    if (phone) restorePhone = mockPhone()
  })

  it('explains the four grades before the first flip', () => {
    render(<Harness />)
    expect(screen.getByRole('note')).toHaveTextContent(HELP)
  })

  it('stays for the first session, then never comes back', () => {
    const first = render(<Harness n={3} />)
    flipAndGrade(/^Good/)
    // Still there to read while this session runs.
    expect(screen.getByRole('note')).toBeInTheDocument()
    first.unmount()

    render(<Harness />)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('can be dismissed, and stays dismissed', () => {
    const first = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Got it, hide this' }))
    expect(screen.queryByRole('note')).toBeNull()
    first.unmount()

    render(<Harness />)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('a grade that cannot be sent does not stop the session or raise an error per card', async () => {
    gradeCard.mockImplementation(() => {
      outbox.set(outbox.state.count + 1)
      return Promise.reject(offline())
    })
    render(<Harness n={3} />)
    flipAndGrade(/^Good/)
    await act(async () => {})
    // On to the next card, with the count of what is waiting in view.
    expect(screen.getByLabelText('Card 2 of 3')).toBeInTheDocument()
    expect(screen.getByText(/^1 grade not saved yet\./)).toBeInTheDocument()
    flipAndGrade(/^Hard/)
    await act(async () => {})
    expect(screen.getByText(/^2 grades not saved yet\./)).toBeInTheDocument()
    expect(showError).not.toHaveBeenCalled()
  })

  it('a grade the server refused is still reported', async () => {
    const refused = new ApiError('not_found', 'Card not found.', 404)
    gradeCard.mockImplementation(() => Promise.reject(refused))
    render(<Harness n={3} />)
    flipAndGrade(/^Good/)
    await waitFor(() => expect(showError).toHaveBeenCalledWith(refused))
  })

  it('the summary says how many grades are unsaved and offers to save them', async () => {
    gradeCard.mockImplementation(() => {
      outbox.set(outbox.state.count + 1)
      return Promise.reject(offline())
    })
    render(<Harness n={2} />)
    flipAndGrade(/^Good/)
    flipAndGrade(/^Easy/)
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('2 grades are not saved yet, so those cards stay due.')
    // It does not claim the schedule moved.
    expect(screen.queryByText(/You knew them all/)).toBeNull()

    // Still offline: the count stays, and it says the try did not work.
    retryUnsavedGrades.mockResolvedValueOnce(2)
    fireEvent.click(screen.getByRole('button', { name: 'Try saving again' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('That did not work yet.'))
    expect(screen.getByRole('status')).toHaveTextContent('2 grades are not saved yet')

    // Back online: they go through and the notice gives way to the usual line.
    retryUnsavedGrades.mockImplementationOnce(() => {
      outbox.set(0)
      return Promise.resolve(0)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try saving again' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(screen.getByText(/You knew them all/)).toBeInTheDocument()
  })

  it('with everything saved the summary has no such notice', () => {
    render(<Harness n={1} />)
    flipAndGrade(/^Good/)
    expect(screen.getByText(/You knew them all/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try saving again' })).toBeNull()
  })
})

describe('ending a session early', () => {
  it('does not say the grades are saved while some are not', async () => {
    gradeCard.mockImplementation(() => {
      outbox.set(1)
      return Promise.reject(offline())
    })
    render(<Harness n={3} />)
    flipAndGrade(/^Good/)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /End session/ }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('1 grade not saved yet.')
    expect(dialog).not.toHaveTextContent('Your grades are saved')
  })
})
