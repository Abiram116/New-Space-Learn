// @vitest-environment jsdom
/**
 * `/flashcards?review=due&limit=N`: Today's "start with 10 of your 46 cards"
 * and the session-length cap. Starts a review of the due cards across decks,
 * capped at N; when the session ends with more still due, the summary offers
 * "Keep going: N more" — the next batch, never the whole backlog at once.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { clearCache } from '../../lib/asyncCache'
import type { Deck, Flashcard, Space, Subspace } from '../../api/types'

const SUB: Subspace = { id: 'sub', subject_id: 'sp', name: 'Attention', last_activity_at: null, counts: {} }
const SPACE: Space = { id: 'sp', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUB] }
vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({ space: SPACE, subspace: SUB, base: '/spaces/sp/sub' }),
}))
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
  total: 10,
  due,
  known_pct: 10,
  subspace_id: SUB.id,
  subspace_name: SUB.name,
  subject_name: SPACE.name,
})
const card = (id: string, deckId: string): Flashcard => ({
  id,
  deck_id: deckId,
  front: `front ${id}`,
  back: `back ${id}`,
  source: null,
  ease: 2.5,
  interval_days: 0,
  reps: 0,
  due_at: new Date(Date.now() - 1000).toISOString(),
  stability: null,
  difficulty: null,
  last_review_at: null,
})
const CARDS: Record<string, Flashcard[]> = {
  a: [card('a1', 'a'), card('a2', 'a'), card('a3', 'a')],
  b: [card('b1', 'b'), card('b2', 'b')],
}

const listAllDecks = vi.fn()
const listCards = vi.fn((deckId: string) => Promise.resolve(CARDS[deckId] ?? []))
const gradeCard = vi.fn(() => Promise.resolve())
vi.mock('../../api/flashcards', () => ({
  listAllDecks: (...a: unknown[]) => listAllDecks(...a),
  listDecks: vi.fn(),
  createDeck: vi.fn(),
  deleteDeck: vi.fn(),
  listCards: (...a: [string]) => listCards(...a),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  deleteCard: vi.fn(),
  generateCards: vi.fn(),
  gradeCard: (...a: unknown[]) => (gradeCard as (...x: unknown[]) => unknown)(...a),
}))

import { FlashcardsView } from './FlashcardsView'

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <ToastProvider>
        <FlashcardsView />
      </ToastProvider>
    </MemoryRouter>,
  )

const gradeGood = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Show answer/ }))
  fireEvent.click(await screen.findByRole('button', { name: /^Good/, hidden: true }))
}

afterEach(() => {
  cleanup()
  // useAsync keeps a module-level cache; each test brings its own decks.
  clearCache()
  vi.clearAllMocks()
})

describe('?review=due&limit=N', () => {
  it('starts a review of the due cards, capped at N, across decks', async () => {
    listAllDecks.mockResolvedValue([deck('a', 3), deck('b', 2)])
    renderAt('?review=due&limit=4')
    expect(await screen.findByLabelText('Card 1 of 4')).toBeInTheDocument()
    expect(listCards).toHaveBeenCalledWith('a', { dueOnly: true })
    expect(listCards).toHaveBeenCalledWith('b', { dueOnly: true })
  })

  it('stops fetching once the batch is full', async () => {
    listAllDecks.mockResolvedValue([deck('a', 3), deck('b', 2)])
    renderAt('?review=due&limit=2')
    expect(await screen.findByLabelText('Card 1 of 2')).toBeInTheDocument()
    expect(listCards).toHaveBeenCalledTimes(1)
  })

  it('with no limit it reviews everything that is due', async () => {
    listAllDecks.mockResolvedValue([deck('a', 3), deck('b', 2)])
    renderAt('?review=due')
    expect(await screen.findByLabelText('Card 1 of 5')).toBeInTheDocument()
  })

  it('offers "Keep going: N more" — the next batch, without the cards just done', async () => {
    listAllDecks.mockResolvedValue([deck('a', 3), deck('b', 2)])
    renderAt('?review=due&limit=4')
    for (let i = 1; i <= 4; i++) {
      expect(await screen.findByLabelText(`Card ${i} of 4`)).toBeInTheDocument()
      await gradeGood()
    }
    const more = await screen.findByRole('button', { name: 'Keep going: 1 more' })
    listCards.mockClear()
    fireEvent.click(more)
    // Only the card that was left behind — a1..b1 were already reviewed.
    expect(await screen.findByLabelText('Card 1 of 1')).toBeInTheDocument()
    expect(screen.getByText('front b2')).toBeInTheDocument()
  })

  it('an uncapped session that finishes everything offers no Keep going', async () => {
    listAllDecks.mockResolvedValue([deck('b', 2)])
    renderAt('?review=due')
    for (let i = 1; i <= 2; i++) {
      expect(await screen.findByLabelText(`Card ${i} of 2`)).toBeInTheDocument()
      await gradeGood()
    }
    await waitFor(() => expect(screen.getByText('Session complete')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Keep going/ })).not.toBeInTheDocument()
  })

  it('nothing due: stays on the deck list', async () => {
    listAllDecks.mockResolvedValue([deck('a', 0)])
    renderAt('?review=due&limit=10')
    expect(await screen.findByText(/Nothing due right now/)).toBeInTheDocument()
    expect(screen.getByText('Deck a')).toBeInTheDocument()
  })
})
