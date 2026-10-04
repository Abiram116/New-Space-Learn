// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssessmentProvider } from '../../lib/assessment'
import { Composer } from './Composer'

afterEach(cleanup)

const setup = (props: Partial<React.ComponentProps<typeof Composer>> = {}) =>
  render(
    <AssessmentProvider>
      <Composer placeholder="Ask…" onSend={vi.fn()} onRunAgent={vi.fn()} suggestion="What are the key terms?" {...props} />
    </AssessmentProvider>,
  )

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
})
