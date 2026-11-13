// @vitest-environment jsdom
/**
 * Edges of the deck library a student actually reaches:
 *  - a deck with no cards offered "Review", which could only answer "nothing due";
 *  - a subject filter left on a subject whose last deck was deleted hid every
 *    other deck, with the filter control itself gone from the screen;
 *  - Enter twice in "New deck" created the deck twice;
 *  - on a phone an empty deck read "All done".
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { clearCache } from '../../lib/asyncCache'
import type { Deck, Space, Subspace } from '../../api/types'
import { mockPhone } from '../quizzes/phoneTestUtils'

const SUB_A: Subspace = { id: 'sub-a', subject_id: 'space-a', name: 'Attention', last_activity_at: null, counts: {} }
const SUB_B: Subspace = { id: 'sub-b', subject_id: 'space-b', name: 'Autoencoders', last_activity_at: null, counts: {} }
const SPACE_A: Space = { id: 'space-a', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUB_A] }
const SPACE_B: Space = { id: 'space-b', name: 'Deep Learning', tone: 'sky', pinned: false, subspaces: [SUB_B] }

vi.mock('../../lib/useTopicScope', () => ({
  useTopicScope: () => ({ space: SPACE_A, subspace: SUB_A, base: '/fsd/attention', isGlobal: false }),
}))
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: [SPACE_A, SPACE_B] }) }))

const deck = (o: Partial<Deck> = {}): Deck => ({
  id: 'deck-a',
  name: 'Transformer basics',
  total: 10,
  due: 2,
  known_pct: 40,
  subspace_id: SUB_A.id,
  subspace_name: SUB_A.name,
  subject_name: SPACE_A.name,
  ...o,
})
const deckB = (o: Partial<Deck> = {}) =>
  deck({ id: 'deck-b', name: 'Latent space', subspace_id: SUB_B.id, subspace_name: SUB_B.name, subject_name: SPACE_B.name, ...o })

const listAllDecks = vi.fn()
const listCards = vi.fn()
const createDeck = vi.fn()
const deleteDeck = vi.fn()
vi.mock('../../api/flashcards', () => ({
  // The unsaved-grade outbox (see api/flashcards): nothing waiting in these tests.
  gradeWillRetry: () => false,
  onUnsavedGrades: () => () => {},
  unsavedGradeCount: () => 0,
  retryUnsavedGrades: () => Promise.resolve(0),
  renameDeck: vi.fn(),
  listAllDecks: (...a: unknown[]) => listAllDecks(...a),
  listDecks: vi.fn(),
  createDeck: (...a: unknown[]) => createDeck(...a),
  deleteDeck: (...a: unknown[]) => deleteDeck(...a),
  listCards: (...a: unknown[]) => listCards(...a),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  deleteCard: vi.fn(),
  gradeCard: vi.fn(),
  generateCards: vi.fn(),
}))

import { FlashcardsView } from './FlashcardsView'

const renderView = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <FlashcardsView />
      </ToastProvider>
    </MemoryRouter>,
  )

afterEach(() => {
  cleanup()
  clearCache()
  vi.clearAllMocks()
})

describe('a deck with no cards', () => {
  it('offers "Add cards" and opens the deck, rather than a review of nothing', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck({ total: 0, due: 0, known_pct: 0 })])
    listCards.mockResolvedValue([])
    renderView()

    await user.click(await screen.findByRole('button', { name: 'Add cards' }))
    expect(await screen.findByText('This deck is empty')).toBeInTheDocument()
    expect(listCards).toHaveBeenCalledWith('deck-a')
    expect(listCards).not.toHaveBeenCalledWith('deck-a', { dueOnly: true })
  })

  it('reads "Empty", not "All done", on a phone', async () => {
    const restore = mockPhone()
    try {
      listAllDecks.mockResolvedValue([deck({ total: 0, due: 0, known_pct: 0 }), deckB({ due: 0 })])
      renderView()
      const row = (await screen.findByText('Transformer basics')).closest('li') as HTMLElement
      expect(within(row).getByText('Empty')).toBeInTheDocument()
      const other = screen.getByText('Latent space').closest('li') as HTMLElement
      expect(within(other).getByText('All done')).toBeInTheDocument()
    } finally {
      restore()
    }
  })
})

describe('the subject filter', () => {
  it('lets go when the last deck of the filtered subject is deleted', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck(), deckB()])
    deleteDeck.mockResolvedValue(undefined)
    renderView()

    await screen.findByText('Latent space')
    await user.click(screen.getByRole('button', { name: /Filter by subject/ }))
    await user.click(await screen.findByRole('option', { name: 'Deep Learning' }))
    expect(screen.queryByText('Transformer basics')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete Latent space' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))

    // The picker is gone (one subject left), so the filter must be too.
    await waitFor(() => expect(screen.getByText('Transformer basics')).toBeInTheDocument())
    expect(screen.queryByText('No decks yet')).not.toBeInTheDocument()
  })
})

describe('New deck', () => {
  it('creates one deck when Enter is pressed twice', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck()])
    listCards.mockResolvedValue([])
    let finish: (d: Deck) => void = () => {}
    createDeck.mockReturnValue(new Promise<Deck>((resolve) => (finish = resolve)))
    renderView()

    await user.click(await screen.findByText('New deck'))
    await user.type(await screen.findByLabelText('Deck name'), 'Photosynthesis{Enter}{Enter}')
    expect(createDeck).toHaveBeenCalledTimes(1)
    finish(deck({ id: 'deck-new', name: 'Photosynthesis', total: 0, due: 0 }))
    await waitFor(() => expect(screen.getByText('This deck is empty')).toBeInTheDocument())
  })
})
