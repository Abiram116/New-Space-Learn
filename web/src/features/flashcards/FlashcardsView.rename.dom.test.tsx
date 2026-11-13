// @vitest-environment jsdom
/**
 * A deck can be renamed: from its tile, from its own screen, and on a phone
 * from the row's sheet and the deck screen. And an empty Cards screen on a
 * topic with no file yet sends the student to add one, on desktop as on phone.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { clearCache } from '../../lib/asyncCache'
import type { Deck, Space, Subspace } from '../../api/types'
import { mockPhone } from '../quizzes/phoneTestUtils'

const topic = vi.hoisted(() => ({ docs: 3 }))
const SUB: Subspace = { id: 'sub', subject_id: 'sp', name: 'Attention', last_activity_at: null, counts: {} }
const SPACE: Space = { id: 'sp', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUB] }
vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({ space: SPACE, subspace: SUB, base: '/s/fsd/attention' }),
}))
vi.mock('../../lib/useTopicScope', async () => {
  const nav = await import('../../lib/nav')
  return { useTopicScope: () => ({ ...nav.useActiveSubspace(), isGlobal: false }) }
})
const refreshSpaces = vi.fn()
vi.mock('../spaces/SpacesProvider', () => ({
  useSpaces: () => ({
    spaces: [{ ...SPACE, subspaces: [{ ...SUB, counts: { docs: topic.docs } }] }],
    refresh: refreshSpaces,
  }),
}))

const deck = (o: Partial<Deck> = {}): Deck => ({
  id: 'd1',
  name: 'Transformer basics',
  total: 4,
  due: 0,
  known_pct: 50,
  subspace_id: SUB.id,
  subspace_name: SUB.name,
  subject_name: SPACE.name,
  ...o,
})

const listAllDecks = vi.fn()
const renameDeck = vi.fn()
const deleteDeck = vi.fn()
vi.mock('../../api/flashcards', () => ({
  gradeWillRetry: () => false,
  onUnsavedGrades: () => () => {},
  unsavedGradeCount: () => 0,
  retryUnsavedGrades: () => Promise.resolve(0),
  listAllDecks: (...a: unknown[]) => listAllDecks(...a),
  renameDeck: (...a: unknown[]) => renameDeck(...a),
  deleteDeck: (...a: unknown[]) => deleteDeck(...a),
  listDecks: vi.fn(),
  createDeck: vi.fn(),
  listCards: () => Promise.resolve([]),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  deleteCard: vi.fn(),
  generateCards: vi.fn(),
  gradeCard: vi.fn(),
}))

import { FlashcardsView } from './FlashcardsView'

function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{pathname + search}</p>
}
const renderView = (entry = '/') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<FlashcardsView />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )

let restorePhone: (() => void) | null = null
afterEach(() => {
  cleanup()
  clearCache()
  restorePhone?.()
  restorePhone = null
  topic.docs = 3
  vi.clearAllMocks()
})

async function typeNewName(user: ReturnType<typeof userEvent.setup>, name: string) {
  const field = await screen.findByLabelText('Deck name')
  expect(field).toHaveValue('Transformer basics')
  await user.clear(field)
  await user.type(field, name)
  await user.click(screen.getByRole('button', { name: 'Save' }))
}

describe('renaming a deck', () => {
  it('from its tile: the new name replaces the old one in the list', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck()])
    renameDeck.mockResolvedValue(deck({ name: 'Attention heads', subspace_name: null, subject_name: null }))
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Rename Transformer basics' }))
    await typeNewName(user, '  Attention heads ')

    await waitFor(() => expect(renameDeck).toHaveBeenCalledWith('d1', 'Attention heads'))
    expect(await screen.findByText('Attention heads')).toBeInTheDocument()
    expect(screen.queryByText('Transformer basics')).toBeNull()
    // The row keeps where the deck lives; only its name changed.
    expect(screen.getByText(/FSD · Attention$/)).toBeInTheDocument()
  })

  it('from the deck screen', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck()])
    renameDeck.mockResolvedValue(deck({ name: 'Attention heads' }))
    renderView('/?deck=d1')
    // The header is drawn once while the cards load and again when they have; press
    // the button that is on screen at the time, not one from the frame before.
    await screen.findByRole('button', { name: /Rename/ })
    await waitFor(async () => {
      await user.click(screen.getByRole('button', { name: /Rename/ }))
      expect(screen.getByLabelText('Deck name')).toBeInTheDocument()
    })
    await typeNewName(user, 'Attention heads')

    await waitFor(() => expect(renameDeck).toHaveBeenCalledWith('d1', 'Attention heads'))
    expect(await screen.findByRole('heading', { name: 'Attention heads' })).toBeInTheDocument()
  })

  it('keeps the dialog open with the typed name when saving fails', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck()])
    renameDeck.mockRejectedValue(new Error('The name could not be saved.'))
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Rename Transformer basics' }))
    await typeNewName(user, 'Attention heads')

    expect(await screen.findByText('The name could not be saved.')).toBeInTheDocument()
    expect(screen.getByLabelText('Deck name')).toHaveValue('Attention heads')
    expect(screen.getAllByText('Transformer basics').length).toBeGreaterThan(0)
  })

  it('sends nothing when the name is unchanged or empty', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck()])
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Rename Transformer basics' }))
    const field = await screen.findByLabelText('Deck name')
    await user.clear(field)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(field, 'Transformer basics')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByLabelText('Deck name')).toBeNull())
    expect(renameDeck).not.toHaveBeenCalled()
  })

  it('on a phone: from the row sheet, and from the deck screen', async () => {
    restorePhone = mockPhone()
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck()])
    renameDeck.mockResolvedValue(deck({ name: 'Attention heads' }))
    const list = renderView()
    await user.click(await screen.findByRole('button', { name: 'More actions for Transformer basics' }))
    await user.click(await screen.findByRole('button', { name: 'Rename deck' }))
    await typeNewName(user, 'Attention heads')
    await waitFor(() => expect(renameDeck).toHaveBeenCalledWith('d1', 'Attention heads'))
    expect(await screen.findByText('Attention heads')).toBeInTheDocument()
    list.unmount()
    clearCache()

    renderView('/?deck=d1')
    await user.click(await screen.findByRole('button', { name: 'Rename deck' }))
    expect(await screen.findByLabelText('Deck name')).toHaveValue('Transformer basics')
  })
})

describe('deleting a deck', () => {
  it('refreshes the topic counts shown elsewhere', async () => {
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([deck()])
    deleteDeck.mockResolvedValue({ ok: true })
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Delete Transformer basics' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(refreshSpaces).toHaveBeenCalled())
  })
})

describe('empty Cards on desktop', () => {
  it('with no file in the topic: says so, and the button goes to add one', async () => {
    topic.docs = 0
    const user = userEvent.setup()
    listAllDecks.mockResolvedValue([])
    renderView()
    expect(await screen.findByText(/Attention has no material yet\. Add a file/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate a deck/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Start a deck' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Add material/ }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/s/fsd/attention/docs?add=1')
  })

  it('with a file in the topic it still offers to generate', async () => {
    listAllDecks.mockResolvedValue([])
    renderView()
    expect(await screen.findByRole('button', { name: /Generate a deck/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add material/ })).toBeNull()
  })
})
