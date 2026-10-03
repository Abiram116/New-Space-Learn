// @vitest-environment jsdom
/**
 * The full-page quiz, driven entirely from the keyboard: highlight, choose,
 * advance, leave — and the guards (held keys, typing, a second submit).
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { QuizRunner } from './QuizRunner'
import { AssessmentProvider } from '../../lib/assessment'
import type { Quiz } from '../../api/types'

const submitQuiz = vi.fn()
vi.mock('../../api/quizzes', () => ({
  submitQuiz: (...args: unknown[]) => submitQuiz(...args),
}))

function quiz(): Quiz {
  const q = (n: number) => ({
    q: `Question number ${n}?`,
    choices: [`alpha ${n}`, `beta ${n}`, `gamma ${n}`, `delta ${n}`],
    answer_index: 1,
    subtopic: null,
    explanation: null,
  })
  return { id: 'quiz-k', topic: 'Keys', created_at: new Date().toISOString(), questions: [q(1), q(2)] }
}

function renderRunner(props: Partial<ComponentProps<typeof QuizRunner>> = {}) {
  return render(
    <AssessmentProvider>
      <input aria-label="elsewhere" />
      {/* AppShell keeps this in the page, closed, on every screen. */}
      <div role="dialog" aria-modal="true" aria-hidden="true" aria-label="Navigation" />
      <QuizRunner quiz={quiz()} onFinished={vi.fn()} onExit={vi.fn()} {...props} />
    </AssessmentProvider>,
  )
}

/** keydown on whatever holds focus (bubbling to the window listener).
 *  Returns false when the stage called preventDefault. */
function press(key: string, init: Partial<KeyboardEventInit> = {}) {
  // A person takes a moment to read between presses; `advanceClock = false`
  // is the double-tap case the explanation guard exists for.
  if (!init.repeat && advanceClock) now += 400
  let notPrevented = true
  act(() => {
    notPrevented = fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
  })
  return notPrevented
}

let now = 0
let advanceClock = true

const option = (name: RegExp) => screen.getByRole('radio', { name })

beforeEach(() => {
  now = 1000
  advanceClock = true
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
  vi.clearAllMocks()
})

describe('quiz keyboard', () => {
  it('no highlight until the first arrow, then arrows move a focused ring', () => {
    renderRunner()
    expect(document.querySelector('[data-active]')).toBeNull()

    press('ArrowDown')
    expect(option(/alpha 1/)).toHaveAttribute('data-active')
    expect(option(/alpha 1/)).toHaveFocus()

    press('j')
    expect(option(/beta 1/)).toHaveAttribute('data-active')
    press('ArrowUp')
    press('ArrowUp')
    // Wrapped past the top to the last option.
    expect(option(/delta 1/)).toHaveAttribute('data-active')
  })

  it('Enter chooses the highlighted option, then Enter again moves on', () => {
    renderRunner()
    press('ArrowDown')
    press('ArrowDown')
    press('Enter')
    expect(option(/beta 1/)).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Correct.')).toBeInTheDocument()

    press('Enter')
    expect(screen.getByRole('heading', { name: 'Question number 2?' })).toBeInTheDocument()
    // New question, no carried-over highlight.
    expect(document.querySelector('[data-active]')).toBeNull()
  })

  it('Space works like Enter and never scrolls the page', () => {
    renderRunner()
    expect(press(' ')).toBe(false) // highlight A, default prevented
    expect(press(' ')).toBe(false) // choose A
    expect(option(/alpha 1/)).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Not this time.')).toBeInTheDocument()
  })

  it('1–4 and A–D answer directly', () => {
    renderRunner()
    press('3')
    expect(option(/gamma 1/)).toHaveAttribute('aria-checked', 'true')
    press('Enter')
    press('b')
    expect(option(/beta 2/)).toHaveAttribute('aria-checked', 'true')
  })

  it('a held key cannot answer or advance twice', () => {
    renderRunner()
    press('2')
    // Holding Enter: only the first, non-repeat press counts.
    press('Enter')
    press('Enter', { repeat: true })
    press('Enter', { repeat: true })
    expect(screen.getByRole('heading', { name: 'Question number 2?' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('keys do nothing while typing in a field', () => {
    renderRunner()
    const field = screen.getByRole('textbox', { name: 'elsewhere' })
    field.focus()
    expect(press('1')).toBe(true)
    expect(press(' ')).toBe(true)
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('Esc asks before leaving, and only the confirm leaves', async () => {
    const onExit = vi.fn()
    renderRunner({ onExit })
    press('Escape')
    expect(onExit).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Leave this quiz?' })).toBeInTheDocument()

    // While the dialog is open the stage ignores keys.
    press('1')
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Leave quiz' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('in the leave dialog ← / → move between Cancel and Leave, stopping at the ends', () => {
    renderRunner()
    press('Escape')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const leave = screen.getByRole('button', { name: 'Leave quiz' })
    expect(cancel).toHaveFocus()
    expect(press('ArrowRight')).toBe(false) // handled, not left to scroll anything
    expect(leave).toHaveFocus()
    press('ArrowRight')
    expect(leave).toHaveFocus() // an end is an end
    press('ArrowLeft')
    expect(cancel).toHaveFocus()
  })

  it('on the last question Enter submits once, however often it is pressed', async () => {
    let resolve: (v: unknown) => void = () => {}
    submitQuiz.mockReturnValue(new Promise((r) => (resolve = r)))
    const onFinished = vi.fn()
    renderRunner({ onFinished })
    press('2')
    press('Enter')
    press('2')
    press('Enter')
    press('Enter')
    press(' ')
    expect(submitQuiz).toHaveBeenCalledTimes(1)
    expect(submitQuiz.mock.calls[0][1]).toEqual([1, 1])
    await act(async () => resolve({ score: 100, correct: 2, total: 2, review: [] }))
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1))
  })

  it('shows a legend of the keys', () => {
    renderRunner()
    expect(screen.getByTestId('key-hints')).toHaveTextContent(/Choose/)
    press('1')
    expect(screen.getByTestId('key-hints')).toHaveTextContent(/Next question/)
  })

  it('the compact dock runner does not bind the page keyboard', () => {
    renderRunner({ compact: true })
    press('1')
    expect(screen.queryByText('Not this time.')).not.toBeInTheDocument()
  })

  it('a double-tap cannot skip the explanation, but → and n go on once it has been read', () => {
    renderRunner()
    press('ArrowDown')
    press('Enter') // choose
    expect(screen.getByText(/Question number 1\?/)).toBeTruthy()
    advanceClock = false
    press('Enter') // straight away: too quick to have read anything
    expect(screen.getByText(/Question number 1\?/)).toBeTruthy()
    advanceClock = true
    press('ArrowRight')
    expect(screen.getByText(/Question number 2\?/)).toBeTruthy()
  })
})
