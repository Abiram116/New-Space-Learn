// @vitest-environment jsdom
/**
 * Retaking a quiz: same or reworded, the choice remembered; a reworded attempt
 * scored against the stored quiz; "you already have this quiz" instead of a
 * near-copy; "Add more questions"; and the source picker in the generate dialog.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { AssessmentProvider } from '../../lib/assessment'
import { clearCache } from '../../lib/asyncCache'
import type { Quiz, QuizReword, Space, Subspace } from '../../api/types'
import { retakeAskSwitch, retakeRewordSwitch } from './variant'

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
    { q: 'What is Q?', choices: ['qa', 'qb', 'qc', 'qd'], answer_index: 0 },
    { q: 'What is K?', choices: ['ka', 'kb', 'kc', 'kd'], answer_index: 2 },
  ],
  created_at: new Date().toISOString(),
  subspace_id: SUB.id,
  subspace_name: SUB.name,
  subject_name: SPACE.name,
  best_score: 50,
  attempts: 1,
  ...o,
})

const REWORD: QuizReword = {
  quiz_id: ID,
  reworded: 2,
  note: null,
  questions: [
    { q: 'K stands for?', choices: ['kc', 'ka', 'kd', 'kb'], answer_index: 0, original_index: 1, choice_order: [2, 0, 3, 1] },
    { q: 'Q stands for?', choices: ['qb', 'qa', 'qc', 'qd'], answer_index: 1, original_index: 0, choice_order: [1, 0, 2, 3] },
  ],
}

const listAllQuizzes = vi.fn()
const getQuiz = vi.fn()
const generateQuiz = vi.fn()
const submitQuiz = vi.fn()
const rewordQuiz = vi.fn()
const extendQuiz = vi.fn()
vi.mock('../../api/quizzes', () => ({
  listAllQuizzes: (...a: unknown[]) => listAllQuizzes(...a),
  listQuizzes: vi.fn(),
  getQuiz: (...a: unknown[]) => getQuiz(...a),
  generateQuiz: (...a: unknown[]) => generateQuiz(...a),
  submitQuiz: (...a: unknown[]) => submitQuiz(...a),
  rewordQuiz: (...a: unknown[]) => rewordQuiz(...a),
  extendQuiz: (...a: unknown[]) => extendQuiz(...a),
}))
const listNotes = vi.fn()
vi.mock('../../api/notes', () => ({ listNotes: (...a: unknown[]) => listNotes(...a) }))

import { QuizzesView } from './QuizzesView'

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
  sessionStorage.clear()
  localStorage.clear()
  retakeAskSwitch.set(true)
  retakeRewordSwitch.set(false)
})

describe('retaking a quiz', () => {
  it('a quiz never taken just starts', async () => {
    listAllQuizzes.mockResolvedValue([quiz({ attempts: 0, best_score: null })])
    getQuiz.mockResolvedValue(quiz({ attempts: 0, best_score: null }))
    renderAt(`/fsd/attention/quizzes?q=${ID}`)
    expect(await screen.findByText('What is Q?')).toBeInTheDocument()
    expect(screen.queryByText('Taking it again')).not.toBeInTheDocument()
  })

  it('asks same or reworded, and scores a reworded attempt against the stored quiz', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    getQuiz.mockResolvedValue(quiz())
    rewordQuiz.mockResolvedValue(REWORD)
    submitQuiz.mockResolvedValue({ score: 50, correct: [false, true], attempts: 2, previous_best: 50 })
    renderAt(`/fsd/attention/quizzes?q=${ID}`)

    expect(await screen.findByText('Taking it again')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reworded/ }))
    expect(rewordQuiz).toHaveBeenCalledWith(ID)

    // Shown: K first. Pick "kc" (right), then "qb" (wrong).
    expect(await screen.findByText('K stands for?')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /kc/ }))
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await user.click(await screen.findByRole('radio', { name: /qb/ }))
    await user.click(screen.getByRole('button', { name: 'See results' }))

    // Stored order: Q got "qb" (1), K got "kc" (2).
    await waitFor(() => expect(submitQuiz).toHaveBeenCalledWith(ID, [1, 2], expect.any(Number)))
    expect(retakeRewordSwitch.get()).toBe(true) // remembered
  })

  it('with "don\'t ask again", the next retake goes straight to the usual', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    getQuiz.mockResolvedValue(quiz())
    renderAt(`/fsd/attention/quizzes?q=${ID}`)
    await screen.findByText('Taking it again')
    await user.click(screen.getByRole('checkbox', { name: /don't ask again/ }))
    await user.click(screen.getByRole('button', { name: /Same questions/ }))
    expect(await screen.findByText('What is Q?')).toBeInTheDocument()
    expect(retakeAskSwitch.get()).toBe(false)
    expect(retakeRewordSwitch.get()).toBe(false)
    expect(rewordQuiz).not.toHaveBeenCalled()
  })

  it('a failed rewording says why and leaves "Same questions" right there', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    getQuiz.mockResolvedValue(quiz())
    rewordQuiz.mockRejectedValue(new Error('offline'))
    renderAt(`/fsd/attention/quizzes?q=${ID}`)
    await user.click(await screen.findByRole('button', { name: /Reworded/ }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Same questions/ }))
    expect(await screen.findByText('What is Q?')).toBeInTheDocument()
  })

  it('an attempt in progress resumes without asking', async () => {
    sessionStorage.setItem(`sl:quiz-draft:v1:${ID}`, JSON.stringify({ quizId: ID, index: 1, answers: [0, -1], seconds: 3 }))
    listAllQuizzes.mockResolvedValue([quiz()])
    getQuiz.mockResolvedValue(quiz())
    renderAt(`/fsd/attention/quizzes?q=${ID}`)
    expect(await screen.findByText('What is K?')).toBeInTheDocument()
    expect(screen.queryByText('Taking it again')).not.toBeInTheDocument()
  })
})

describe('the generate dialog', () => {
  it('offers the quiz that already covers the typed focus instead of a copy', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    renderAt('/fsd/attention/quizzes')
    await user.click(await screen.findByRole('button', { name: /Generate quiz/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Focus (optional)'), 'self attention')
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }))
    expect(within(dialog).getByText(/You already have/)).toBeInTheDocument()
    expect(generateQuiz).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Make a new one anyway' }))
    expect(generateQuiz).toHaveBeenCalledWith(SUB.id, { topic: 'self attention', count: 5, source: 'files' })
  })

  it('"Take it reworded" opens the existing quiz reworded', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    getQuiz.mockResolvedValue(quiz())
    rewordQuiz.mockResolvedValue(REWORD)
    renderAt('/fsd/attention/quizzes')
    await user.click(await screen.findByRole('button', { name: /Generate quiz/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Focus (optional)'), 'Self-attention')
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }))
    await user.click(within(dialog).getByRole('button', { name: 'Take it reworded' }))
    expect(await screen.findByText('K stands for?')).toBeInTheDocument()
    expect(screen.queryByText('Taking it again')).not.toBeInTheDocument()
  })

  it('makes a quiz from one note, and says when the topic has none', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([])
    listNotes.mockResolvedValue([])
    renderAt('/fsd/attention/quizzes')
    await user.click(await screen.findByRole('button', { name: /Generate quiz/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Make it from' }))
    await user.click(await screen.findByRole('option', { name: 'One of your notes' }))
    expect(await within(dialog).findByText(/no notes yet/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Generate' })).toBeDisabled()
  })

  it('general knowledge is labelled as not from your material', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([])
    generateQuiz.mockReturnValue(new Promise(() => {}))
    renderAt('/fsd/attention/quizzes')
    await user.click(await screen.findByRole('button', { name: /Generate quiz/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Make it from' }))
    await user.click(await screen.findByRole('option', { name: "The AI's general knowledge" }))
    expect(within(dialog).getByText(/Not from your material/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }))
    await user.click(within(dialog).getByRole('button', { name: /Generat/ }))
    expect(generateQuiz).toHaveBeenCalledTimes(1) // a double click is one quiz
    expect(generateQuiz).toHaveBeenCalledWith(SUB.id, { topic: undefined, count: 5, source: 'general' })
  })
})

describe('add more questions', () => {
  it('appends to the quiz and says how many came', async () => {
    const user = userEvent.setup()
    listAllQuizzes.mockResolvedValue([quiz()])
    const grown = quiz({ questions: [...quiz().questions, { q: 'What is V?', choices: ['a', 'b', 'c', 'd'], answer_index: 3 }] })
    extendQuiz.mockResolvedValue(grown)
    renderAt('/fsd/attention/quizzes')
    await user.click(await screen.findByRole('button', { name: 'Add questions to Self-attention' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Add 5 questions/ }))
    expect(extendQuiz).toHaveBeenCalledWith(ID, { count: 5, source: 'files' })
    expect(await screen.findByText(/Added 1 of 5/)).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument() // the tile's question count
  })
})
