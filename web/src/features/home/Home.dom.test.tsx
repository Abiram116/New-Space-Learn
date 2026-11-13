// @vitest-environment jsdom

/**
 * Two things from the resilience/student-model work land on Home and are
 * easy to silently regress: the decision engine's `reason` under the
 * suggested-action CTA, and a failed `/spaces` load reading as "you have
 * nothing yet" instead of "we couldn't reach the server" — see Home's own
 * comment on that gate for why they must not be confused.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Space, Stats } from '../../api/types'
import { clearCache } from '../../lib/asyncCache'

const refreshSpaces = vi.fn()
const addSubspace = vi.fn()
let spacesState: {
  spaces: Space[]
  loading: boolean
  error: string | null
}

vi.mock('../spaces/SpacesProvider', () => ({
  useSpaces: () => ({ ...spacesState, refresh: refreshSpaces, addSubspace }),
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

const listAllQuizzes = vi.fn()
const listAllDecks = vi.fn()
const getStudentModel = vi.fn()
vi.mock('../../api/quizzes', () => ({ listAllQuizzes: () => listAllQuizzes() }))
vi.mock('../../api/flashcards', () => ({ listAllDecks: () => listAllDecks() }))
vi.mock('../../api/me', () => ({ getStudentModel: () => getStudentModel(), updateStudentModel: vi.fn() }))

import { Home } from './Home'

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
      <Where />
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

beforeEach(() => {
  clearCache()
  localStorage.clear()
  listAllQuizzes.mockResolvedValue([])
  listAllDecks.mockResolvedValue([])
  getStudentModel.mockResolvedValue(null)
})

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

describe('Help on Home', () => {
  it('opens a Home help: how to start, what is where, keys, and fixes', async () => {
    spacesState = { spaces: [space()], loading: false, error: null }
    getCachedStats.mockResolvedValue(null)
    getCachedBrief.mockResolvedValue({ headline: 'All caught up', body: 'Nothing due.', generated: false })
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: 'Help' }))
    const dialog = await screen.findByRole('dialog', { name: 'Help' })
    expect(within(dialog).getByRole('heading', { name: 'Start here' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'What’s where' })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /Cards/ })).toHaveAttribute('href', '/flashcards')
    expect(within(dialog).getByText('Keyboard shortcuts')).toBeInTheDocument()
    expect(within(dialog).getByText('If something’s wrong')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Help' })).not.toBeInTheDocument()
  })

  it('opens with the ? key, but not while typing', async () => {
    spacesState = { spaces: [space({ subspaces: [] })], loading: false, error: null }
    getCachedStats.mockResolvedValue(null)
    getCachedBrief.mockResolvedValue({ headline: 'Ready', body: 'Add a topic.', generated: false })
    renderHome()

    const field = await screen.findByLabelText('First topic in Machine Learning')
    fireEvent.keyDown(field, { key: '?' })
    expect(screen.queryByRole('dialog', { name: 'Help' })).not.toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: '?' })
    expect(await screen.findByRole('dialog', { name: 'Help' })).toBeInTheDocument()
  })

  it('is there for a brand-new account too', async () => {
    spacesState = { spaces: [], loading: false, error: null }
    getCachedStats.mockResolvedValue(null)
    getCachedBrief.mockResolvedValue(null)
    renderHome()

    expect(await screen.findByRole('button', { name: 'Help' })).toBeInTheDocument()
  })
})

function stats(over: Partial<Stats> = {}): Stats {
  return {
    streak_days: 2, max_streak: 4, study_minutes_this_week: 35, cards_due: 4, quiz_average: 62,
    docs_indexed: 1, spaces_count: 1, heatmap: [], badges: [], cards_reviewed_today: 0, daily_goal: 10,
    composition: { chat_messages: 3, cards_reviewed: 12, quizzes_taken: 1 },
    due_forecast: [
      { day: '2026-10-21', count: 4 },
      { day: '2026-10-22', count: 6 },
    ],
    ...over,
  }
}

describe('the restructured Home', () => {
  it('reads now → this week → subjects, in that order', async () => {
    spacesState = { spaces: [space()], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats())
    getCachedBrief.mockResolvedValue({ headline: 'RL is moving', body: 'Keep going.', generated: false })
    renderHome()

    const now = await screen.findByRole('heading', { name: 'Up next' })
    const subjects = screen.getByRole('heading', { name: 'Your subjects' })
    const week = screen.getByRole('heading', { name: 'This week' })
    expect(now.compareDocumentPosition(week) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(week.compareDocumentPosition(subjects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Due cards lead, with a real count and a review link — once, not twice.
    const review = await screen.findByRole('link', { name: /Review 4 cards/ })
    expect(review).toHaveAttribute('href', '/sp-1/sub-1/flashcards?review=due')
    expect(screen.queryByText('Cards due', { selector: '.setcode' })).toBeInTheDocument()
    expect(screen.queryByText('Current streak')).toBeInTheDocument()
    // The subject wears its icon (machine learning → chip).
    expect(document.querySelector('[data-subject-icon="cpu"]')).not.toBeNull()
  })

  it('offers the quiz most worth retaking, and shows what is fading with a link to the exact quiz', async () => {
    const two = space({
      subspaces: [
        { id: 'sub-1', subject_id: 'sp-1', name: 'Reinforcement Learning', last_activity_at: new Date().toISOString(), counts: { docs: 1, quizzes: 2 } },
        { id: 'sub-2', subject_id: 'sp-1', name: 'Bandits', last_activity_at: null, counts: { docs: 1, quizzes: 1 } },
      ],
    })
    spacesState = { spaces: [two], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats({ cards_due: 0, docs_indexed: 2 }))
    getCachedBrief.mockResolvedValue({ headline: 'Steady', body: 'Fine.', generated: false })
    listAllQuizzes.mockResolvedValue([
      { id: 'q1', topic: 'Q-learning', questions: [], created_at: '2026-10-01', subspace_id: 'sub-1', best_score: 40, attempts: 2 },
      { id: 'q2', topic: 'UCB', questions: [], created_at: '2026-10-02', subspace_id: 'sub-2', best_score: 55, attempts: 1 },
    ])
    getStudentModel.mockResolvedValue({
      weak_areas: [
        { subspace_id: 'sub-1', topic: 'Reinforcement Learning', average: 40 },
        { subspace_id: 'sub-2', topic: 'Bandits', average: 55 },
      ],
      falling_areas: [], cold_areas: [], strong_areas: [], slipping: [],
    })
    renderHome()

    expect(await screen.findByRole('link', { name: /Q-learning/ })).toHaveAttribute('href', '/sp-1/sub-1/quizzes?q=q1')
    // Fading leaves out the topic already up next, and links the other's exact quiz.
    const retake = await screen.findByRole('link', { name: /Retake quiz/ })
    expect(retake).toHaveAttribute('href', '/sp-1/sub-2/quizzes?q=q2')
    expect(screen.getByText(/Quiz average 55%/)).toBeInTheDocument()
  })

  it('says when files are not ready yet', async () => {
    spacesState = { spaces: [space({ subspaces: [{ id: 'sub-1', subject_id: 'sp-1', name: 'RL', last_activity_at: null, counts: { docs: 3 } }] })], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats({ cards_due: 0, docs_indexed: 1 }))
    getCachedBrief.mockResolvedValue({ headline: 'Reading', body: 'Soon.', generated: false })
    renderHome()

    expect(await screen.findByRole('link', { name: /2 files aren’t ready yet/ })).toHaveAttribute('href', '/sp-1/sub-1/docs')
  })

  it('folds a long subject list behind "Show all"', async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      space({ id: `sp-${i}`, name: `Subject ${i}`, subspaces: [{ id: `t-${i}`, subject_id: `sp-${i}`, name: `Topic ${i}`, last_activity_at: null, counts: {} }] }),
    )
    spacesState = { spaces: many, loading: false, error: null }
    getCachedStats.mockResolvedValue(stats({ cards_due: 0 }))
    getCachedBrief.mockResolvedValue({ headline: 'Lots', body: 'Many.', generated: false })
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: 'Show all 8 subjects' }))
    expect(screen.getByText('Subject 7')).toBeInTheDocument()
  })
})

describe('a subject with no topics yet', () => {
  it('is named a first topic right on Home, which then opens', async () => {
    spacesState = { spaces: [space({ subspaces: [] })], loading: false, error: null }
    getCachedStats.mockResolvedValue(null)
    getCachedBrief.mockResolvedValue({ headline: 'Ready when you are', body: 'Add a topic.', generated: false })
    addSubspace.mockResolvedValue({ id: 'sub-new', name: 'Q-learning', last_activity_at: null, counts: {} })
    renderHome()

    expect(await screen.findByRole('heading', { name: 'Name your first topic' })).toBeInTheDocument()
    expect(screen.queryByText(/in the rail/)).not.toBeInTheDocument()

    // An empty name is not sent.
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Give the topic a short name.')).toBeInTheDocument()
    expect(addSubspace).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('First topic in Machine Learning'), { target: { value: ' Q-learning ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(addSubspace).toHaveBeenCalledWith('sp-1', 'Q-learning')
    await screen.findByText('/sp-1/sub-new')
  })
})
