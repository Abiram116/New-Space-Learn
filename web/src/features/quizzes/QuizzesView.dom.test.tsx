// @vitest-environment jsdom
/**
 * Same audit finding and fix as `FlashcardsView.dom.test.tsx` — Quizzes was
 * restricted to whichever topic happened to be open. This mounts the real
 * `QuizzesView` and proves it now calls the account-wide listing and shows
 * quizzes from every subject, with a Subject · Topic caption + subject
 * filter once they span more than one.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Quiz, Space, Subspace } from '../../api/types'

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

// The views read their topic through `useTopicScope`; here that is simply the
// topic this file's `lib/nav` mock already provides.
vi.mock('../../lib/useTopicScope', async () => {
  const nav = await import('../../lib/nav')
  return { useTopicScope: () => ({ ...nav.useActiveSubspace(), isGlobal: false }) }
})

vi.mock('../spaces/SpacesProvider', () => ({
  useSpaces: () => ({ spaces: [SPACE_A, SPACE_B] }),
}))

function quiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    id: 'quiz-1',
    topic: 'Self-attention',
    questions: [
      { q: 'What is Q?', choices: ['a', 'b', 'c', 'd'], answer_index: 0 },
    ],
    created_at: new Date().toISOString(),
    subspace_id: SUBSPACE_A.id,
    subspace_name: SUBSPACE_A.name,
    subject_name: SPACE_A.name,
    ...overrides,
  }
}

const listAllQuizzes = vi.fn()
const listQuizzes = vi.fn()
const generateQuiz = vi.fn()

vi.mock('../../api/quizzes', () => ({
  listAllQuizzes: (...args: unknown[]) => listAllQuizzes(...args),
  listQuizzes: (...args: unknown[]) => listQuizzes(...args),
  getQuiz: vi.fn(),
  generateQuiz: (...args: unknown[]) => generateQuiz(...args),
  submitQuiz: vi.fn(),
}))

import { QuizzesView } from './QuizzesView'

function renderView() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <QuizzesView />
      </ToastProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Quizzes is a global library', () => {
  it('calls the account-wide listing, not the per-subspace one', async () => {
    listAllQuizzes.mockResolvedValue([quiz()])
    renderView()

    await waitFor(() => expect(listAllQuizzes).toHaveBeenCalledTimes(1))
    expect(listQuizzes).not.toHaveBeenCalled()
  })

  it('shows a quiz from a different subject than the one currently open', async () => {
    listAllQuizzes.mockResolvedValue([
      quiz({ id: 'quiz-b', topic: 'Bottleneck layer', subspace_id: SUBSPACE_B.id, subspace_name: SUBSPACE_B.name, subject_name: SPACE_B.name }),
    ])
    renderView()

    await waitFor(() => expect(screen.getByText('Bottleneck layer')).toBeInTheDocument())
    expect(screen.getByText(/Deep Learning/)).toBeInTheDocument()
  })

  it('offers a subject filter once quizzes span more than one subject, and narrows the grid', async () => {
    listAllQuizzes.mockResolvedValue([
      quiz({ id: 'quiz-a', topic: 'FSD quiz' }),
      quiz({ id: 'quiz-b', topic: 'DL quiz', subspace_id: SUBSPACE_B.id, subspace_name: SUBSPACE_B.name, subject_name: SPACE_B.name }),
    ])
    const user = userEvent.setup()
    renderView()

    await waitFor(() => expect(screen.getByText('FSD quiz')).toBeInTheDocument())
    const select = screen.getByRole('button', { name: 'Filter by subject' })

    await user.click(select)
    await user.click(screen.getByRole('option', { name: 'Deep Learning' }))
    expect(screen.queryByText('FSD quiz')).not.toBeInTheDocument()
    expect(screen.getByText('DL quiz')).toBeInTheDocument()
  })

  it("shows each quiz's best score, and nothing for one not yet taken", async () => {
    listAllQuizzes.mockResolvedValue([
      quiz({ id: 'taken', topic: 'Taken quiz', best_score: 80, attempts: 3 }),
      quiz({ id: 'fresh', topic: 'Fresh quiz', best_score: null, attempts: 0 }),
      quiz({ id: 'zero', topic: 'Zero quiz', best_score: 0, attempts: 1 }),
    ])
    renderView()

    await waitFor(() => expect(screen.getByText('Fresh quiz')).toBeInTheDocument())
    expect(screen.getByText('Best 80%')).toBeInTheDocument()
    expect(screen.getByText('Best 0%')).toBeInTheDocument()
    expect(screen.getAllByText(/^Best \d+%$/)).toHaveLength(2)
  })

  it('says what a tap does: Start for a new quiz, Retake once it has been taken', async () => {
    listAllQuizzes.mockResolvedValue([
      quiz({ id: 'taken', topic: 'Taken quiz', best_score: 80, attempts: 3 }),
      quiz({ id: 'zero', topic: 'Zero quiz', best_score: 0, attempts: 1 }),
      quiz({ id: 'fresh', topic: 'Fresh quiz', best_score: null, attempts: 0 }),
    ])
    renderView()

    await waitFor(() => expect(screen.getByText('Fresh quiz')).toBeInTheDocument())
    expect(screen.getAllByText('Retake →')).toHaveLength(2) // a 0% attempt still counts as taken
    expect(screen.getAllByText('Start →')).toHaveLength(1)
  })

  it('hides the subject filter when everything belongs to one subject', async () => {
    listAllQuizzes.mockResolvedValue([quiz({ id: 'q1' }), quiz({ id: 'q2', topic: 'Second quiz' })])
    renderView()

    await waitFor(() => expect(screen.getByText('Second quiz')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Filter by subject' })).not.toBeInTheDocument()
  })
})

describe('Generate quiz says which topic it draws on', () => {
  it('defaults to the current topic, and a different pick is the one sent', async () => {
    listAllQuizzes.mockResolvedValue([quiz()])
    generateQuiz.mockResolvedValue(quiz({ id: 'quiz-new' }))
    renderView()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Generate quiz/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Generate a quiz' })
    const picker = within(dialog).getByRole('button', { name: /Topic/ })
    expect(picker).toHaveTextContent('FSD › Attention')

    await user.click(picker)
    await user.click(within(dialog).getByText('Deep Learning › Autoencoders'))
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(generateQuiz).toHaveBeenCalled())
    expect(generateQuiz.mock.calls[0][0]).toBe(SUBSPACE_B.id)
  })
})

