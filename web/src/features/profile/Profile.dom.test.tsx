// @vitest-environment jsdom
/**
 * The 2026-08 UX audit found the real quiz-derived weak-topic data
 * (`/me/student-model`'s `weak_areas`) computed and already shown in
 * Settings' "Learning" tab, but never on Profile — the page that's actually
 * meant to answer "how am I doing", not just "what have I built". This
 * mounts the real `Profile` and proves "Where to focus" reads from that same
 * endpoint, gives each weak topic one action that goes to the right screen,
 * says what will appear when there is nothing to report, and that the
 * loading-failed and brand-new states are deliberate rather than blank.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Badge, Space, Stats, StudentModel } from '../../api/types'
import { clearCache } from '../../lib/asyncCache'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'student@example.com', created_at: new Date().toISOString(), user_metadata: {} },
    setDisplayName: vi.fn(),
  }),
}))

function stats(overrides: Partial<Stats> = {}): Stats {
  return {
    streak_days: 3,
    max_streak: 10,
    study_minutes_this_week: 42,
    cards_due: 0,
    quiz_average: 80,
    docs_indexed: 2,
    spaces_count: 1,
    heatmap: [],
    badges: [],
    daily_goal: 20,
    composition: { chat_messages: 0, cards_reviewed: 0, quizzes_taken: 0 },
    due_forecast: [],
    ...overrides,
  }
}

const getCachedStats = vi.fn()
vi.mock('../../lib/briefCache', () => ({
  getCachedStats: (...args: unknown[]) => getCachedStats(...args),
}))

/** Two subjects; "Attention" has cards and quizzes, "Bayes" only quizzes. */
const SPACES: Space[] = [
  {
    id: 'sp-1', name: 'Transformers', slug: 'transformers', tone: 'sky', pinned: false,
    subspaces: [
      { id: 'sub-1', subject_id: 'sp-1', name: 'Cross-attention', slug: 'cross-attention', last_activity_at: null, counts: { cards: 12, quizzes: 2 } },
    ],
  },
  {
    id: 'sp-2', name: 'Probability', slug: 'probability', tone: 'mint', pinned: false,
    subspaces: [
      { id: 'sub-2', subject_id: 'sp-2', name: 'Bayes', slug: 'bayes', last_activity_at: null, counts: { quizzes: 1 } },
    ],
  },
]
let spaces: Space[] = SPACES
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces }) }))

function studentModel(overrides: Partial<StudentModel> = {}): StudentModel {
  return {
    learning_style: null,
    session_length_minutes: null,
    exam_context: null,
    teaching_preference: null,
    weak_areas: [],
    strong_areas: [],
    streak_days: 3,
    falling_areas: [],
    cold_areas: [],
    observed_habits: [],
    ...overrides,
  }
}

const getStudentModel = vi.fn()

vi.mock('../../api/me', () => ({
  getStudentModel: (...args: unknown[]) => getStudentModel(...args),
}))

import { Profile } from './Profile'

function renderProfile() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Profile />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  clearCache()
  spaces = SPACES
  getCachedStats.mockResolvedValue(stats())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the "Where to focus" panel', () => {
  it('shows real weak topics from the student model, with their subject', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({
        weak_areas: [
          { subspace_id: 'sub-1', topic: 'Cross-attention', average: 42, subject: 'Transformers' },
        ],
      }),
    )
    renderProfile()

    expect(await screen.findByText('Where to focus')).toBeInTheDocument()
    expect(screen.getByText(/Cross-attention/)).toBeInTheDocument()
    expect(screen.getByText(/Transformers/)).toBeInTheDocument()
    expect(screen.getByText('42% avg')).toBeInTheDocument()
  })

  it('says what will appear here when nothing is weak yet, with somewhere to start', async () => {
    getStudentModel.mockResolvedValue(studentModel({ weak_areas: [] }))
    renderProfile()

    expect(await screen.findByText('Nothing to flag yet')).toBeInTheDocument()
    expect(screen.getByText(/After a few quizzes, your lowest-scoring topics show up here/)).toBeInTheDocument()
    // The first topic that already has a quiz.
    expect(screen.getByRole('link', { name: /Take a quiz/ })).toHaveAttribute(
      'href',
      '/transformers/cross-attention/quizzes',
    )
  })

  it('shows at most three, even with more weak areas than that', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({
        weak_areas: [1, 2, 3, 4, 5].map((n) => ({
          subspace_id: `sub-${n}`,
          topic: `Topic ${n}`,
          average: 40,
          subject: null,
        })),
      }),
    )
    renderProfile()

    await screen.findByText('Where to focus')
    expect(screen.getByText('Topic 1')).toBeInTheDocument()
    expect(screen.getByText('Topic 3')).toBeInTheDocument()
    expect(screen.queryByText('Topic 4')).not.toBeInTheDocument()
  })

  it('prints a recurring mix-up as a plain sentence', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({
        top_misconceptions: [{ text: 'confuses Q-learning with SARSA', last_seen: null }],
      }),
    )
    renderProfile()

    expect(await screen.findByText('A mix-up that keeps coming back')).toBeInTheDocument()
    expect(screen.getByText('Confuses Q-learning with SARSA.')).toBeInTheDocument()
  })

  it('shows a root cause in plain "struggles with / likely because" terms', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({
        root_causes: [{ concept: 'Matrix multiplication', because_of: ['Attention', 'Backprop'] }],
      }),
    )
    renderProfile()

    expect(
      await screen.findByText(/Struggles with Attention, Backprop — likely because of Matrix multiplication/),
    ).toBeInTheDocument()
  })

  it('shows a slipping item with how long ago it was last practised', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({
        slipping: [{ kind: 'topic', label: 'Bayesian Inference', days_since_activity: 12 }],
      }),
    )
    renderProfile()

    expect(await screen.findByText(/Fading: Bayesian Inference, last practised 12 days ago/)).toBeInTheDocument()
  })

  it('shows a recall/application split only when at least one side has evidence', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({
        weak_areas: [
          {
            subspace_id: 'sub-1', topic: 'Cross-attention', average: 42, subject: null,
            recall_mastery: 70, application_mastery: 30,
          },
        ],
      }),
    )
    renderProfile()

    await screen.findByText('Cross-attention')
    expect(screen.getByText('70%')).toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('stays honest — no invented mastery split when neither side has evidence', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({
        weak_areas: [{ subspace_id: 'sub-1', topic: 'Cross-attention', average: 42, subject: null }],
      }),
    )
    renderProfile()

    await screen.findByText('Cross-attention')
    expect(screen.queryByText('Recall')).not.toBeInTheDocument()
    expect(screen.queryByText('Apply')).not.toBeInTheDocument()
  })
})

describe('the action on a weak topic', () => {
  const weak = (over: Partial<StudentModel['weak_areas'][number]> = {}) => ({
    subspace_id: 'sub-1', topic: 'Cross-attention', average: 42, subject: 'Transformers', ...over,
  })

  it('sends a topic whose recall is the weaker half to its cards', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({ weak_areas: [weak({ recall_mastery: 20, application_mastery: 60 })] }),
    )
    renderProfile()

    expect(await screen.findByRole('link', { name: 'Review cards: Cross-attention' })).toHaveAttribute(
      'href',
      '/transformers/cross-attention/flashcards',
    )
  })

  it('sends a topic that is weaker at applying, or has no split yet, to its quizzes', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({
        weak_areas: [
          weak({ recall_mastery: 70, application_mastery: 30 }),
          weak({ subspace_id: 'sub-2', topic: 'Bayes', subject: 'Probability' }),
        ],
      }),
    )
    renderProfile()

    expect(await screen.findByRole('link', { name: 'Take a quiz: Cross-attention' })).toHaveAttribute(
      'href',
      '/transformers/cross-attention/quizzes',
    )
    expect(screen.getByRole('link', { name: 'Take a quiz: Bayes' })).toHaveAttribute(
      'href',
      '/probability/bayes/quizzes',
    )
  })

  it('falls back to a quiz when recall is weaker but the topic has no cards', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({
        weak_areas: [weak({ subspace_id: 'sub-2', topic: 'Bayes', recall_mastery: 10, application_mastery: 50 })],
      }),
    )
    renderProfile()

    expect(await screen.findByRole('link', { name: 'Take a quiz: Bayes' })).toBeInTheDocument()
  })

  it('offers no action for a topic that is no longer in the rail', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({ weak_areas: [weak({ subspace_id: 'gone', topic: 'Deleted topic' })] }),
    )
    renderProfile()

    await screen.findByText('Deleted topic')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('badges', () => {
  const badge = (over: Partial<Badge>): Badge => ({
    id: 'b', label: 'Badge', icon: 'seal', tone: 'sky', tier: 'common',
    earned: false, hint: '', progress: 0, target: 1, ...over,
  })

  it('says what earns a locked badge and how far along it is, and marks an earned one', async () => {
    getCachedStats.mockResolvedValue(
      stats({
        badges: [
          badge({ id: 'a', label: 'First card', earned: true, progress: 1, hint: 'Review a single flashcard.' }),
          badge({ id: 'b', label: '10-day streak', hint: 'Study ten days in a row.', progress: 3, target: 10 }),
        ],
      }),
    )
    getStudentModel.mockResolvedValue(studentModel())
    renderProfile()

    const locked = (await screen.findByText('10-day streak')).closest('li')!
    expect(within(locked).getByText('Study ten days in a row.')).toBeInTheDocument()
    expect(within(locked).getByText('3 of 10')).toBeInTheDocument()
    const earned = screen.getByText('First card').closest('li')!
    expect(within(earned).getByText('Earned')).toBeInTheDocument()
    expect(within(earned).queryByText('Review a single flashcard.')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 earned')).toBeInTheDocument()
  })
})

describe('a brand-new account', () => {
  it('explains the page instead of showing a blank record or a skeleton that never ends', async () => {
    spaces = []
    getCachedStats.mockResolvedValue(
      stats({ streak_days: 0, max_streak: 0, quiz_average: null, docs_indexed: 0, spaces_count: 0, study_minutes_this_week: 0 }),
    )
    getStudentModel.mockResolvedValue(studentModel())
    renderProfile()

    expect(await screen.findByText('Nothing recorded yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to Home' })).toBeInTheDocument()
    expect(screen.getByText(/No study days recorded yet/)).toBeInTheDocument()
    expect(screen.getAllByText(/none taken yet/).length).toBeGreaterThan(0)
    expect(screen.getByText('Nothing to flag yet')).toBeInTheDocument()
    // Nowhere to send them yet, so the only action is the one above.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('when a load fails', () => {
  it('says the record did not load and retries on request', async () => {
    getCachedStats.mockRejectedValueOnce(new Error('boom'))
    getStudentModel.mockResolvedValue(studentModel())
    renderProfile()

    expect(await screen.findByText("Your record didn't load")).toBeInTheDocument()
    expect(screen.queryByText('Standing')).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: /Retry/ }))
    expect(await screen.findByText('Standing')).toBeInTheDocument()
    expect(screen.queryByText("Your record didn't load")).not.toBeInTheDocument()
  })

  it('keeps the rest of the page when only the focus data fails, with its own retry', async () => {
    getStudentModel.mockRejectedValueOnce(new Error('boom'))
    renderProfile()

    expect(await screen.findByText("Couldn't work out where to focus")).toBeInTheDocument()
    expect(screen.getByText('Standing')).toBeInTheDocument()

    getStudentModel.mockResolvedValue(studentModel())
    await userEvent.setup().click(screen.getByRole('button', { name: /Retry/ }))
    expect(await screen.findByText('Nothing to flag yet')).toBeInTheDocument()
  })
})

describe('"How you learn best"', () => {
  it('shows a style summary per subject once there is enough evidence', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({
        style_summaries: [{ subject: 'Machine Learning', strategy_summary: 'Learns best through examples' }],
      }),
    )
    renderProfile()

    expect(await screen.findByText('How you learn best')).toBeInTheDocument()
    expect(screen.getByText('Machine Learning')).toBeInTheDocument()
    expect(screen.getByText('Learns best through examples')).toBeInTheDocument()
  })

  it('stays off the page when nothing has enough evidence yet', async () => {
    getStudentModel.mockResolvedValue(studentModel({ style_summaries: [] }))
    renderProfile()

    await waitFor(() => expect(getStudentModel).toHaveBeenCalled())
    expect(screen.queryByText('How you learn best')).not.toBeInTheDocument()
  })
})

describe('the activity heatmap legend', () => {
  it('says the shading is relative, not an absolute scale', async () => {
    getCachedStats.mockResolvedValue(
      stats({
        heatmap: Array.from({ length: 14 }, (_, i) => ({
          day: `2026-09-${String(i + 1).padStart(2, '0')}`,
          intensity: i % 4,
          minutes: i * 3,
        })),
      }),
    )
    getStudentModel.mockResolvedValue(studentModel())
    renderProfile()

    expect(await screen.findByText(/relative to your busiest day/)).toBeInTheDocument()
  })
})
