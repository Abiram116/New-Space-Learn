// @vitest-environment jsdom
/**
 * Layout regression for the dock (`compact`) reveal screen.
 *
 * Reported bug: after answering, the verdict panel and the Next button
 * appeared pinned near the bottom of the panel with a large dead gap above
 * them, regardless of how short the question/choices/explanation were. Cause
 * traced to the question `Leaf`: it carried `flex-1 overflow-y-auto` in
 * compact mode, which made it forcibly consume all vertical space available
 * in the dock's own already-scrollable panel — content that didn't need that
 * space just left it empty, and the verdict + Next button rendered wherever
 * that oversized Leaf happened to end.
 *
 * The fix removes that forced growth so Leaf sizes to its own content and
 * the verdict/Next follow it in ordinary top-down flow — the surrounding
 * panel (`QuizzesPanel.tsx`) already scrolls, so nothing here needs its own
 * scroll container. This test asserts the actual Tailwind classes responsible
 * (jsdom doesn't compute real flex geometry, so the class names are the
 * fastest, most direct way to pin the specific mechanism down) and that the
 * verdict/Next genuinely follow the choices in DOM order at every content
 * length.
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentProps } from 'react'
import { QuizRunner } from './QuizRunner'
import { AssessmentProvider } from '../../lib/assessment'
import type { Quiz } from '../../api/types'

function renderRunner(props: ComponentProps<typeof QuizRunner>) {
  return render(
    <AssessmentProvider>
      <QuizRunner {...props} />
    </AssessmentProvider>,
  )
}

function quiz(explanation: string | null): Quiz {
  // Two questions, not one — with a single question `isLast` is true on the
  // very first answer and the button reads "See results" instead of "Next",
  // which isn't what the reported bug (question 3 of 5) or this test's
  // "Next" assertions are about.
  const question = {
    q: 'What is the purpose of the bottleneck layer in an autoencoder?',
    choices: [
      'To increase the dimensionality of the input data',
      'To learn a compact and meaningful representation of the input data',
      'To reconstruct the original input data',
      'To map the input data to a higher-dimensional space',
    ],
    answer_index: 1,
    subtopic: 'Bottleneck Layer',
    explanation,
  }
  return {
    id: 'quiz-1',
    topic: 'Autoencoders',
    created_at: new Date().toISOString(),
    questions: [question, { ...question, explanation: null }],
  }
}

describe('QuizRunner compact-mode reveal layout', () => {
  afterEach(cleanup)

  it('the question Leaf no longer forces growth/scroll in compact mode', async () => {
    const user = userEvent.setup()
    renderRunner({
      compact: true,
      quiz: quiz('You understand that the bottleneck layer is the layer with the lowest number of dimensions.'),
      onFinished: () => {},
      onExit: () => {},
    })

    // Answering reveals the verdict — the state this bug only showed up in.
    await user.click(screen.getByRole('button', { name: /learn a compact and meaningful/i }))

    const leaf = document.querySelector('.leaf')
    expect(leaf).not.toBeNull()
    expect(leaf?.className).not.toMatch(/\bflex-1\b/)
    expect(leaf?.className).not.toMatch(/overflow-y-auto/)
  })

  it('the verdict and Next button follow the choices in document order, long or short explanation', async () => {
    const user = userEvent.setup()
    const { unmount } = renderRunner({
      compact: true,
      quiz: quiz('Short.'),
      onFinished: () => {},
      onExit: () => {},
    })
    // A wrong pick, matching the reported bug — the miss path is the one
    // with real content (the answer, explanation, subtopic), so it's the
    // one worth proving stays in natural document order.
    await user.click(screen.getByRole('button', { name: /increase the dimensionality/i }))

    const order = elementOrder(['Not this time.', 'Short.', 'Next'])
    expect(order).toEqual(['Not this time.', 'Short.', 'Next'])
    unmount()

    const longExplanation = 'This is a much longer explanation. '.repeat(20)
    renderRunner({
      compact: true,
      quiz: quiz(longExplanation),
      onFinished: () => {},
      onExit: () => {},
    })
    await user.click(screen.getByRole('button', { name: /learn a compact and meaningful/i }))
    expect(screen.getByRole('button', { name: /^Next/ })).toBeInTheDocument()
    expect(screen.getByText(longExplanation.trim(), { exact: false })).toBeInTheDocument()
  })
})

/** Document position (compareDocumentPosition-based) of each piece of text,
 *  by finding the element that contains it. */
function elementOrder(texts: string[]): string[] {
  const found = texts.map((t) => ({ t, el: screen.getByText(t, { exact: false }) }))
  return [...found]
    .sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el)
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1
      return 0
    })
    .map((f) => f.t)
}
