// @vitest-environment jsdom
/**
 * A quiz can be renamed and deleted from the list (desktop tile, phone sheet),
 * delete asks first, and an empty list on a topic with no file yet sends the
 * student to add one on desktop as it does on a phone.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { clearCache } from '../../lib/asyncCache'
import type { Quiz, Space, Subspace } from '../../api/types'
import { mockPhone } from './phoneTestUtils'

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
const clearStatsCache = vi.fn()
vi.mock('../../lib/briefCache', () => ({ clearStatsCache: () => clearStatsCache() }))

const quiz = (o: Partial<Quiz> = {}): Quiz => ({
  id: 'q1',
  topic: 'Self-attention',
  questions: [{ q: 'What is Q?', choices: ['a', 'b', 'c', 'd'], answer_index: 0 }],
  created_at: new Date().toISOString(),
  subspace_id: SUB.id,
  subspace_name: SUB.name,
  subject_name: SPACE.name,
  ...o,
})

const listAllQuizzes = vi.fn()
const renameQuiz = vi.fn()
const deleteQuiz = vi.fn()
vi.mock('../../api/quizzes', () => ({
  listAllQuizzes: (...a: unknown[]) => listAllQuizzes(...a),
  renameQuiz: (...a: unknown[]) => renameQuiz(...a),
  deleteQuiz: (...a: unknown[]) => deleteQuiz(...a),
  listQuizzes: vi.fn(),
  getQuiz: vi.fn(),
  generateQuiz: vi.fn(),
  submitQuiz: vi.fn(),
}))

import { QuizzesView } from './QuizzesView'

function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{pathname + search}</p>
}
const renderView = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<QuizzesView />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )

let restorePhone: (() => void) | null = null
afterEach(() => {
  cleanup()
  clearCache()
  sessionStorage.clear()
  restorePhone?.()
  restorePhone = null
  topic.docs = 3
  vi.clearAllMocks()
})

describe('renaming a quiz', () => {
  it('desktop: the new name replaces the old one, where it lives stays', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    renameQuiz.mockResolvedValue(quiz({ topic: 'Query, key, value', subspace_name: null, subject_name: null }))
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Rename Self-attention' }))
    const field = await screen.findByLabelText('Quiz name')
    expect(field).toHaveValue('Self-attention')
    await user.clear(field)
    await user.type(field, ' Query, key, value ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(renameQuiz).toHaveBeenCalledWith('q1', 'Query, key, value'))
    expect(await screen.findByText('Query, key, value')).toBeInTheDocument()
    expect(screen.queryByText('Self-attention')).toBeNull()
    expect(screen.getByText(/FSD · Attention$/)).toBeInTheDocument()
  })

  it('phone: from the row sheet', async () => {
    restorePhone = mockPhone()
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    renameQuiz.mockResolvedValue(quiz({ topic: 'Query, key, value' }))
    renderView()
    await user.click(await screen.findByRole('button', { name: 'More actions for Self-attention' }))
    await user.click(await screen.findByRole('button', { name: 'Rename quiz' }))
    const field = await screen.findByLabelText('Quiz name')
    await user.clear(field)
    await user.type(field, 'Query, key, value')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(renameQuiz).toHaveBeenCalledWith('q1', 'Query, key, value'))
    expect(await screen.findByText('Query, key, value')).toBeInTheDocument()
  })
})

describe('deleting a quiz', () => {
  it('desktop: asks first; Cancel deletes nothing', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Delete Self-attention' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Delete this quiz?')
    expect(dialog).toHaveTextContent('Your scores for it go too.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(deleteQuiz).not.toHaveBeenCalled()
    expect(screen.getByText('Self-attention')).toBeInTheDocument()
  })

  it('desktop: on confirm it leaves the list, with its draft, and counts elsewhere are refreshed', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('sl:quiz-draft:v1:q1', '{}')
    listAllQuizzes.mockResolvedValue([quiz(), quiz({ id: 'q2', topic: 'Positional encoding' })])
    deleteQuiz.mockResolvedValue({ ok: true })
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Delete Self-attention' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteQuiz).toHaveBeenCalledWith('q1'))
    await waitFor(() => expect(screen.queryByText('Self-attention')).toBeNull())
    expect(screen.getByText('Positional encoding')).toBeInTheDocument()
    await waitFor(() => expect(refreshSpaces).toHaveBeenCalled())
    expect(clearStatsCache).toHaveBeenCalled()
    expect(sessionStorage.getItem('sl:quiz-draft:v1:q1')).toBeNull()
  })

  it('a failed delete puts the quiz back', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    deleteQuiz.mockRejectedValue(new Error('Could not delete that.'))
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Delete Self-attention' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Could not delete that.')).toBeInTheDocument()
    await waitFor(() => expect(listAllQuizzes).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Self-attention')).toBeInTheDocument()
  })

  it('phone: from the row sheet, behind the same question', async () => {
    restorePhone = mockPhone()
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    deleteQuiz.mockResolvedValue({ ok: true })
    renderView()
    await user.click(await screen.findByRole('button', { name: 'More actions for Self-attention' }))
    await user.click(await screen.findByRole('button', { name: 'Delete quiz' }))
    expect(deleteQuiz).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteQuiz).toHaveBeenCalledWith('q1'))
  })
})

describe('empty Quizzes on desktop', () => {
  it('with no file in the topic: says so, and the button goes to add one', async () => {
    topic.docs = 0
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([])
    renderView()
    expect(await screen.findByText(/Attention has no material yet\. Add a file/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate a quiz/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: /Add material/ }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/s/fsd/attention/docs?add=1')
  })

  it('with a file in the topic it still offers to generate', async () => {
    listAllQuizzes.mockResolvedValue([])
    renderView()
    expect(await screen.findByRole('button', { name: /Generate a quiz/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add material/ })).toBeNull()
  })
})
