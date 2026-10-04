// @vitest-environment jsdom
/**
 * `?deck=<id>&review=deck&from=chat` — the sidebar's "Review" on one deck.
 * Starts that deck's review on the full page, and when the session is over,
 * "Back to chat" returns to the topic's chat with the Cards panel open.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { AssessmentProvider } from '../../lib/assessment'
import { clearCache } from '../../lib/asyncCache'
import type { Deck, Flashcard, Space, Subspace } from '../../api/types'

const SUB: Subspace = { id: 'sub', subject_id: 'sp', name: 'Attention', last_activity_at: null, counts: {} }
const SPACE: Space = { id: 'sp', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUB] }
const BASE = '/fsd/attention'
const DECK_ID = '0b6a7a52-6a0f-4d0e-9f77-3a1d4c1b2e10'

vi.mock('../../lib/useTopicScope', () => ({ useTopicScope: () => ({ space: SPACE, subspace: SUB, base: BASE, isGlobal: false }) }))
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: [SPACE] }) }))
vi.mock('../../components/celebrate', () => ({
  AmbienceField: () => null,
  celebrate: vi.fn(),
  noteCardGraded: vi.fn(),
  useAmbienceField: () => ({ api: { progress: vi.fn(), pulse: vi.fn() }, nodes: { current: {} } }),
  useStudySession: () => {},
}))

const deck: Deck = { id: DECK_ID, name: 'Terms', total: 1, due: 1, known_pct: 0, subspace_id: SUB.id, subspace_name: SUB.name, subject_name: SPACE.name }
const card: Flashcard = {
  id: 'c1', deck_id: DECK_ID, front: 'front 1', back: 'back 1', source: null, ease: 2.5, interval_days: 0, reps: 0,
  due_at: new Date(Date.now() - 1000).toISOString(), stability: null, difficulty: null, last_review_at: null,
}

vi.mock('../../api/flashcards', () => ({
  listAllDecks: () => Promise.resolve([deck]),
  listDecks: vi.fn(),
  createDeck: vi.fn(),
  deleteDeck: vi.fn(),
  listCards: () => Promise.resolve([card]),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  deleteCard: vi.fn(),
  generateCards: vi.fn(),
  gradeCard: () => Promise.resolve(),
}))

import { FlashcardsView } from './FlashcardsView'

function Where() {
  const l = useLocation()
  return (
    <>
      <span data-testid="where">{l.pathname + l.search}</span>
      <span data-testid="state">{JSON.stringify(l.state)}</span>
    </>
  )
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <AssessmentProvider>
          <FlashcardsView />
          <Where />
        </AssessmentProvider>
      </ToastProvider>
    </MemoryRouter>,
  )

afterEach(() => {
  cleanup()
  clearCache()
})

describe('reviewing a deck opened from the chat sidebar', () => {
  it('starts the review at once, and at the end "Back to chat" returns to the chat with the Cards panel open', async () => {
    renderAt(`${BASE}/flashcards?deck=${DECK_ID}&review=deck&from=chat`)

    // The review starts by itself: no stop at the binder or the deck page.
    fireEvent.click(await screen.findByRole('button', { name: /Show answer/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Good/, hidden: true }))

    const back = await screen.findByRole('button', { name: /Back to chat/ })
    fireEvent.click(back)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(BASE))
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({ dockPanel: 'flashcards' })
  })

  it('opened from the binder instead, the way out is "Done" and stays on the cards page', async () => {
    renderAt(`${BASE}/flashcards?deck=${DECK_ID}&review=deck`)
    fireEvent.click(await screen.findByRole('button', { name: /Show answer/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Good/, hidden: true }))
    expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Back to chat/ })).not.toBeInTheDocument()
  })
})
