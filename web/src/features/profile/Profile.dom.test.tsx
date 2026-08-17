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
})

describe('the activity heatmap legend', () => {
  it('says the shading is relative, not an absolute scale', async () => {
    getStudentModel.mockResolvedValue(studentModel())
    renderProfile()

    expect(await screen.findByText(/relative to your busiest day/)).toBeInTheDocument()
  })
})
