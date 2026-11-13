// @vitest-environment jsdom
/**
 * The ways a quiz could go wrong without saying so:
 *  - the page header's Back threw away a quiz in progress with no question asked;
 *  - a quiz with no questions crashed the page;
 *  - a quiz that failed to load had no way to try again;
 *  - the "Questions" field in the generate dialog could not be cleared and retyped.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { AssessmentProvider } from '../../lib/assessment'
import { clearCache } from '../../lib/asyncCache'
import type { Quiz, Space, Subspace } from '../../api/types'

const SUB: Subspace = { id: 'sub-a', subject_id: 'space-a', name: 'Attention', last_activity_at: null, counts: {} }
const SPACE: Space = { id: 'space-a', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUB] }

vi.mock('../../lib/useTopicScope', () => ({
  useTopicScope: () => ({ space: SPACE, subspace: SUB, base: '/fsd/attention', isGlobal: false }),
}))
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: [SPACE] }) }))

const ID = '6c114e4a-d302-4a1c-9a3e-1b5f6a7c8d90'
const quiz = (o: Partial<Quiz> = {}): Quiz => ({
  id: ID,
  topic: 'Self-attention',
  questions: [
    { q: 'What is Q?', choices: ['a', 'b', 'c', 'd'], answer_index: 0 },
    { q: 'What is K?', choices: ['a', 'b', 'c', 'd'], answer_index: 1 },
  ],
  created_at: new Date().toISOString(),
  subspace_id: SUB.id,
  subspace_name: SUB.name,
  subject_name: SPACE.name,
  ...o,
})

const listAllQuizzes = vi.fn()
const getQuiz = vi.fn()
const generateQuiz = vi.fn()
vi.mock('../../api/quizzes', () => ({
  listAllQuizzes: (...a: unknown[]) => listAllQuizzes(...a),
  listQuizzes: vi.fn(),
  getQuiz: (...a: unknown[]) => getQuiz(...a),
  generateQuiz: (...a: unknown[]) => generateQuiz(...a),
  submitQuiz: vi.fn(),
}))

import { QuizzesView } from './QuizzesView'

// An unfinished attempt is kept for the tab (see ./draft.ts); not between tests.
afterEach(() => sessionStorage.clear())

function Where() {
  const l = useLocation()
  return <span data-testid="where">{l.pathname + l.search}</span>
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <AssessmentProvider>
          <QuizzesView />
          <Where />
        </AssessmentProvider>
      </ToastProvider>
    </MemoryRouter>,
  )

afterEach(() => {
  cleanup()
  clearCache()
  vi.clearAllMocks()
})

describe('the page header Back, mid-quiz', () => {
  it('asks before discarding answers, and Cancel keeps the quiz open', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    getQuiz.mockResolvedValue(quiz())
    renderAt(`/fsd/attention/quizzes?q=${ID}`)

    await user.click(await screen.findByRole('radio', { name: /a/ }))
    await user.click(screen.getByRole('button', { name: /All quizzes/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Leave this quiz?')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('?q=')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('What is Q?')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('?q=')

    await user.click(screen.getByRole('button', { name: /All quizzes/ }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave quiz' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/fsd/attention/quizzes'))
    expect(screen.getByTestId('where')).not.toHaveTextContent('?q=')
  })

  it('goes straight back when nothing has been answered', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    getQuiz.mockResolvedValue(quiz())
    renderAt(`/fsd/attention/quizzes?q=${ID}`)

    await screen.findByText('What is Q?')
    await user.click(screen.getByRole('button', { name: /All quizzes/ }))
    await waitFor(() => expect(screen.getByTestId('where')).not.toHaveTextContent('?q='))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('a quiz that cannot be taken', () => {
  it('says so when it has no questions, instead of crashing', async () => {
    const empty = quiz({ questions: [] })
    listAllQuizzes.mockResolvedValue([empty])
    getQuiz.mockResolvedValue(empty)
    renderAt(`/fsd/attention/quizzes?q=${ID}`)

    expect(await screen.findByText('This quiz has no questions.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('offers Retry when it fails to load, and loads on the second try', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    getQuiz.mockRejectedValueOnce(new Error('network down')).mockResolvedValue(quiz())
    renderAt(`/fsd/attention/quizzes?q=${ID}`)

    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('What is Q?')).toBeInTheDocument()
    expect(getQuiz).toHaveBeenCalledTimes(2)
  })
})

describe('the generate dialog', () => {
  it('lets the question count be cleared and retyped', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    generateQuiz.mockReturnValue(new Promise(() => {}))
    renderAt('/fsd/attention/quizzes')

    await user.click(await screen.findByRole('button', { name: /Generate quiz/ }))
    const count = await screen.findByLabelText('Questions')
    await user.clear(count)
    expect(count).toHaveValue(null)
    await user.type(count, '12')
    expect(count).toHaveValue(12)

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    expect(generateQuiz).toHaveBeenCalledWith(SUB.id, { topic: undefined, count: 12, source: 'files' })
  })

  it('keeps the count inside 1 to 20', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    generateQuiz.mockReturnValue(new Promise(() => {}))
    renderAt('/fsd/attention/quizzes')

    await user.click(await screen.findByRole('button', { name: /Generate quiz/ }))
    const count = await screen.findByLabelText('Questions')
    await user.clear(count)
    await user.type(count, '99')
    await user.tab()
    expect(count).toHaveValue(20)
  })
})
