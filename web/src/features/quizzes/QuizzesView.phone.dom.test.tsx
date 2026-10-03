// @vitest-environment jsdom
/** The quiz library on a phone: one row per quiz, "New quiz" pinned. */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Quiz, Space, Subspace } from '../../api/types'
import { mockPhone } from './phoneTestUtils'

const SUB: Subspace = { id: 'sub', subject_id: 'sp', name: 'Attention', last_activity_at: null, counts: {} }
const SPACE: Space = { id: 'sp', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUB] }
vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({ space: SPACE, subspace: SUB, base: '/spaces/sp/sub' }),
}))

// The views read their topic through `useTopicScope`; here that is simply the
// topic this file's `lib/nav` mock already provides.
vi.mock('../../lib/useTopicScope', async () => {
  const nav = await import('../../lib/nav')
  return { useTopicScope: () => ({ ...nav.useActiveSubspace(), isGlobal: false }) }
})
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: [SPACE] }) }))

const q = (o: Partial<Quiz> = {}): Quiz => ({
  id: 'q1',
  topic: 'Self-attention',
  questions: [{ q: 'Q?', choices: ['a', 'b', 'c', 'd'], answer_index: 0 }],
  created_at: new Date().toISOString(),
  subspace_id: SUB.id,
  best_score: 80,
  ...o,
})

const listAllQuizzes = vi.fn()
const generateQuiz = vi.fn()
vi.mock('../../api/quizzes', () => ({
  listAllQuizzes: (...a: unknown[]) => listAllQuizzes(...a),
  generateQuiz: (...a: unknown[]) => generateQuiz(...a),
  getQuiz: vi.fn(),
  submitQuiz: vi.fn(),
}))

import { QuizzesView } from './QuizzesView'

let restore: () => void
beforeEach(() => {
  restore = mockPhone()
})
afterEach(() => {
  cleanup()
  restore()
  vi.clearAllMocks()
})

const renderView = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <QuizzesView />
      </ToastProvider>
    </MemoryRouter>,
  )

describe('phone quiz list', () => {
  it('rows carry the best score; New quiz is pinned and opens the sheet', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([q(), q({ id: 'q2', topic: 'Autoencoders', best_score: null })])
    renderView()
    await waitFor(() => expect(screen.getByText('Self-attention')).toBeInTheDocument())
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    const bar = document.querySelector('[data-sticky-action-bar]') as HTMLElement
    await user.click(within(bar).getByRole('button', { name: 'New quiz' }))
    // Modal renders as a bottom sheet on phones.
    expect(await screen.findByRole('dialog', { name: 'Generate a quiz' })).toBeInTheDocument()
  })

  it('an empty library leads with one big generate button', async () => {
    listAllQuizzes.mockResolvedValue([])
    renderView()
    await waitFor(() => expect(screen.getByText('No quizzes yet')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Generate a quiz/ })).toBeInTheDocument()
  })
})
