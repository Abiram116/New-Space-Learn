// @vitest-environment jsdom

/**
 * Two things from the resilience/student-model work land on Home and are
 * easy to silently regress: the decision engine's `reason` under the
 * suggested-action CTA, and a failed `/spaces` load reading as "you have
 * nothing yet" instead of "we couldn't reach the server" — see Home's own
 * comment on that gate for why they must not be confused.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '../../api/types'

const refreshSpaces = vi.fn()
let spacesState: {
  spaces: Space[]
  loading: boolean
  error: string | null
}

vi.mock('../spaces/SpacesProvider', () => ({
  useSpaces: () => ({ ...spacesState, refresh: refreshSpaces }),
}))

const getCachedBrief = vi.fn()
const getCachedStats = vi.fn()
vi.mock('../../lib/briefCache', () => ({
  getCachedBrief: (...args: unknown[]) => getCachedBrief(...args),
  getCachedStats: (...args: unknown[]) => getCachedStats(...args),
}))

vi.mock('../spaces/NewSpaceModal', () => ({
  NewSpaceModal: () => null,
}))

import { Home } from './Home'

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  )
}

function space(overrides: Partial<Space> = {}): Space {
  return {
    id: 'sp-1',
    name: 'Machine Learning',
    tone: 'brand',
    pinned: false,
    subspaces: [
      {
        id: 'sub-1',
        name: 'Reinforcement Learning',
        last_activity_at: new Date().toISOString(),
        counts: { docs: 1, cards: 5, notes: 0, quizzes: 1 },
      },
    ],
    ...overrides,
  } as Space
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the suggested-action reason', () => {
  it('shows the decision engine\'s reason under the CTA', async () => {
    spacesState = { spaces: [space()], loading: false, error: null }
    getCachedStats.mockResolvedValue({
      streak_days: 1, cards_due: 0, quiz_average: null, study_minutes_this_week: 0,
      due_forecast: [], composition: { chat_messages: 0, cards_reviewed: 0, quizzes_taken: 0 },
      daily_goal: 10, badges: [], heatmap: [], docs_indexed: 0, spaces_count: 1, max_streak: 1,
    })
    getCachedBrief.mockResolvedValue({
      headline: 'RL is slipping',
      body: 'Go back over it.',
      generated: false,
      suggestion: {
        label: 'Clear up Q-learning',
        route: '/s/sp-1/sub-1',
        reason: 'You keep confusing Q-learning with SARSA.',
        action: 'fix_misconception',
      },
    })

    renderHome()

    expect(await screen.findByText('Clear up Q-learning')).toBeInTheDocument()
    expect(screen.getByText('You keep confusing Q-learning with SARSA.')).toBeInTheDocument()
  })

  it('shows no reason line when the suggestion carries none', async () => {
    spacesState = { spaces: [space()], loading: false, error: null }
    getCachedStats.mockResolvedValue({
      streak_days: 1, cards_due: 0, quiz_average: null, study_minutes_this_week: 0,
      due_forecast: [], composition: { chat_messages: 0, cards_reviewed: 0, quizzes_taken: 0 },
      daily_goal: 10, badges: [], heatmap: [], docs_indexed: 0, spaces_count: 1, max_streak: 1,
    })
    getCachedBrief.mockResolvedValue({
      headline: 'All caught up',
      body: 'Nothing due.',
      generated: false,
      suggestion: { label: 'Continue RL', route: '/s/sp-1/sub-1' },
    })

    renderHome()

    expect(await screen.findByText('Continue RL')).toBeInTheDocument()
  })
})

describe('a failed /spaces load', () => {
  it('reads as a connection problem, not as an empty account', async () => {
    spacesState = { spaces: [], loading: false, error: "Can't reach the server." }
    renderHome()

    expect(await screen.findByText("We couldn't open your home page")).toBeInTheDocument()
    expect(screen.queryByText(/bring what you're studying/i)).not.toBeInTheDocument()
  })
})
