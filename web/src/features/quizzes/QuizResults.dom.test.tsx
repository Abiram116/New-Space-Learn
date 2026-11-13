// @vitest-environment jsdom
/**
 * The personal-best badge on the results screen. The server decides what the
 * best was (`previous_best`, `attempts`); this pins what the screen does with
 * it: a badge only for a strictly higher score with an earlier attempt behind
 * it, a quiet "Best" line for any later attempt, and nothing on a first one.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Quiz, QuizResult } from '../../api/types'

const celebrateQuiz = vi.fn()

vi.mock('../../components/celebrate', () => ({
  celebrateQuiz: (...args: unknown[]) => celebrateQuiz(...args),
  useAmbience: () => ({ progress: vi.fn(), pulse: vi.fn() }),
}))

import { QuizResults } from './QuizResults'

const QUIZ: Quiz = {
  id: 'quiz-1',
  topic: 'Attention',
  created_at: new Date().toISOString(),
  questions: [0, 1, 2, 3, 4].map((i) => ({
    q: `Question ${i}`,
    choices: ['a', 'b', 'c', 'd'],
    answer_index: 0,
  })),
}

function show(result: Partial<QuizResult> & Pick<QuizResult, 'score'>, right = 4) {
  return render(
    <QuizResults
      quiz={QUIZ}
      answers={[0, 0, 0, 0, 0].map((a, i) => (i < right ? a : 1))}
      result={{ correct: [], ...result }}
      onRetake={vi.fn()}
      onBack={vi.fn()}
    />,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('personal best badge', () => {
  it('first attempt: neither badge nor line, and no best moment', () => {
    show({ score: 80, previous_best: null, attempts: 1 })
    expect(screen.queryByTestId('quiz-best-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('quiz-best-line')).not.toBeInTheDocument()
    expect(celebrateQuiz.mock.calls[0][0].previousBest).toBeNull()
  })

  it('a strictly higher score shows the badge with both numbers', () => {
    show({ score: 80, previous_best: 60, attempts: 2 })
    expect(screen.getByTestId('quiz-best-badge')).toHaveTextContent(
      'New best! 60% → 80%',
    )
    expect(screen.queryByTestId('quiz-best-line')).not.toBeInTheDocument()
    expect(celebrateQuiz.mock.calls[0][0]).toMatchObject({ score: 80, previousBest: 60 })
  })

  it('an improvement from 0% is still a best', () => {
    show({ score: 20, previous_best: 0, attempts: 2 }, 1)
    expect(screen.getByTestId('quiz-best-badge')).toHaveTextContent('0% → 20%')
  })

  it('an equal score is not a best: quiet line only', () => {
    show({ score: 80, previous_best: 80, attempts: 3 })
    expect(screen.queryByTestId('quiz-best-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('quiz-best-line')).toHaveTextContent('Best: 80% · try 3')
  })

  it('a lower score keeps the standing best in the quiet line', () => {
    show({ score: 60, previous_best: 80, attempts: 4 }, 3)
    expect(screen.queryByTestId('quiz-best-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('quiz-best-line')).toHaveTextContent('Best: 80% · try 4')
  })

  it('a result without the server facts (older API) says nothing', () => {
    show({ score: 80 })
    expect(screen.queryByTestId('quiz-best-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('quiz-best-line')).not.toBeInTheDocument()
  })
})
