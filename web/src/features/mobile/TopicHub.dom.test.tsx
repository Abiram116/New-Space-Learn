// @vitest-environment jsdom
/**
 * The topic hub's one big button says "Start review". With a single deck due
 * it has to start that review, not open the deck's card list for a second tap.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearCache } from '../../lib/asyncCache'
import type { Deck, Space, Subspace } from '../../api/types'

const SUB: Subspace = { id: 'sub-a', subject_id: 'space-a', name: 'Attention', last_activity_at: null, counts: { cards: 12 } }
const SPACE: Space = { id: 'space-a', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUB] }
vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({ space: SPACE, subspace: SUB, base: '/fsd/attention' }),
}))

const listAllDecks = vi.fn()
vi.mock('../../api/flashcards', () => ({ listAllDecks: (...a: unknown[]) => listAllDecks(...a) }))

import { TopicHub } from './TopicHub'

const deck = (o: Partial<Deck>): Deck => ({ id: 'd1', name: 'Basics', total: 12, due: 4, known_pct: 50, subspace_id: SUB.id, ...o })
const renderHub = () =>
  render(
    <MemoryRouter>
      <TopicHub />
    </MemoryRouter>,
  )

afterEach(() => {
  cleanup()
  clearCache()
  vi.clearAllMocks()
})

describe('topic hub: Start review', () => {
  it('starts the review of the one deck that has cards due', async () => {
    listAllDecks.mockResolvedValue([deck({}), deck({ id: 'd2', name: 'Other topic', subspace_id: 'elsewhere' })])
    renderHub()
    const link = await screen.findByTestId('review-due')
    expect(link).toHaveTextContent('Review 4 due cards')
    expect(link).toHaveAttribute('href', '/fsd/attention/flashcards?deck=d1&review=deck')
  })

  it('opens the Cards screen when several decks have cards due', async () => {
    listAllDecks.mockResolvedValue([deck({}), deck({ id: 'd2', name: 'More', due: 3 })])
    renderHub()
    const link = await screen.findByTestId('review-due')
    expect(link).toHaveTextContent('Review 7 due cards')
    expect(link).toHaveAttribute('href', '/fsd/attention/flashcards')
  })
})
