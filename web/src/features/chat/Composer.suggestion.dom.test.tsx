// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { AssessmentProvider, useAssessmentLock } from '../../lib/assessment'
import { Composer } from './Composer'

afterEach(cleanup)

const setup = (props: Partial<React.ComponentProps<typeof Composer>> = {}) =>
  render(
    <ToastProvider>
      <AssessmentProvider>
        <Composer placeholder="Ask…" onSend={vi.fn()} onRunAgent={vi.fn()} suggestion="What are the key terms?" {...props} />
      </AssessmentProvider>
    </ToastProvider>,
  )

function Lock() {
  useAssessmentLock('quiz')
  return null
}

describe('Composer suggestion', () => {
  it('shows the question where the text goes; the right arrow fills it in and does not send', async () => {
    const onSend = vi.fn()
    setup({ onSend })
    const box = screen.getByRole('textbox')
    expect(box).toHaveAttribute('placeholder', 'What are the key terms?')
    box.focus()
    await userEvent.setup().keyboard('{ArrowRight}')
    expect(box).toHaveValue('What are the key terms?')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('goes back to the plain placeholder while an answer is arriving, and when there is nothing to offer', () => {
    setup({ streaming: true })
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask…')
    cleanup()
    setup({ suggestion: undefined })
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask…')
  })

  it('shows a key hint that fills the box when clicked, and does not send', async () => {
    const onSend = vi.fn()
    setup({ onSend })
    const hint = screen.getByRole('button', { name: 'Use this suggestion' })
    await userEvent.setup().click(hint)
    expect(screen.getByRole('textbox')).toHaveValue('What are the key terms?')
    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(onSend).not.toHaveBeenCalled()
    // Taken: there is text in the box now, so the hint is gone.
    expect(screen.queryByRole('button', { name: 'Use this suggestion' })).not.toBeInTheDocument()
  })

  it('hides the key hint once text is typed', async () => {
    setup()
    await userEvent.setup().type(screen.getByRole('textbox'), 'h')
    expect(screen.queryByRole('button', { name: 'Use this suggestion' })).not.toBeInTheDocument()
  })

  it.each([
    ['there is no suggestion', { suggestion: undefined }],
    ['an answer is arriving', { streaming: true }],
    ['the composer is disabled', { disabled: true }],
  ])('shows no key hint when %s', (_, props) => {
    setup(props)
    expect(screen.queryByRole('button', { name: 'Use this suggestion' })).not.toBeInTheDocument()
  })

  it('shows no key hint while chat is locked for a quiz', () => {
    render(
      <ToastProvider>
        <AssessmentProvider>
          <Lock />
          <Composer placeholder="Ask…" onSend={vi.fn()} onRunAgent={vi.fn()} suggestion="What are the key terms?" />
        </AssessmentProvider>
      </ToastProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Use this suggestion' })).not.toBeInTheDocument()
  })
})

describe('Composer sending', () => {
  it('does not send a second question with Enter while an answer is arriving, and keeps what was typed', async () => {
    const onSend = vi.fn()
    setup({ onSend, streaming: true, suggestion: undefined })
    const box = screen.getByRole('textbox')
    await userEvent.setup().type(box, 'and what about meiosis?{Enter}')
    expect(onSend).not.toHaveBeenCalled()
    expect(box).toHaveValue('and what about meiosis?')
  })

  it('puts the question back when it was not taken (out of answers, offline)', async () => {
    const onSend = vi.fn().mockResolvedValue(false)
    setup({ onSend, suggestion: undefined })
    const box = screen.getByRole('textbox')
    await userEvent.setup().type(box, 'What is osmosis?{Enter}')
    expect(onSend).toHaveBeenCalledWith('What is osmosis?', { images: [] })
    await vi.waitFor(() => expect(box).toHaveValue('What is osmosis?'))
  })

  it('leaves the box empty after a question that was taken', async () => {
    const onSend = vi.fn().mockResolvedValue(true)
    setup({ onSend, suggestion: undefined })
    const box = screen.getByRole('textbox')
    await userEvent.setup().type(box, 'What is osmosis?{Enter}')
    await Promise.resolve()
    expect(box).toHaveValue('')
  })

  it('treats a slash command as a whole word: "/quizzes are hard" is a question', async () => {
    const onSend = vi.fn()
    const onRunAgent = vi.fn()
    setup({ onSend, onRunAgent, suggestion: undefined })
    const box = screen.getByRole('textbox')
    const user = userEvent.setup()
    await user.type(box, '/quizzes are hard, why?{Enter}')
    expect(onRunAgent).not.toHaveBeenCalled()
    expect(onSend).toHaveBeenCalledWith('/quizzes are hard, why?', { images: [] })
    await user.type(box, '/quiz cell division{Enter}')
    expect(onRunAgent).toHaveBeenCalledWith('quiz', 'cell division')
    await user.type(box, '/notes{Enter}')
    expect(onRunAgent).toHaveBeenLastCalledWith('notes', undefined)
  })
})
