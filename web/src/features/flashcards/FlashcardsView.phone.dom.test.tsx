// @vitest-environment jsdom
/**
 * The deck library and a deck's contents on a phone: rows not tiles, one
 * pinned primary action, and every secondary action behind a ⋯ sheet — never
 * hover-only.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Deck, Flashcard, Space, Subspace } from '../../api/types'
import { mockPhone } from '../quizzes/phoneTestUtils'

const SUB: Subspace = { id: 'sub', subject_id: 'sp', name: 'Attention', last_activity_at: null, counts: {} }
const SPACE: Space = { id: 'sp', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUB] }
vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({ space: SPACE, subspace: SUB, base: '/spaces/sp/sub' }),
}))
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: [SPACE] }) }))

const deck = (o: Partial<Deck> = {}): Deck => ({
  id: 'd1',
  name: 'Transformer basics',
  total: 10,
  due: 12,
  known_pct: 40,
  subspace_id: SUB.id,
  subspace_name: SUB.name,
  subject_name: SPACE.name,
  ...o,
})
const flash = (o: Partial<Flashcard>): Flashcard => ({
  id: 'c1',
  deck_id: 'd1',
  front: 'What is Q?',
  back: 'The query vector.',
  source: null,
  ease: 2.5,
  interval_days: 0,
  reps: 0,
  due_at: new Date(Date.now() - 1000).toISOString(),
  stability: null,
  difficulty: null,
  last_review_at: null,
  ...o,
})

const listAllDecks = vi.fn()
const listCards = vi.fn()
const deleteDeck = vi.fn().mockResolvedValue(undefined)
vi.mock('../../api/flashcards', () => ({
  listAllDecks: (...a: unknown[]) => listAllDecks(...a),
  listDecks: vi.fn(),
  createDeck: vi.fn(),
  deleteDeck: (...a: unknown[]) => deleteDeck(...a),
  listCards: (...a: unknown[]) => listCards(...a),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  deleteCard: vi.fn(),
  generateCards: vi.fn(),
  gradeCard: vi.fn(),
}))

import { FlashcardsView } from './FlashcardsView'

const renderView = (entry = '/') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <FlashcardsView />
      </ToastProvider>
    </MemoryRouter>,
  )

let restore: () => void
beforeEach(() => {
  restore = mockPhone()
})
afterEach(() => {
  cleanup()
  restore()
  vi.clearAllMocks()
})

describe('phone deck list', () => {
  it('shows rows with a due badge and pins "Review N due" as the primary action', async () => {
    listAllDecks.mockResolvedValue([deck()])
    listCards.mockResolvedValue([flash({})])
    renderView()
    await waitFor(() => expect(screen.getByText('Transformer basics')).toBeInTheDocument())
    expect(screen.getByText('12 due')).toBeInTheDocument()
    const bar = document.querySelector('[data-sticky-action-bar]') as HTMLElement
    await userEvent.setup().click(within(bar).getByRole('button', { name: /Review 12 due/ }))
    await waitFor(() => expect(listCards).toHaveBeenCalledWith('d1', { dueOnly: true }))
  })

  it('delete lives behind the row ⋯ sheet and asks before deleting', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck()])
    renderView()
    await waitFor(() => expect(screen.getByText('Transformer basics')).toBeInTheDocument())
    // Not a hover-only control: it is a plain, always-present button.
    await user.click(screen.getByRole('button', { name: 'More actions for Transformer basics' }))
    await user.click(await screen.findByRole('button', { name: 'Delete deck' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteDeck).toHaveBeenCalledWith('d1'))
  })

  it('the empty state offers both ways in, big', async () => {
    listAllDecks.mockResolvedValue([])
    renderView()
    await waitFor(() => expect(screen.getByText('No decks yet')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Generate a deck/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start a deck' })).toBeInTheDocument()
  })
})

describe('phone deck detail', () => {
  it('lists cards as rows; Edit/Delete are in the ⋯ sheet; Review is pinned', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck()])
    listCards.mockResolvedValue([flash({})])
    renderView('/?deck=d1')
    await waitFor(() => expect(screen.getByText('What is Q?')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Add a card/ })).toBeInTheDocument()
    expect(document.querySelector('[data-sticky-action-bar]')).toHaveTextContent('Review 1 due')
    await user.click(screen.getByRole('button', { name: 'Card actions' }))
    expect(await screen.findByRole('button', { name: 'Edit card' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete card' })).toBeInTheDocument()
  })
})
