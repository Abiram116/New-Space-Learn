// @vitest-environment jsdom
/**
 * The 2026-08 UX audit found the real quiz-derived weak-topic data
 * (`/me/student-model`'s `weak_areas`) computed and already shown in
 * Settings' "Learning" tab, but never on Profile — the page that's actually
 * meant to answer "how am I doing", not just "what have I built". This
 * mounts the real `Profile` and proves the new "Where to focus" section
 * reads from that same endpoint, stays silent when there's nothing to
 * report, and that the heatmap legend now says the shading is relative
 * rather than an absolute scale.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { StudentModel } from '../../api/types'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'student@example.com', created_at: new Date().toISOString(), user_metadata: {} },
    setDisplayName: vi.fn(),
  }),
}))

vi.mock('../../lib/briefCache', () => ({
  getCachedStats: vi.fn().mockResolvedValue({
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
  }),
}))

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

  it('stays off the page when there are no weak areas yet', async () => {
    getStudentModel.mockResolvedValue(studentModel({ weak_areas: [] }))
    renderProfile()

    await waitFor(() => expect(getStudentModel).toHaveBeenCalled())
    expect(screen.queryByText('Where to focus')).not.toBeInTheDocument()
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

  it('shows a misconception as a mix-up', async () => {
    getStudentModel.mockResolvedValue(
      studentModel({
        top_misconceptions: [{ text: 'confuses Q-learning with SARSA', last_seen: null }],
      }),
    )
    renderProfile()

    await screen.findByText('Where to focus')
    expect(screen.getByText(/Mix-up: confuses Q-learning with SARSA/)).toBeInTheDocument()
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
    getStudentModel.mockResolvedValue(studentModel())
    renderProfile()

    expect(await screen.findByText(/relative to your busiest day/)).toBeInTheDocument()
  })
})
