// @vitest-environment jsdom
/**
 * Taking a quiz on a phone: the question up top, big stacked answers below,
 * an immediate verdict, and an explanation panel with a large Next pinned
 * under it. The keyboard legend is a desktop thing and stays out.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssessmentProvider } from '../../lib/assessment'
import type { Quiz, QuizResult } from '../../api/types'
import { mockPhone } from './phoneTestUtils'

const submitQuiz = vi.fn()
vi.mock('../../api/quizzes', () => ({
  submitQuiz: (...args: unknown[]) => submitQuiz(...args),
}))

import { QuizRunner } from './QuizRunner'
import { QuizResults } from './QuizResults'

const QUIZ: Quiz = {
  id: 'q1',
  topic: 'Attention',
  created_at: new Date().toISOString(),
  questions: [
    {
      q: 'What does the bottleneck layer do?',
      choices: ['Compresses', 'Expands', 'Deletes', 'Duplicates'],
      answer_index: 0,
      subtopic: 'Autoencoders',
      explanation: 'It squeezes the input into fewer dimensions.',
    },
    {
      q: 'Second question?',
      choices: ['One', 'Two', 'Three', 'Four'],
      answer_index: 1,
      subtopic: null,
      explanation: null,
    },
  ],
}

let restore: () => void
const vibrate = vi.fn()
beforeEach(() => {
  restore = mockPhone()
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
})
afterEach(() => {
  cleanup()
  restore()
  vi.clearAllMocks()
})

function renderRunner(over: Partial<React.ComponentProps<typeof QuizRunner>> = {}) {
  return render(
    <AssessmentProvider>
      <QuizRunner quiz={QUIZ} onFinished={vi.fn()} onExit={vi.fn()} {...over} />
    </AssessmentProvider>,
  )
}

describe('phone quiz stage', () => {
  it('renders the immersive stage: count, question, four answers, no key legend', () => {
    renderRunner()
    expect(screen.getByTestId('phone-quiz')).toBeInTheDocument()
    expect(screen.getByLabelText('Question 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What does the bottleneck layer do?' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.queryByTestId('key-hints')).not.toBeInTheDocument()
  })

  it('a wrong tap gives the verdict at once, folds the noise away and pins Next', () => {
    renderRunner()
    fireEvent.click(screen.getByRole('radio', { name: /Expands/ }))
    expect(screen.getByText('Not this time.')).toBeInTheDocument()
    expect(screen.getByText('It squeezes the input into fewer dimensions.')).toBeInTheDocument()
    // Only what you picked and what was right stay on screen.
    expect(screen.queryByRole('radio', { name: /Deletes/ })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Compresses/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next/ })).toBeInTheDocument()
    expect(vibrate).toHaveBeenCalled()
  })

  it('the answer is locked once chosen', () => {
    renderRunner()
    fireEvent.click(screen.getByRole('radio', { name: /Compresses/ }))
    expect(screen.getByRole('radio', { name: /Compresses/ })).toBeDisabled()
  })

  it('Next moves on; the last question offers See results and submits', async () => {
    const result: QuizResult = { score: 50, correct: [true, false] } as QuizResult
    submitQuiz.mockResolvedValue(result)
    const onFinished = vi.fn()
    renderRunner({ onFinished })
    fireEvent.click(screen.getByRole('radio', { name: /Compresses/ }))
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByLabelText('Question 2 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /One/ }))
    fireEvent.click(screen.getByRole('button', { name: 'See results' }))
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
    expect(submitQuiz).toHaveBeenCalledWith('q1', [0, 0], expect.any(Number))
  })

  it('closing before answering leaves at once', () => {
    const onExit = vi.fn()
    renderRunner({ onExit })
    fireEvent.click(screen.getByRole('button', { name: 'Leave quiz' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('closing mid-attempt confirms before discarding', () => {
    const onExit = vi.fn()
    renderRunner({ onExit })
    fireEvent.click(screen.getByRole('radio', { name: /Compresses/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave quiz' }))
    expect(onExit).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave quiz' }))
    expect(onExit).toHaveBeenCalled()
  })
})

describe('phone quiz results', () => {
  it('pins Back and Retake as an action pair and keeps the review tabs', () => {
    const onRetake = vi.fn()
    const onBack = vi.fn()
    render(
      <QuizResults
        quiz={QUIZ}
        answers={[1, 1]}
        result={{ score: 50, correct: [], previous_best: 30, attempts: 2 }}
        onRetake={onRetake}
        onBack={onBack}
      />,
    )
    expect(screen.getByTestId('quiz-best-badge')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Missed/ })).toBeInTheDocument()
    const bar = document.querySelector('[data-sticky-action-bar]') as HTMLElement
    expect(bar).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: /Retake/ }))
    fireEvent.click(within(bar).getByRole('button', { name: 'Back' }))
    expect(onRetake).toHaveBeenCalled()
    expect(onBack).toHaveBeenCalled()
  })
})
