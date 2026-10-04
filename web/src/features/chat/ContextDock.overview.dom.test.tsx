// @vitest-environment jsdom
/**
 * The dock's first screen: a three-step checklist and one button for the next
 * step. What matters is what it tells someone who has just arrived — where they
 * are, and what to press — so each stage of a topic is checked for both.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deck, Document } from '../../api/types'
import { ToastProvider } from '../../components/ui/Toast'
import { clearCache } from '../../lib/asyncCache'

const api = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  reprocessDocument: vi.fn(),
  deleteDocument: vi.fn(),
  listActiveSkills: vi.fn(),
  listSkills: vi.fn(),
  activateSkill: vi.fn(),
  deactivateSkill: vi.fn(),
  listNotes: vi.fn(),
  listQuizzes: vi.fn(),
  listDecks: vi.fn(),
}))
vi.mock('../../api/documents', () => api)
vi.mock('../../api/skills', () => api)
vi.mock('../../api/notes', () => api)
vi.mock('../../api/quizzes', () => api)
vi.mock('../../api/flashcards', () => api)
vi.mock('../spaces/RelatedTopics', () => ({ RelatedTopics: () => null }))
vi.mock('./panels/CardsPanel', () => ({ CardsPanel: () => null }))
vi.mock('./panels/NotesPanel', () => ({ NotesPanel: () => null }))
vi.mock('./panels/QuizzesPanel', () => ({ QuizzesPanel: () => null }))

import { ContextDock } from './ContextDock'

const doc = (n: number, extra: Partial<Document> = {}): Document => ({
  id: `d${n}`,
  name: `Paper ${n}.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 1_000_000,
  status: 'ready',
  error: null,
  created_at: '2026-09-01T00:00:00Z',
  ready_at: '2026-09-01T00:01:00Z',
  ...extra,
})
const deck = (due: number): Deck => ({ id: 'k1', name: 'Terms', total: 10, due, known_pct: 0 })

function Where() {
  const l = useLocation()
  return <span data-testid="where">{l.pathname + l.search}</span>
}

function renderDock(over: Partial<React.ComponentProps<typeof ContextDock>> = {}) {
  const props = { onRunAgent: vi.fn(), onOpenPanel: vi.fn(), onClosePanel: vi.fn() }
  render(
    <MemoryRouter>
      <ToastProvider>
        <ContextDock subspaceId="sub-1" base="/fsd/t" panel={null} {...props} {...over} />
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  )
  return props
}

beforeEach(() => {
  clearCache()
  localStorage.clear() // the dock remembers, per topic, that it has outgrown the guide
  api.listActiveSkills.mockResolvedValue([])
  api.listSkills.mockResolvedValue([])
  api.listNotes.mockResolvedValue([])
  api.listQuizzes.mockResolvedValue([])
  api.listDecks.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const doneCount = () => screen.queryAllByText('Done').length
const nextButton = () => within(screen.getByText('Next step').parentElement!).getByRole('button')

describe('ContextDock overview', () => {
  it('a new topic: step 1 is current, and the one button says Add a file', async () => {
    api.listDocuments.mockResolvedValue([])
    renderDock()
    expect(await screen.findByText(/Hi, I’m Nova! Add your notes/)).toBeInTheDocument()
    expect(doneCount()).toBe(0)
    expect(screen.getByRole('heading', { name: 'Add a file' }).closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('Add a file. The AI answers from it.')).toBeInTheDocument()
    expect(nextButton()).toHaveTextContent('Add a file')
    // Nothing to practise with yet: the crew is shown, but can't be pressed.
    expect(screen.getByRole('button', { name: /Quiz/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Note/ })).toBeDisabled()
    // And "Answer style" is not offered until it means something.
    expect(screen.queryByText('Answer style')).not.toBeInTheDocument()
  })

  it('while a file is being read: says so, and the main button waits', async () => {
    api.listDocuments.mockResolvedValue([doc(1, { status: 'processing', progress: 0.3, ready_at: null })])
    renderDock()
    expect(await screen.findByText('Reading… 30%')).toBeInTheDocument()
    expect(nextButton()).toBeDisabled()
    expect(nextButton()).toHaveTextContent('Waiting for your file')
  })

  it('a file that failed: marked as a problem, with a way to retry from the main button', async () => {
    api.listDocuments.mockResolvedValue([doc(1, { status: 'failed', error: 'Too blurry.', ready_at: null })])
    api.reprocessDocument.mockResolvedValue(doc(1))
    renderDock()
    expect(await screen.findByText('Too blurry.')).toBeInTheDocument()
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
    await userEvent.setup().click(nextButton())
    expect(api.reprocessDocument).toHaveBeenCalledWith('d1')
  })

  it('a ready file, nothing asked: step 2 is current and the button goes to the chat', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    const input = document.createElement('textarea')
    input.setAttribute('data-chat-input', '')
    document.body.append(input)
    renderDock()
    expect(await screen.findByText('Got it! Ask me anything about it.')).toBeInTheDocument()
    expect(doneCount()).toBe(1)
    expect(screen.getByRole('heading', { name: 'Ask a question' }).closest('li')).toHaveAttribute('aria-current', 'step')
    await userEvent.setup().click(nextButton())
    expect(document.activeElement).toBe(input)
    input.remove()
  })

  it('after a question: the main button makes flashcards, and the crew is ready', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    const { onRunAgent } = renderDock({ questionsAsked: 3 })
    expect(await screen.findByText(/Good questions/)).toBeInTheDocument()
    expect(doneCount()).toBe(2)
    expect(screen.getByText('You’ve asked 3. Keep going in the chat.')).toBeInTheDocument()
    const user = userEvent.setup()
    expect(nextButton()).toHaveTextContent('Make flashcards')
    await user.click(nextButton())
    // The crew, each with their own job.
    await user.click(screen.getByRole('button', { name: /Note/ }))
    await user.click(screen.getByRole('button', { name: /Quiz/ }))
    expect(screen.getByRole('button', { name: /Flashcards/ })).toBeEnabled()
    expect(onRunAgent.mock.calls.map((c) => c[0])).toEqual(['flashcards', 'notes', 'quiz'])
  })

  it('a topic in use is a summary, not a funnel: its files, its style, what was made — and cards to review', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listNotes.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }])
    api.listQuizzes.mockResolvedValue([{ id: 'q1' }])
    api.listDecks.mockResolvedValue([deck(6)])
    const { onOpenPanel } = renderDock({ questionsAsked: 12 })
    expect(await screen.findByText('Answering from 1 file')).toBeInTheDocument()
    // No steps, no ring: this is not someone who needs to be told to get started.
    expect(screen.queryByRole('heading', { name: 'Ask a question' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /steps done/ })).not.toBeInTheDocument()
    // What has been made, as numbers you can press.
    expect(screen.getByRole('button', { name: /Notes/ })).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: /Quizzes/ })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /Cards/ })).toHaveTextContent('10')
    expect(await screen.findByText('Review 6 cards')).toBeInTheDocument()
    expect(screen.getByText('6 cards due')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Notes/ }))
    expect(onOpenPanel).toHaveBeenCalledWith('notes')
    // Review opens the full page for the deck with the most due; Back there returns to the chat.
    await user.click(nextButton())
    expect(screen.getByTestId('where')).toHaveTextContent('/fsd/t/flashcards?deck=k1&review=deck&from=chat')
  })

  it('suggests only the one quiz worth another go, and says nothing about the solid ones', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listNotes.mockResolvedValue([{ id: 'n1', title: 'Attention' }])
    api.listQuizzes.mockResolvedValue([
      { id: 'q1', topic: 'Softmax', best_score: 100, attempts: 2, questions: [] },
      { id: 'q2', topic: 'Embeddings', best_score: null, attempts: 0, questions: [] },
      { id: 'q3', topic: 'Masking', best_score: 40, attempts: 1, questions: [] },
    ])
    api.listDecks.mockResolvedValue([{ id: 'k1', name: 'Terms', total: 10, due: 0, known_pct: 70 }])
    renderDock({ questionsAsked: 4 })
    const row = await screen.findByRole('button', { name: /Masking/ })
    expect(row).toHaveTextContent('Best 40%')
    expect(screen.queryByText('Softmax')).not.toBeInTheDocument()
    expect(screen.queryByText('Embeddings')).not.toBeInTheDocument()
    // Full page, and Back there returns to the chat.
    await userEvent.setup().click(row)
    expect(screen.getByTestId('where')).toHaveTextContent('/fsd/t/quizzes?q=q3&from=chat')
  })

  it('lists nothing to retake when every quiz is solid', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listNotes.mockResolvedValue([{ id: 'n1' }])
    api.listQuizzes.mockResolvedValue([{ id: 'q1', topic: 'Softmax', best_score: 95, attempts: 1, questions: [] }])
    renderDock({ questionsAsked: 4 })
    await screen.findByText('Study')
    expect(screen.queryByRole('button', { name: /Softmax/ })).not.toBeInTheDocument()
  })

  it('outlines the conversation, newest first, and jumps to a question', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listNotes.mockResolvedValue([{ id: 'n1' }])
    const target = document.createElement('div')
    target.id = 'msg-m1'
    target.scrollIntoView = vi.fn()
    document.body.append(target)
    renderDock({
      questionsAsked: 2,
      questions: [
        { id: 'm1', text: 'What is attention?' },
        { id: 'm2', text: 'Why scale by the square root?' },
      ],
    })
    const items = (await screen.findAllByRole('button', { name: /attention\?|square root/ })).map((b) => b.textContent)
    expect(items[0]).toContain('square root')
    await userEvent.setup().click(screen.getByRole('button', { name: /What is attention/ }))
    expect(target.scrollIntoView).toHaveBeenCalled()
    target.remove()
  })

  it('lets you remove a file that is ready, after asking first', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listNotes.mockResolvedValue([{ id: 'n1' }])
    api.deleteDocument.mockResolvedValue(undefined)
    renderDock({ questionsAsked: 4 })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Remove Paper 1.pdf' }))
    expect(api.deleteDocument).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith('d1'))
  })

  it('gives the step-by-step guide to the first few topics only; later new topics open straight to the summary', async () => {
    localStorage.setItem('sl:dock-guided', JSON.stringify(['a', 'b', 'c']))
    api.listDocuments.mockResolvedValue([doc(1)])
    renderDock({ questionsAsked: 0 })
    await screen.findByText('Answering from 1 file')
    expect(screen.queryByRole('heading', { name: 'Ask a question' })).not.toBeInTheDocument()
    // The main button still says what to do next.
    expect(nextButton()).toHaveTextContent(/Ask/)
  })

  it('a topic that has the guide keeps it, and takes one of the places only once', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    renderDock({ questionsAsked: 0 })
    expect(await screen.findByText('Got it! Ask me anything about it.')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('sl:dock-guided')!)).toEqual(['sub-1'])
    cleanup()
    renderDock({ questionsAsked: 0 })
    expect(await screen.findByText('Got it! Ask me anything about it.')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('sl:dock-guided')!)).toEqual(['sub-1'])
  })

  it('has no characters in it: the chat page is busy enough', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listNotes.mockResolvedValue([{ id: 'n1' }])
    api.listDecks.mockResolvedValue([deck(2)])
    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <ContextDock subspaceId="sub-1" base="/fsd/t" panel={null} onRunAgent={vi.fn()} onOpenPanel={vi.fn()} onClosePanel={vi.fn()} questionsAsked={4} />
        </ToastProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Review 2 cards')
    expect(container.querySelector('.bot, .bot-slot')).toBeNull()
  })

  it('never contradicts the chat: a topic with work in it but nothing asked here is not told to "Ask a question" first', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listNotes.mockResolvedValue([{ id: 'n1' }])
    api.listDecks.mockResolvedValue([deck(2)])
    renderDock({ questionsAsked: 0 })
    expect(await screen.findByText('Answering from 1 file')).toBeInTheDocument()
    expect(await screen.findByText('Review 2 cards')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Add a file' })).not.toBeInTheDocument()
  })

  it('a topic in use with no files asks for one gently, and says so in the header', async () => {
    api.listDocuments.mockResolvedValue([])
    api.listNotes.mockResolvedValue([{ id: 'n1' }])
    renderDock({ questionsAsked: 3 })
    expect(await screen.findByText('No files yet')).toBeInTheDocument()
    expect(screen.getByText('Add a file. The AI answers from it.')).toBeInTheDocument()
    expect(nextButton()).toHaveTextContent('Add a file')
  })

  it('celebrates a step the moment it is finished — but not one that was already done when it loaded', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    const props = { onRunAgent: vi.fn(), onOpenPanel: vi.fn(), onClosePanel: vi.fn() }
    const tree = (asked: number) => (
      <MemoryRouter>
        <ToastProvider>
          <ContextDock subspaceId="sub-1" base="/fsd/t" panel={null} questionsAsked={asked} {...props} />
        </ToastProvider>
      </MemoryRouter>
    )
    const { rerender, container } = render(tree(0))
    await screen.findByText('Got it! Ask me anything about it.')
    // Step 1 was done on arrival: no fanfare for it.
    await waitFor(() => expect(doneCount()).toBe(1))
    expect(container.querySelector('.dock-pop')).toBeNull()

    rerender(tree(1)) // the first question is sent
    await waitFor(() => expect(container.querySelectorAll('.dock-pop')).toHaveLength(1))
    expect(doneCount()).toBe(2)
  })

  it('does not mistake a chat that is still loading for progress', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    const props = { onRunAgent: vi.fn(), onOpenPanel: vi.fn(), onClosePanel: vi.fn() }
    const tree = (asked: number | null) => (
      <MemoryRouter>
        <ToastProvider>
          <ContextDock subspaceId="sub-1" base="/fsd/t" panel={null} questionsAsked={asked} {...props} />
        </ToastProvider>
      </MemoryRouter>
    )
    const { rerender, container } = render(tree(null))
    // Until the chat has loaded nothing is shown that might turn out to be wrong.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Nova/)).not.toBeInTheDocument()
    expect(doneCount()).toBe(0)
    rerender(tree(12)) // the history arrives: 12 questions were already asked
    await screen.findByText(/Good questions/)
    expect(doneCount()).toBe(2)
    expect(container.querySelector('.dock-pop')).toBeNull()
  })

  it('lists a few files and sends the rest to the Files panel', async () => {
    api.listDocuments.mockResolvedValue([1, 2, 3, 4, 5].map((n) => doc(n)))
    const { onOpenPanel } = renderDock()
    await screen.findByText('Paper 1.pdf')
    expect(screen.queryByText('Paper 4.pdf')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /See all 5 files/ }))
    expect(onOpenPanel).toHaveBeenCalledWith('docs')
  })

  it('once a topic has outgrown the guide it never goes back, even if what was made is deleted', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listNotes.mockResolvedValue([{ id: 'n1' }])
    const props = { onRunAgent: vi.fn(), onOpenPanel: vi.fn(), onClosePanel: vi.fn() }
    const tree = () => (
      <MemoryRouter>
        <ToastProvider>
          <ContextDock subspaceId="sub-1" base="/fsd/t" panel={null} questionsAsked={2} {...props} />
        </ToastProvider>
      </MemoryRouter>
    )
    const first = render(tree())
    expect(await screen.findByText('Answering from 1 file')).toBeInTheDocument()
    first.unmount()

    clearCache() // a fresh visit, and the note is gone
    api.listNotes.mockResolvedValue([])
    render(tree())
    expect(await screen.findByText('Answering from 1 file')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ask a question' })).not.toBeInTheDocument()
  })

  it('opens the file picker when the empty chat asks for a file', async () => {
    api.listDocuments.mockResolvedValue([])
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    renderDock()
    await screen.findByText('Add a file. The AI answers from it.')
    window.dispatchEvent(new Event('sl:add-file'))
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })

  it('the Files heading opens the Files panel, where the full list and linked topics are', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listNotes.mockResolvedValue([{ id: 'n1' }]) // a topic in use, so the summary is showing
    const { onOpenPanel } = renderDock({ questionsAsked: 2 })
    await screen.findByText('Answering from 1 file')
    await userEvent.setup().click(screen.getByRole('button', { name: /Files: see the full list/ }))
    expect(onOpenPanel).toHaveBeenCalledWith('docs')
  })

  it('has Help one click away, in the header', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    const { onOpenPanel } = renderDock()
    await screen.findByText('Got it! Ask me anything about it.')
    await userEvent.setup().click(screen.getByRole('button', { name: /Help/ }))
    expect(onOpenPanel).toHaveBeenCalledWith('help')
  })

  it('shows the answer style, and what to do when there is none', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    renderDock({ questionsAsked: 1 })
    expect(await screen.findByText('None yet. Answers are plain and direct.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pick one' })).toBeInTheDocument()
  })

  it('opens the Help panel with the three steps, the fixes and a main button to give feedback', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    renderDock({ panel: 'help' })
    expect(await screen.findByText('Add your files')).toBeInTheDocument()
    expect(screen.getByText('Ask questions')).toBeInTheDocument()
    expect(screen.getByText('It says it can’t find the answer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tell us what went wrong/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument()
  })
})
