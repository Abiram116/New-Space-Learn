// @vitest-environment jsdom
/**
 * Sending, when it does not go to plan: refused before it starts (today's free
 * answers used up), broken part-way, and a second Enter while an answer is
 * still arriving. In each the question must not be lost or doubled.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/errors'
import type { ChatStreamEvent } from '../../api/chat'
import type { Space, Subspace } from '../../api/types'
import { ToastProvider } from '../../components/ui/Toast'
import { AssessmentProvider } from '../../lib/assessment'

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

const chat = vi.hoisted(() => ({ listMessages: vi.fn(), streamChat: vi.fn(), getStarters: vi.fn(async () => ({ questions: [] as string[] })) }))
vi.mock('../../api/chat', () => chat)
const docsApi = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  getPassage: vi.fn(),
  deleteDocument: vi.fn(),
  reprocessDocument: vi.fn(),
  uploadDocument: vi.fn(),
}))
vi.mock('../../api/documents', () => docsApi)
vi.mock('../../api/feedback', () => ({
  listPreferences: vi.fn().mockResolvedValue([]),
  sendFeedback: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('../../api/skills', async (orig) => ({
  ...(await orig<typeof import('../../api/skills')>()),
  listActiveSkills: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({
    space: { id: 'space-1', name: 'Biology', tone: 'brand' } as Space,
    subspace: { id: 'sub-1', subject_id: 'space-1', name: 'Cells' } as Subspace,
    base: '/bio/cells',
  }),
}))
vi.mock('../../lib/useIsMobile', () => ({ useIsMobile: () => false }))
// Below `lg`: the chat column alone, without the sidebar and its own requests.
vi.mock('../../lib/useMediaQuery', () => ({ LG_QUERY: '(min-width: 1024px)', useMediaQuery: () => false }))

import { ChatView } from './ChatView'

const mount = async () => {
  render(
    <MemoryRouter>
      <ToastProvider>
        <AssessmentProvider>
          <ChatView />
        </AssessmentProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
  return await screen.findByRole('textbox')
}

const bubbles = () => [...document.querySelectorAll('[id^="msg-"]')].map((el) => el.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  chat.listMessages.mockResolvedValue([])
  docsApi.listDocuments.mockResolvedValue([])
  // A question handed back to the box is kept as this topic's draft.
  sessionStorage.clear()
})
afterEach(cleanup)

describe('a question that is refused before it starts', () => {
  it('says why, takes the bubble back out, and returns the words to the box', async () => {
    // eslint-disable-next-line require-yield
    chat.streamChat.mockImplementation(async function* (): AsyncGenerator<ChatStreamEvent> {
      throw new ApiError('rate_limited', 'You’ve used today’s 30 free answers. They reset at midnight.', 429)
    })
    const box = await mount()
    await userEvent.setup().type(box, 'What is osmosis?{Enter}')

    expect(await screen.findByText(/used today’s 30 free answers/)).toBeInTheDocument()
    await waitFor(() => expect(box).toHaveValue('What is osmosis?'))
    expect(bubbles()).toEqual([])
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument()
    // The box is usable again: Send, not Stop.
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
  })
})

describe('an answer that breaks part-way', () => {
  it('keeps the question in the thread (the server has it) and leaves the box empty', async () => {
    chat.streamChat.mockImplementation(async function* (): AsyncGenerator<ChatStreamEvent> {
      yield { type: 'token', delta: 'Osmosis is' }
      yield { type: 'error', code: 'upstream_unavailable', message: 'The AI is at capacity. Try again in a minute.' }
    })
    const box = await mount()
    await userEvent.setup().type(box, 'What is osmosis?{Enter}')

    expect(await screen.findByText(/The AI is at capacity/)).toBeInTheDocument()
    expect(bubbles()).toEqual(['What is osmosis?'])
    expect(box).toHaveValue('')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument())
  })
})

describe('Enter while an answer is still arriving', () => {
  it('does not start a second answer over the first; the new question waits in the box', async () => {
    let finish!: () => void
    const gate = new Promise<void>((r) => (finish = r))
    chat.streamChat.mockImplementation(async function* (): AsyncGenerator<ChatStreamEvent> {
      yield { type: 'token', delta: 'Osmosis is the movement of water.' }
      await gate
      yield { type: 'done', messageId: 'm1', userMessageId: 'u1', citations: [], content: null, suggestion: null }
    })
    const box = await mount()
    const user = userEvent.setup()
    await user.type(box, 'What is osmosis?{Enter}')
    await screen.findByRole('button', { name: 'Stop generating' })

    await user.type(box, 'And diffusion?{Enter}')
    expect(chat.streamChat).toHaveBeenCalledTimes(1)
    expect(box).toHaveValue('And diffusion?')
    expect(bubbles()).toEqual(['What is osmosis?'])

    finish()
    await screen.findByRole('button', { name: 'Send message' })
    expect(await screen.findByText('Osmosis is the movement of water.')).toBeInTheDocument()
    // Now it goes.
    await user.type(box, '{Enter}')
    await waitFor(() => expect(chat.streamChat).toHaveBeenCalledTimes(2))
  })
})

describe('a question left without an answer', () => {
  it('offers Try again after an answer breaks part-way, and asks again without a second bubble', async () => {
    chat.streamChat.mockImplementationOnce(async function* (): AsyncGenerator<ChatStreamEvent> {
      yield { type: 'token', delta: 'Osmosis is' }
      yield { type: 'error', code: 'upstream_unavailable', message: 'The AI is at capacity. Try again in a minute.' }
    })
    const box = await mount()
    const user = userEvent.setup()
    await user.type(box, 'What is osmosis?{Enter}')

    chat.streamChat.mockImplementationOnce(async function* (): AsyncGenerator<ChatStreamEvent> {
      yield { type: 'token', delta: 'Osmosis is the movement of water.' }
      yield { type: 'done', messageId: 'm1', userMessageId: 'u1', citations: [], content: null, suggestion: null }
    })
    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Osmosis is the movement of water.')).toBeInTheDocument()
    // The same question, marked as another go at it: the server does not store it twice.
    expect(chat.streamChat.mock.calls[1].slice(1, 4)).toEqual(['What is osmosis?', expect.anything(), true])
    expect(bubbles()).toEqual(['What is osmosis?'])
    // Answered now, so there is nothing left to retry.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument())
  })

  it('after Stop, keeps what was written with a Copy, and offers Try again', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    chat.streamChat.mockImplementation(async function* (
      _id: string,
      _text: string,
      signal: AbortSignal,
    ): AsyncGenerator<ChatStreamEvent> {
      yield { type: 'token', delta: 'Osmosis is the movement' }
      await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    })
    const box = await mount()
    const user = userEvent.setup()
    // After `setup()`, which installs its own clipboard.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await user.type(box, 'What is osmosis?{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Stop generating' }))

    expect(await screen.findByText('Osmosis is the movement')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy answer' }))
    expect(writeText).toHaveBeenCalledWith('Osmosis is the movement')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('an empty chat', () => {
  const file = (status: string) => ({
    id: 'd1',
    name: 'cells.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    status,
    error: null,
    created_at: '2026-09-01T00:00:00Z',
    ready_at: null,
  })

  it('with a file that is ready, offers questions named for the topic; tapping one fills the box', async () => {
    docsApi.listDocuments.mockResolvedValue([file('ready')])
    const box = await mount()
    const starters = await screen.findByRole('group', { name: 'Questions to start with' })
    // No file-derived questions yet, so they are built from the topic's own name, not generic filler.
    expect(starters.querySelectorAll('button')).toHaveLength(4)
    await userEvent.setup().click(screen.getByRole('button', { name: 'What is Cells?' }))
    expect(box).toHaveValue('What is Cells?')
    expect(chat.streamChat).not.toHaveBeenCalled()
  })

  it('says a file is still being read, and stops saying it once the file is ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      docsApi.listDocuments.mockResolvedValueOnce([file('processing')]).mockResolvedValue([file('ready')])
      await mount()
      const line = 'Your file is still being read. Answers will use it once it’s ready.'
      expect(await screen.findByText(line)).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'Questions to start with' })).not.toBeInTheDocument()
      // No sidebar at this width, so the chat checks again by itself.
      await vi.advanceTimersByTimeAsync(4100)
      await waitFor(() => expect(screen.queryByText(line)).not.toBeInTheDocument())
    } finally {
      vi.useRealTimers()
    }
  })
})


describe('Try again on an answer that was given', () => {
  const answer = (text: string, id: string) =>
    async function* (): AsyncGenerator<ChatStreamEvent> {
      yield { type: 'token', delta: text }
      yield { type: 'done', messageId: id, userMessageId: 'u1', citations: [], content: null, suggestion: null }
    }

  it('replaces the old answer instead of stacking a second one under it', async () => {
    chat.streamChat.mockImplementationOnce(answer('First answer about osmosis.', 'm1'))
    const box = await mount()
    const user = userEvent.setup()
    await user.type(box, 'What is osmosis?{Enter}')
    expect(await screen.findByText('First answer about osmosis.')).toBeInTheDocument()

    chat.streamChat.mockImplementationOnce(answer('Second, better answer.', 'm2'))
    await user.click(await screen.findByRole('button', { name: 'Try that again' }))

    expect(await screen.findByText('Second, better answer.')).toBeInTheDocument()
    expect(screen.queryByText('First answer about osmosis.')).not.toBeInTheDocument()
    expect(bubbles()).toEqual(['What is osmosis?'])
  })

  it('keeps the old answer when the new attempt fails', async () => {
    chat.streamChat.mockImplementationOnce(answer('First answer about osmosis.', 'm1'))
    const box = await mount()
    const user = userEvent.setup()
    await user.type(box, 'What is osmosis?{Enter}')
    await screen.findByText('First answer about osmosis.')

    chat.streamChat.mockImplementationOnce(async function* (): AsyncGenerator<ChatStreamEvent> {
      yield { type: 'error', code: 'upstream_unavailable', message: 'The AI is at capacity. Try again in a minute.' }
    })
    await user.click(await screen.findByRole('button', { name: 'Try that again' }))

    expect(await screen.findByText(/The AI is at capacity/)).toBeInTheDocument()
    expect(await screen.findByText('First answer about osmosis.')).toBeInTheDocument()
  })
})

describe('when the tutor is busy', () => {
  it('offers what needs no model instead of leaving the student at an error', async () => {
    chat.streamChat.mockImplementationOnce(async function* (): AsyncGenerator<ChatStreamEvent> {
      yield { type: 'error', code: 'upstream_unavailable', message: 'The AI is at capacity. Try again in a minute.' }
    })
    const box = await mount()
    await userEvent.setup().type(box, 'What is osmosis?{Enter}')

    expect(await screen.findByText(/The tutor is busy right now/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review due cards' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read your notes' })).toBeInTheDocument()
  })
})
