// @vitest-environment jsdom
/**
 * A reload mid-quiz used to lose every answer: they are only sent on "See
 * results". The runner now keeps the attempt for the tab and picks it up when
 * the same quiz is opened again; submitting or leaving on purpose clears it.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { QuizRunner } from './QuizRunner'
import { AssessmentProvider } from '../../lib/assessment'
import type { Quiz } from '../../api/types'

const submitQuiz = vi.fn()
vi.mock('../../api/quizzes', () => ({
  submitQuiz: (...args: unknown[]) => submitQuiz(...args),
}))

function quiz(id = 'quiz-1'): Quiz {
  return {
    id,
    topic: 'Layers',
    created_at: new Date().toISOString(),
    questions: ['first', 'second', 'third'].map((name) => ({
      q: `The ${name} question`,
      choices: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      answer_index: 0,
      subtopic: null,
      explanation: null,
    })),
  }
}

function renderRunner(props: Partial<ComponentProps<typeof QuizRunner>> = {}) {
  return render(
    <AssessmentProvider>
      <QuizRunner quiz={quiz()} onFinished={vi.fn()} onExit={vi.fn()} {...props} />
    </AssessmentProvider>,
  )
}

/** Answer the first question (wrongly) and move to the second. */
async function answerFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /Beta/ }))
  await user.click(screen.getByRole('button', { name: /Next/ }))
  expect(await screen.findByText('The second question')).toBeInTheDocument()
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.clearAllMocks()
})

describe('answers survive a reload', () => {
  it('opens the same quiz where it was left, with the answers given', async () => {
    const user = userEvent.setup()
    renderRunner()
    await answerFirst(user)
    cleanup() // the page goes away without submitting or leaving

    renderRunner()
    expect(screen.getByText('The second question')).toBeInTheDocument()
    // Finish it: the first answer sent is the one given before the reload.
    submitQuiz.mockResolvedValue({ score: 67, correct: [false, true, true] })
    await user.click(screen.getByRole('radio', { name: /Alpha/ }))
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await user.click(await screen.findByRole('radio', { name: /Alpha/ }))
    await user.click(screen.getByRole('button', { name: 'See results' }))
    await waitFor(() => expect(submitQuiz).toHaveBeenCalledTimes(1))
    expect(submitQuiz.mock.calls[0].slice(0, 2)).toEqual(['quiz-1', [1, 0, 0]])
  })

  it('does not carry answers into a different quiz', async () => {
    const user = userEvent.setup()
    renderRunner()
    await answerFirst(user)
    cleanup()

    renderRunner({ quiz: quiz('quiz-2') })
    expect(screen.getByText('The first question')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull()
  })

  it('starts clean after the quiz is submitted', async () => {
    const user = userEvent.setup()
    submitQuiz.mockResolvedValue({ score: 0, correct: [false] })
    const one: Quiz = { ...quiz(), questions: quiz().questions.slice(0, 1) }
    const onFinished = vi.fn()
    renderRunner({ quiz: one, onFinished })
    await user.click(screen.getByRole('radio', { name: /Beta/ }))
    await user.click(screen.getByRole('button', { name: 'See results' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
    cleanup()

    renderRunner({ quiz: one })
    expect(screen.queryByRole('button', { name: 'See results' })).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('starts clean after leaving on purpose', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    renderRunner({ onExit })
    await answerFirst(user)
    await user.click(screen.getByRole('button', { name: /Leave/ }))
    // Leaving with answers given asks first.
    await user.click(await screen.findByRole('button', { name: /Leave quiz/ }))
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(sessionStorage.length).toBe(0)
    cleanup()

    renderRunner()
    expect(screen.getByText('The first question')).toBeInTheDocument()
  })
})
