// @vitest-environment jsdom
/**
 * The 2026-08 UX audit found Cards was restricted to whichever topic
 * happened to be open — decks from every other subject were invisible
 * unless you navigated to each one individually. This mounts the real
 * `FlashcardsView` and proves the fix: it calls the account-wide listing,
 * not the per-subspace one, and shows a Subject · Topic caption + subject
 * filter once decks span more than one subject.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Deck, Space, Subspace } from '../../api/types'

const SUBSPACE_A: Subspace = {
  id: 'subspace-a',
  subject_id: 'space-a',
  name: 'Attention',
  last_activity_at: null,
  counts: {},
}
const SUBSPACE_B: Subspace = {
  id: 'subspace-b',
  subject_id: 'space-b',
  name: 'Autoencoders',
  last_activity_at: null,
  counts: {},
}
const SPACE_A: Space = { id: 'space-a', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUBSPACE_A] }
const SPACE_B: Space = { id: 'space-b', name: 'Deep Learning', tone: 'sky', pinned: false, subspaces: [SUBSPACE_B] }

vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({ space: SPACE_A, subspace: SUBSPACE_A, base: '/spaces/space-a/subspace-a' }),
}))

vi.mock('../spaces/SpacesProvider', () => ({
  useSpaces: () => ({ spaces: [SPACE_A, SPACE_B] }),
}))

function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Transformer basics',
    total: 10,
    due: 2,
    known_pct: 40,
    subspace_id: SUBSPACE_A.id,
    subspace_name: SUBSPACE_A.name,
    subject_name: SPACE_A.name,
    ...overrides,
  }
}

const listAllDecks = vi.fn()
const listDecks = vi.fn()
const listCards = vi.fn()
const createDeck = vi.fn()
const generateCards = vi.fn()

vi.mock('../../api/flashcards', () => ({
  listAllDecks: (...args: unknown[]) => listAllDecks(...args),
  listDecks: (...args: unknown[]) => listDecks(...args),
  createDeck: (...args: unknown[]) => createDeck(...args),
  deleteDeck: vi.fn(),
  listCards: (...args: unknown[]) => listCards(...args),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  deleteCard: vi.fn(),
  generateCards: (...args: unknown[]) => generateCards(...args),
}))

import { FlashcardsView } from './FlashcardsView'

function renderView(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ToastProvider>
        <FlashcardsView />
      </ToastProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Cards is a global library', () => {
  it('calls the account-wide listing, not the per-subspace one', async () => {
    listAllDecks.mockResolvedValue([deck()])
    renderView()

    await waitFor(() => expect(listAllDecks).toHaveBeenCalledTimes(1))
    expect(listDecks).not.toHaveBeenCalled()
  })

  it('shows a deck from a different subject than the one currently open', async () => {
    listAllDecks.mockResolvedValue([
      deck({ id: 'deck-b', name: 'Latent space', subspace_id: SUBSPACE_B.id, subspace_name: SUBSPACE_B.name, subject_name: SPACE_B.name }),
    ])
    renderView()

    // The currently-open subspace is Attention (space-a) — this deck belongs
    // to Autoencoders (space-b) and must still show up unfiltered.
    await waitFor(() => expect(screen.getByText('Latent space')).toBeInTheDocument())
    expect(screen.getByText(/Deep Learning/)).toBeInTheDocument()
  })

  it('offers a subject filter once decks span more than one subject, and narrows the grid', async () => {
    listAllDecks.mockResolvedValue([
      deck({ id: 'deck-a', name: 'FSD deck' }),
      deck({ id: 'deck-b', name: 'DL deck', subspace_id: SUBSPACE_B.id, subspace_name: SUBSPACE_B.name, subject_name: SPACE_B.name }),
    ])
    const user = userEvent.setup()
    renderView()

    await waitFor(() => expect(screen.getByText('FSD deck')).toBeInTheDocument())
    const select = screen.getByRole('button', { name: 'Filter by subject' })
    expect(select).toBeInTheDocument()

    await user.click(select)
    await user.click(screen.getByRole('option', { name: 'Deep Learning' }))
    expect(screen.queryByText('FSD deck')).not.toBeInTheDocument()
    expect(screen.getByText('DL deck')).toBeInTheDocument()
  })

  it('hides the subject filter when everything belongs to one subject', async () => {
    listAllDecks.mockResolvedValue([deck({ id: 'd1' }), deck({ id: 'd2', name: 'Second deck' })])
    renderView()

    await waitFor(() => expect(screen.getByText('Second deck')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Filter by subject' })).not.toBeInTheDocument()
  })
})

describe('a specific deck has its own URL, like Notes and Quizzes already do', () => {
  // Regression: opening a deck by clicking a tile put no state in the URL —
  // a refresh while reviewing or browsing one deck's cards silently bounced
  // back to the plain grid, the "user refreshes halfway through" failure
  // mode this audit specifically asks about.
  it('deep-links straight into a deck via ?deck=, without needing the grid first', async () => {
    listAllDecks.mockResolvedValue([deck({ id: 'deck-1', name: 'Transformer basics' })])
    listCards.mockResolvedValue([])
    renderView(['/?deck=deck-1'])

    // "All decks" only renders in deck-detail mode — its presence, plus the
    // deck's own name landing in the page title rather than a grid tile,
    // confirms this opened straight into the deck, not the grid.
    expect(await screen.findByRole('button', { name: /All decks/ })).toBeInTheDocument()
    await waitFor(() => expect(listCards).toHaveBeenCalledWith('deck-1'))
    expect(screen.getByRole('heading', { name: 'Transformer basics' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate a deck/ })).not.toBeInTheDocument()
  })

  it('going back to the grid re-fetches the deck list', async () => {
    listAllDecks.mockResolvedValue([deck({ id: 'deck-1', name: 'Transformer basics' })])
    listCards.mockResolvedValue([])
    const user = userEvent.setup()
    renderView(['/?deck=deck-1'])

    await screen.findByRole('button', { name: /All decks/ })
    listAllDecks.mockClear()
    await user.click(screen.getByRole('button', { name: /All decks/ }))

    await waitFor(() => expect(listAllDecks).toHaveBeenCalled())
    expect(await screen.findByText('Transformer basics')).toBeInTheDocument()
  })
})

describe('generating cards lands you on the deck they went into', () => {
  // Regression: both the dedicated "Generate" button and chat's "Make cards
  // from this chat" left you on the plain deck grid after writing cards —
  // Notes and Quizzes both already open what they just generated (`?n=`,
  // `?q=`); Cards was the one path that dropped you somewhere you'd have to
  // go hunting for the result from.
  it('opens the newly generated deck instead of staying on the grid', async () => {
    listAllDecks.mockResolvedValue([])
    generateCards.mockResolvedValue([
      { id: 'c1', deck_id: 'deck-new', front: 'Q', back: 'A', source: null, ease: 2.5, interval_days: 1, reps: 0, due_at: new Date().toISOString() },
    ])
    listCards.mockResolvedValue([])
    const user = userEvent.setup()
    renderView()

    await waitFor(() => expect(screen.getByText('No decks yet')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Generate a deck/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Generate a deck' })
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }))

    await waitFor(() => expect(listCards).toHaveBeenCalledWith('deck-new'))
    expect(await screen.findByRole('button', { name: /All decks/ })).toBeInTheDocument()
  })
})
