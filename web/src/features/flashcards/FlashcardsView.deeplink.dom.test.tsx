// @vitest-environment jsdom
/**
 * Links into the Cards page while it is already open: `?deck=` to another
 * deck switches to it, and a second `?review=due` starts another session.
 * And "Add more with AI" writes into the open deck.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { clearCache } from '../../lib/asyncCache'
import type { Deck, Flashcard, Space, Subspace } from '../../api/types'

const SUB: Subspace = { id: 'sub', subject_id: 'sp', name: 'Attention', last_activity_at: null, counts: {} }
const SPACE: Space = { id: 'sp', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUB] }
vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({ space: SPACE, subspace: SUB, base: '/s/fsd/attention' }),
}))
vi.mock('../../lib/useTopicScope', async () => {
  const nav = await import('../../lib/nav')
  return { useTopicScope: () => ({ ...nav.useActiveSubspace(), isGlobal: false }) }
})
vi.mock('../spaces/SpacesProvider', () => ({
  useSpaces: () => ({ spaces: [{ ...SPACE, subspaces: [{ ...SUB, counts: { docs: 2 } }] }], refresh: vi.fn() }),
}))

const D1 = '11111111-1111-4111-8111-111111111111'
const D2 = '22222222-2222-4222-8222-222222222222'
const deck = (id: string, name: string, o: Partial<Deck> = {}): Deck => ({
  id, name, total: 1, due: 1, known_pct: 0, subspace_id: SUB.id, subspace_name: SUB.name, subject_name: SPACE.name, ...o,
})
const card = (id: string, deckId: string, front: string): Flashcard => ({
  id, deck_id: deckId, front, back: 'An answer.', source: null, ease: 2.5, interval_days: 0, reps: 0,
  due_at: '2020-01-01T00:00:00Z', stability: null, difficulty: null, last_review_at: null,
})

const listAllDecks = vi.fn()
const listCards = vi.fn()
const extendDeck = vi.fn()
vi.mock('../../api/flashcards', () => ({
  gradeWillRetry: () => false,
  onUnsavedGrades: () => () => {},
  unsavedGradeCount: () => 0,
  retryUnsavedGrades: () => Promise.resolve(0),
  listAllDecks: (...a: unknown[]) => listAllDecks(...a),
  listCards: (...a: unknown[]) => listCards(...a),
  extendDeck: (...a: unknown[]) => extendDeck(...a),
  renameDeck: vi.fn(),
  deleteDeck: vi.fn(),
  listDecks: vi.fn(),
  createDeck: vi.fn(),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  deleteCard: vi.fn(),
  generateCards: vi.fn(),
  gradeCard: vi.fn(),
}))
vi.mock('../../api/notes', () => ({ listNotes: () => Promise.resolve([]) }))

import { FlashcardsView } from './FlashcardsView'

function Go({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate()
  return <button onClick={() => navigate(to)}>{label}</button>
}
const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <FlashcardsView />
                <Go to={`/?deck=${D2}`} label="link to deck 2" />
                <Go to="/?review=due" label="link to due review" />
              </>
            }
          />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )

afterEach(() => {
  cleanup()
  clearCache()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('links into an open Cards page', () => {
  it('a link to another deck switches to it', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck(D1, 'Queries'), deck(D2, 'Keys')])
    listCards.mockImplementation((id: string) =>
      Promise.resolve([card(`c-${id}`, id, id === D1 ? 'What is a query vector?' : 'What is a key vector?')]),
    )
    renderAt(`/?deck=${D1}`)
    expect(await screen.findByText('What is a query vector?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'link to deck 2' }))
    expect(await screen.findByText('What is a key vector?')).toBeInTheDocument()
    expect(screen.queryByText('What is a query vector?')).not.toBeInTheDocument()
  })

  it('a second "review due" link starts another session', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck(D1, 'Queries')])
    listCards.mockResolvedValue([])
    renderAt('/?review=due')
    await waitFor(() => expect(listCards).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'link to due review' }))
    await waitFor(() => expect(listCards).toHaveBeenCalledTimes(2))
  })
})

describe('add more cards', () => {
  it('writes into the open deck and lists the new cards', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck(D1, 'Queries')])
    listCards.mockResolvedValue([card('c1', D1, 'What is a query vector?')])
    extendDeck.mockResolvedValue([card('c2', D1, 'Why scale the dot product?')])
    renderAt(`/?deck=${D1}`)
    await screen.findByText('What is a query vector?')
    await user.click(screen.getByRole('button', { name: /Add more with AI/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Add 5 cards/ }))
    expect(extendDeck).toHaveBeenCalledWith(D1, { count: 5, source: 'files' })
    expect(await screen.findByText('Why scale the dot product?')).toBeInTheDocument()
    expect(await screen.findByText(/Added 1 of 5/)).toBeInTheDocument()
  })
})
