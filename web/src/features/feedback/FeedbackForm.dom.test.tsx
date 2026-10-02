// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackQuestion } from '../../api/productFeedback'
import { ApiError } from '../../api/errors'

let session: object | null = null
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ session }) }))

const getFeedbackForm = vi.fn()
const sendProductFeedback = vi.fn()
vi.mock('../../api/productFeedback', () => ({
  getFeedbackForm: () => getFeedbackForm(),
  sendProductFeedback: (input: unknown) => sendProductFeedback(input),
}))

import { FeedbackForm, isBlank, missingRequired } from './FeedbackForm'
import { parseOptions } from '../admin/Questions'

const q = (over: Partial<FeedbackQuestion>): FeedbackQuestion => ({
  id: 'x', position: 0, prompt: 'Q?', kind: 'short', options: [], detail_options: [], required: true, active: true, ...over,
})
const QUESTIONS: FeedbackQuestion[] = [
  q({ id: 'rate', prompt: 'Overall?', kind: 'rating' }),
  q({ id: 'use', prompt: 'Use it for?', kind: 'choice', options: ['Notes', 'Quizzes'] }),
  q({ id: 'liked', prompt: 'Liked?', kind: 'multi', options: ['Speed', 'Design'] }),
  q({ id: 'nps', prompt: 'Recommend?', kind: 'scale' }),
  q({ id: 'next', prompt: 'Next?', kind: 'short' }),
  q({ id: 'more', prompt: 'Anything else?', kind: 'long', required: false }),
]

beforeEach(() => {
  session = null
  getFeedbackForm.mockResolvedValue(QUESTIONS)
  sendProductFeedback.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** The rating and the 0–10 scale both have a "4": look inside the right question. */
const pick = (question: string, label: string) =>
  within(screen.getByRole('radiogroup', { name: question })).getByRole('radio', { name: label })

async function answerEverything() {
  await screen.findByText('Overall?')
  fireEvent.click(pick('Overall?', '4'))
  fireEvent.click(pick('Use it for?', 'Notes'))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Speed' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Design' }))
  fireEvent.click(pick('Recommend?', '9'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Next?' }), { target: { value: '  Offline mode  ' } })
}

describe('FeedbackForm', () => {
  it('draws each question by its kind, numbered, and marks the optional one', async () => {
    render(<FeedbackForm source="settings" />)
    await screen.findByText('Overall?')
    expect(screen.getByRole('radiogroup', { name: 'Overall?' }).querySelectorAll('[role=radio]')).toHaveLength(5)
    expect(screen.getByRole('radiogroup', { name: 'Recommend?' }).querySelectorAll('[role=radio]')).toHaveLength(11)
    expect(screen.getByRole('group', { name: 'Liked?' }).querySelectorAll('[role=checkbox]')).toHaveLength(2)
    expect(screen.getByRole('textbox', { name: 'Anything else?' }).tagName).toBe('TEXTAREA')
    expect(screen.getByText('optional')).toBeInTheDocument()
  })

  it('will not send until every required question is answered, and says which', async () => {
    render(<FeedbackForm source="settings" />)
    await screen.findByText('Overall?')
    fireEvent.click(pick('Overall?', '4'))
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(sendProductFeedback).not.toHaveBeenCalled()
    expect(screen.getAllByText('Please answer this one.')).toHaveLength(4)
    expect(screen.getByText('4 questions still need an answer.')).toBeInTheDocument()
    // Answering one clears its message.
    fireEvent.click(pick('Use it for?', 'Notes'))
    expect(screen.getAllByText('Please answer this one.')).toHaveLength(3)
  })

  it('sends typed, trimmed answers and leaves the optional blank out', async () => {
    render(<FeedbackForm source="landing" />)
    await answerEverything()
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await screen.findByText('Thank you. We read every one.')
    const sent = sendProductFeedback.mock.calls[0][0]
    expect(sent.source).toBe('landing')
    expect(sent.answers).toEqual([
      { question_id: 'rate', value: 4 },
      { question_id: 'use', value: 'Notes' },
      { question_id: 'liked', value: ['Speed', 'Design'] },
      { question_id: 'nps', value: 9 },
      { question_id: 'next', value: 'Offline mode' },
    ])
    expect(sent.website).toBe('') // the bot trap, untouched by a person
  })

  it('opens a "tell us more" box only for a choice that asks, and sends what was typed', async () => {
    getFeedbackForm.mockResolvedValue(
      QUESTIONS.map((x) => (x.id === 'use' ? { ...x, detail_options: ['Quizzes'] } : x)),
    )
    render(<FeedbackForm source="settings" />)
    await answerEverything()
    expect(screen.queryByLabelText('Use it for? — tell us more')).toBeNull()

    fireEvent.click(pick('Use it for?', 'Quizzes'))
    fireEvent.change(screen.getByLabelText('Use it for? — tell us more'), { target: { value: ' the timer froze ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(sendProductFeedback).toHaveBeenCalled())
    const sent = sendProductFeedback.mock.calls[0][0].answers
    expect(sent.find((a: { question_id: string }) => a.question_id === 'use')).toEqual({
      question_id: 'use', value: 'Quizzes', detail: 'the timer froze',
    })
    expect(sent.find((a: { question_id: string }) => a.question_id === 'rate')).toEqual({ question_id: 'rate', value: 4 })
  })

  it('asks a signed-out visitor for an optional reply address, and never a signed-in user', async () => {
    const { unmount } = render(<FeedbackForm source="landing" />)
    await answerEverything()
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: ' me@uni.test ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() => expect(sendProductFeedback).toHaveBeenCalled())
    expect(sendProductFeedback.mock.calls[0][0].contact_email).toBe('me@uni.test')
    unmount()

    session = { user: {} }
    render(<FeedbackForm source="settings" />)
    await screen.findByText('Overall?')
    expect(screen.queryByPlaceholderText('you@example.com')).toBeNull()
  })

  it('keeps every answer when sending fails', async () => {
    sendProductFeedback.mockRejectedValue(new ApiError('rate_limited', "You've sent feedback a few times already.", 429))
    render(<FeedbackForm source="settings" />)
    await answerEverything()
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(await screen.findByText("You've sent feedback a few times already.")).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Next?' })).toHaveValue('  Offline mode  ')
    expect(pick('Overall?', '4')).toHaveAttribute('aria-checked', 'true')
  })

  it('"Send another" brings back an empty form', async () => {
    render(<FeedbackForm source="settings" />)
    await answerEverything()
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send another' }))
    expect(pick('Overall?', '4')).toHaveAttribute('aria-checked', 'false')
  })

  it('offers a retry when the questions cannot be loaded', async () => {
    getFeedbackForm.mockRejectedValueOnce(new ApiError('network', "Can't reach the server.", 0))
    render(<FeedbackForm source="settings" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Overall?')).toBeInTheDocument()
  })
})

describe('helpers', () => {
  it('isBlank', () => {
    expect([undefined, '', '   ', []].every((v) => isBlank(v as never))).toBe(true)
    expect([0, 5, 'x', ['a']].some((v) => isBlank(v as never))).toBe(false) // 0 is an answer
  })
  it('missingRequired lists the gaps in order and ignores optional ones', () => {
    expect(missingRequired(QUESTIONS, { rate: 3, nps: 0 })).toEqual(['use', 'liked', 'next'])
  })
  it('parseOptions: one per line, trimmed, unique, no blanks', () => {
    expect(parseOptions(' Maths \n\nPhysics\nMaths\n  ')).toEqual(['Maths', 'Physics'])
  })
})
