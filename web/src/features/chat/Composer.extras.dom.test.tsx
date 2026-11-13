// @vitest-environment jsdom
/**
 * The composer's smaller promises: an image can be sent on its own, a file it
 * will not take is said out loud, `/` lists the commands, starter questions
 * fill the box, and a half-typed question survives a topic switch.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { AssessmentProvider } from '../../lib/assessment'
import { Composer, IMAGE_ONLY_QUESTION } from './Composer'

afterEach(cleanup)

const setup = (props: Partial<React.ComponentProps<typeof Composer>> = {}) =>
  render(
    <ToastProvider>
      <AssessmentProvider>
        <Composer placeholder="Ask…" onSend={vi.fn()} onRunAgent={vi.fn()} {...props} />
      </AssessmentProvider>
    </ToastProvider>,
  )

// A GIF is attached as it is; other types are resized through `Image`, which jsdom never loads.
const gif = (name: string) => new File(['GIF89a'], name, { type: 'image/gif' })
const paste = (files: File[]) => fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files } })

describe('an image with no words', () => {
  it('can be sent, with a plain question standing in for the text', async () => {
    const onSend = vi.fn().mockResolvedValue(true)
    setup({ onSend })
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    paste([gif('slide.gif')])
    await screen.findByRole('button', { name: 'Open slide.gif' })
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask about this image, or just send it')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledWith(IMAGE_ONLY_QUESTION, { images: [expect.stringMatching(/^data:image\/gif/)] })
  })
})

describe('an attachment that is not taken', () => {
  it('says so for a file that is not an image', async () => {
    setup()
    paste([new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' })])
    expect(await screen.findByText('Only PNG, JPEG, WebP or GIF images can be attached here.')).toBeInTheDocument()
  })

  it('says so for a fourth image, and keeps the first three', async () => {
    setup()
    paste([gif('a.gif'), gif('b.gif'), gif('c.gif'), gif('d.gif')])
    expect(await screen.findByText('You can attach up to 3 images to a question.')).toBeInTheDocument()
    expect(await screen.findAllByRole('button', { name: /^Open / })).toHaveLength(3)
  })
})

describe('the command menu', () => {
  it('lists the three commands on "/", moves with the arrows, and Enter takes one', async () => {
    const onRunAgent = vi.fn()
    setup({ onRunAgent })
    const box = screen.getByRole('textbox')
    const user = userEvent.setup()
    await user.type(box, '/')
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      '/notesWrite a note from your files',
      '/quizMake a quiz to test yourself',
      '/flashcardsMake flashcards to review',
    ])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    // Taken into the box, not run: a topic can still be added.
    expect(box).toHaveValue('/quiz ')
    expect(onRunAgent).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(onRunAgent).toHaveBeenCalledWith('quiz', undefined)
  })

  it('narrows as the command is typed, and Escape closes it without clearing the box', async () => {
    setup()
    const box = screen.getByRole('textbox')
    const user = userEvent.setup()
    await user.type(box, '/f')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(box).toHaveValue('/f')
  })

  it('does not open for a slash in the middle of a question', async () => {
    setup()
    await userEvent.setup().type(screen.getByRole('textbox'), 'and/or')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('starter questions and the reading line', () => {
  it('fills the box with the question that was tapped, and sends nothing', async () => {
    const onSend = vi.fn()
    setup({ onSend, examples: ['Summarise the key ideas in my files', 'What might an exam ask about this?'] })
    await userEvent.setup().click(screen.getByRole('button', { name: 'What might an exam ask about this?' }))
    expect(screen.getByRole('textbox')).toHaveValue('What might an exam ask about this?')
    expect(onSend).not.toHaveBeenCalled()
    // Something is in the box now: the starters step aside.
    expect(screen.queryByRole('group', { name: 'Questions to start with' })).not.toBeInTheDocument()
  })

  it('shows the notice it is given and drops it when it is gone', () => {
    const { rerender } = setup({ notice: 'Your file is still being read.' })
    expect(screen.getByRole('status')).toHaveTextContent('Your file is still being read.')
    rerender(
      <ToastProvider>
        <AssessmentProvider>
          <Composer placeholder="Ask…" onSend={vi.fn()} onRunAgent={vi.fn()} />
        </AssessmentProvider>
      </ToastProvider>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('a question typed and not sent', () => {
  it('is still there after the composer is remounted for the same topic, and not for another', async () => {
    setup({ draftKey: 'topic-a' })
    await userEvent.setup().type(screen.getByRole('textbox'), 'half a thought')
    cleanup()
    setup({ draftKey: 'topic-b' })
    expect(screen.getByRole('textbox')).toHaveValue('')
    cleanup()
    setup({ draftKey: 'topic-a' })
    expect(screen.getByRole('textbox')).toHaveValue('half a thought')
  })

  it('is forgotten once it is sent', async () => {
    setup({ draftKey: 'topic-c', onSend: vi.fn().mockResolvedValue(true) })
    await userEvent.setup().type(screen.getByRole('textbox'), 'sent now{Enter}')
    cleanup()
    setup({ draftKey: 'topic-c' })
    expect(screen.getByRole('textbox')).toHaveValue('')
  })
})

describe('the topic strictness toggle', () => {
  it('shows the current choice and switches to the other one', async () => {
    const onScope = vi.fn()
    setup({ scope: 'files', onScope })
    const toggle = screen.getByRole('button', { name: /Answers use only your files/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.setup().click(toggle)
    expect(onScope).toHaveBeenCalledWith('subject')
  })

  it('is not drawn when the screen gives no scope', () => {
    setup()
    expect(screen.queryByRole('button', { name: /Answers use/ })).toBeNull()
  })
})
