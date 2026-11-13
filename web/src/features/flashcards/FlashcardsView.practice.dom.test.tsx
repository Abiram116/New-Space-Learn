// @vitest-environment jsdom
/**
 * "Review again": a deck with nothing due can still be gone through. It is a
 * flip-through that sends no grades — the server reschedules a card on every
 * grade, so this is the only way extra practice leaves the schedule alone —
 * and the screen says so.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { clearCache } from '../../lib/asyncCache'
import type { Deck, Flashcard, Space, Subspace } from '../../api/types'
import { mockPhone } from '../quizzes/phoneTestUtils'
import { PRACTICE_NOTE } from './model'

const SUB: Subspace = { id: 'sub', subject_id: 'sp', name: 'Attention', last_activity_at: null, counts: {} }
const SPACE: Space = { id: 'sp', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUB] }
vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({ space: SPACE, subspace: SUB, base: '/spaces/sp/sub' }),
}))
vi.mock('../../lib/useTopicScope', async () => {
  const nav = await import('../../lib/nav')
  return { useTopicScope: () => ({ ...nav.useActiveSubspace(), isGlobal: false }) }
})
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: [SPACE] }) }))
vi.mock('../../components/celebrate', () => ({
  AmbienceField: () => null,
  celebrate: vi.fn(),
  noteCardGraded: vi.fn(),
  useAmbienceField: () => ({ api: { progress: vi.fn(), pulse: vi.fn() }, nodes: { current: {} } }),
  useStudySession: () => {},
}))

const deck = (id: string, due: number): Deck => ({
  id,
  name: `Deck ${id}`,
  total: 2,
  due,
  known_pct: 50,
  subspace_id: SUB.id,
  subspace_name: SUB.name,
  subject_name: SPACE.name,
})
const card = (id: string, dueInMs: number): Flashcard => ({
  id,
  deck_id: 'a',
  front: `front ${id}`,
  back: `back ${id}`,
  source: null,
  ease: 2.5,
  interval_days: 3,
  reps: 1,
  due_at: new Date(Date.now() + dueInMs).toISOString(),
  stability: 3,
  difficulty: 5,
  last_review_at: new Date().toISOString(),
})
const DAY = 86_400_000

const listAllDecks = vi.fn()
const listCards = vi.fn()
const gradeCard = vi.fn(() => Promise.resolve())
vi.mock('../../api/flashcards', () => ({
  // The unsaved-grade outbox (see api/flashcards): nothing waiting in these tests.
  gradeWillRetry: () => false,
  onUnsavedGrades: () => () => {},
  unsavedGradeCount: () => 0,
  retryUnsavedGrades: () => Promise.resolve(0),
  renameDeck: vi.fn(),
  listAllDecks: (...a: unknown[]) => listAllDecks(...a),
  listDecks: vi.fn(),
  createDeck: vi.fn(),
  deleteDeck: vi.fn(),
  listCards: (...a: unknown[]) => listCards(...a),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  deleteCard: vi.fn(),
  generateCards: vi.fn(),
  gradeCard: (...a: unknown[]) => (gradeCard as (...x: unknown[]) => unknown)(...a),
}))

import { FlashcardsView } from './FlashcardsView'

const renderAt = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <ToastProvider>
        <FlashcardsView />
      </ToastProvider>
    </MemoryRouter>,
  )

let restoreDevice: (() => void) | null = null
afterEach(() => {
  cleanup()
  clearCache()
  vi.clearAllMocks()
  restoreDevice?.()
  restoreDevice = null
})

describe('a deck with nothing due', () => {
  it('can be gone through again from its tile, without sending a grade', async () => {
    listAllDecks.mockResolvedValue([deck('a', 0)])
    listCards.mockResolvedValue([card('a1', DAY), card('a2', 2 * DAY)])
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Review again' }))
    // Every card, not only the due ones.
    await waitFor(() => expect(listCards).toHaveBeenCalledWith('a'))
    expect(await screen.findByLabelText('Card 1 of 2')).toBeInTheDocument()
    expect(screen.getByText(PRACTICE_NOTE)).toBeInTheDocument()
    // No grades to press: only the answer, then the next card.
    expect(screen.queryByRole('button', { name: /^Good/, hidden: true })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }))
    expect(screen.getByLabelText('Card 2 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByLabelText('Card 1 of 2')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    // Back on the binder, and the schedule was never touched.
    expect(await screen.findByText('Deck a')).toBeInTheDocument()
    expect(gradeCard).not.toHaveBeenCalled()
  })

  it('keeps the graded Review while cards are due', async () => {
    listAllDecks.mockResolvedValue([deck('a', 2)])
    renderAt()
    await screen.findByText('Deck a')
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review again' })).not.toBeInTheDocument()
  })

  it('is offered inside the deck too', async () => {
    listAllDecks.mockResolvedValue([deck('a', 0)])
    listCards.mockResolvedValue([card('a1', DAY)])
    renderAt('?deck=a')

    // Inside the deck, not on the binder (which has a Review again of its own).
    await screen.findByRole('button', { name: /All decks/ })
    fireEvent.click(await screen.findByRole('button', { name: 'Review again' }))
    expect(await screen.findByText(PRACTICE_NOTE)).toBeInTheDocument()
    expect(gradeCard).not.toHaveBeenCalled()
  })
})

describe('after a session', () => {
  it('offers the same deck again as practice, and says it changes nothing', async () => {
    listAllDecks.mockResolvedValue([deck('a', 1)])
    listCards.mockResolvedValue([card('a1', -1000)])
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    fireEvent.click(await screen.findByRole('button', { name: /Show answer/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Good/, hidden: true }))
    expect(gradeCard).toHaveBeenCalledTimes(1)

    expect(await screen.findByText(PRACTICE_NOTE)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review again' }))
    expect(await screen.findByLabelText('Card 1 of 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(gradeCard).toHaveBeenCalledTimes(1)
  })
})

describe('on a phone', () => {
  it('has Review again in the deck sheet when nothing is due', async () => {
    restoreDevice = mockPhone()
    listAllDecks.mockResolvedValue([deck('a', 0)])
    listCards.mockResolvedValue([card('a1', DAY)])
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Deck a' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review again' }))
    expect(await screen.findByTestId('phone-practice')).toBeInTheDocument()
    expect(screen.getByText(PRACTICE_NOTE)).toBeInTheDocument()
    expect(gradeCard).not.toHaveBeenCalled()
  })
})
