// @vitest-environment jsdom
/**
 * The 2026-08 UX audit found a real dead end: a failed `submitQuiz` replaced
 * the *entire* runner (including `ProgressHeader`'s "Leave") with a static
 * error box and nothing else — no retry, so a fully-answered quiz was only
 * recoverable by abandoning the attempt. It also found "Leave" had no guard
 * against clicking it while a submission was in flight, which could abandon
 * a request that goes on to succeed server-side with no way to ever see
 * that score.
 *
 * Both fixed in the same pass: the error now renders inline (ProgressHeader
 * and "Leave" stay mounted) with the action button relabelled "Try again",
 * reusing the same answers already in state; and "Leave" disables for as
 * long as a submission is outstanding.
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

function renderRunner(props: Partial<ComponentProps<typeof QuizRunner>> = {}) {
  return render(
    <AssessmentProvider>
      <QuizRunner
        quiz={quiz()}
        onFinished={vi.fn()}
        onExit={vi.fn()}
        {...props}
      />
    </AssessmentProvider>,
  )
}

// One question, so the very first answer is already the last — the shortest
// path to the submit button both tests need.
function quiz(): Quiz {
  return {
    id: 'quiz-1',
    topic: 'Bottleneck layer',
    created_at: new Date().toISOString(),
    questions: [
      {
        q: 'What does the bottleneck layer do?',
        choices: ['Compresses', 'Expands', 'Deletes', 'Duplicates'],
        answer_index: 0,
        subtopic: null,
        explanation: null,
      },
    ],
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a failed submission is recoverable, not a dead end', () => {
  it('shows the error inline, alongside a retry button, with Leave still reachable', async () => {
    submitQuiz.mockRejectedValue(new Error('network error'))
    const user = userEvent.setup()
    renderRunner()

    await user.click(screen.getByRole('button', { name: /Compresses/ }))
    await user.click(screen.getByRole('button', { name: 'See results' }))

    await waitFor(() => expect(submitQuiz).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("network error")).toBeInTheDocument()
    // The dead end this fixes: ProgressHeader (and its "Leave") used to be
    // replaced entirely by the error box.
    expect(screen.getByRole('button', { name: /Leave/ })).toBeInTheDocument()
  })

  it('"Try again" resubmits the same answers, and can succeed', async () => {
    submitQuiz.mockRejectedValueOnce(new Error('network error'))
    submitQuiz.mockResolvedValueOnce({ score: 100, correct: 1, total: 1, review: [] })
    const onFinished = vi.fn()
    const user = userEvent.setup()
    renderRunner({ onFinished })

    await user.click(screen.getByRole('button', { name: /Compresses/ }))
    await user.click(screen.getByRole('button', { name: 'See results' }))
    await screen.findByText("network error")

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(submitQuiz).toHaveBeenCalledTimes(2))
    // Same answers both times — the retry didn't lose or reset anything.
    expect(submitQuiz.mock.calls[1][1]).toEqual(submitQuiz.mock.calls[0][1])
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
  })
})

describe('"Leave" cannot abandon an in-flight submission unnoticed', () => {
  it('disables Leave while the score request is outstanding', async () => {
    let resolveSubmit: (v: unknown) => void = () => {}
    submitQuiz.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve }))
    const user = userEvent.setup()
    renderRunner()

    await user.click(screen.getByRole('button', { name: /Compresses/ }))
    await user.click(screen.getByRole('button', { name: 'See results' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Leave/ })).toBeDisabled())

    resolveSubmit({ score: 100, correct: 1, total: 1, review: [] })
  })

  it('Leave is enabled before submitting and again after it resolves', async () => {
    submitQuiz.mockResolvedValue({ score: 100, correct: 1, total: 1, review: [] })
    const user = userEvent.setup()
    renderRunner()

    expect(screen.getByRole('button', { name: /Leave/ })).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: /Compresses/ }))
    await user.click(screen.getByRole('button', { name: 'See results' }))

    await waitFor(() => expect(submitQuiz).toHaveBeenCalled())
  })
})
