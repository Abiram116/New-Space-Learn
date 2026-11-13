// @vitest-environment jsdom
/**
 * The dock's first screen: four plain sections — Your material, Make from this
 * chat, Saved in this topic, How I answer. What matters is what it tells
 * someone who has just arrived: what's here, and what to press next. Each
 * stage of a topic is checked for both.
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
vi.mock('../spaces/RelatedTopics', () => ({ RelatedTopics: () => <div>the linked topics list</div> }))
vi.mock('./DockLinkedTopics', () => ({ DockLinkedTopics: () => <div>the linked topics map</div> }))
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
  const result = render(
    <MemoryRouter>
      <ToastProvider>
        <ContextDock subspaceId="sub-1" base="/fsd/t" panel={null} {...props} {...over} />
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  )
  return { ...props, ...result }
}

beforeEach(() => {
  clearCache()
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

const make = (word: 'Notes' | 'Quiz' | 'Cards') =>
  within(screen.getByRole('group', { name: 'Make from this chat' })).getByRole('button', { name: new RegExp(`^${word}`) })

describe('ContextDock overview', () => {
  it('shows the same four plain sections for every topic', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    renderDock({ questionsAsked: 2 })
    expect(await screen.findByText('Your material')).toBeInTheDocument()
    expect(screen.getByText('Make from this chat')).toBeInTheDocument()
    expect(screen.getByText('Saved in this topic')).toBeInTheDocument()
    expect(screen.getByText('How I answer')).toBeInTheDocument()
  })

  it('a new topic: says there are no files, and the drop box is the one thing to press', async () => {
    api.listDocuments.mockResolvedValue([])
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    renderDock()
    expect(await screen.findByText('No files yet')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /Add your notes or PDFs/ }))
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
    // Nothing to practise with yet: the three are shown, can't be pressed, and one line says why.
    expect(make('Notes')).toBeDisabled()
    expect(make('Quiz')).toBeDisabled()
    expect(make('Cards')).toBeDisabled()
    expect(screen.getByText('Add a file first. Then turn what you learn into practice.')).toBeInTheDocument()
    expect(screen.getByText('Nothing yet. What you make shows up here.')).toBeInTheDocument()
  })

  it('while a file is being read: says so in the header and on the file', async () => {
    api.listDocuments.mockResolvedValue([doc(1, { status: 'processing', progress: 0.3, ready_at: null })])
    renderDock()
    expect(await screen.findByText('Reading… 30%')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Reading your file…')
  })

  it('a file that failed: says why, and Try again reads it again', async () => {
    api.listDocuments.mockResolvedValue([doc(1, { status: 'failed', error: 'Too blurry.', ready_at: null })])
    api.reprocessDocument.mockResolvedValue(doc(1))
    renderDock()
    expect(await screen.findByText('Too blurry.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /Try again/ }))
    expect(api.reprocessDocument).toHaveBeenCalledWith('d1')
  })

  it('a ready file, nothing asked: points at the chat, and Quiz and Cards are ready', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    const input = document.createElement('textarea')
    input.setAttribute('data-chat-input', '')
    document.body.append(input)
    renderDock()
    await userEvent.setup().click(await screen.findByRole('button', { name: /Ask me anything in the chat/ }))
    expect(document.activeElement).toBe(input)
    expect(make('Quiz')).toBeEnabled()
    expect(make('Cards')).toBeEnabled()
    expect(make('Notes')).toBeDisabled()
    input.remove()
  })

  it('after a question: each of the three makes its own thing', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    const { onRunAgent } = renderDock({ questionsAsked: 3 })
    await screen.findByText('Make from this chat')
    expect(screen.queryByRole('button', { name: /Ask me anything/ })).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(make('Notes'))
    await user.click(make('Quiz'))
    await user.click(make('Cards'))
    expect(onRunAgent.mock.calls.map((c) => c[0])).toEqual(['notes', 'quiz', 'flashcards'])
  })

  it('shows a busy one as making, and does not let it be pressed twice', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    renderDock({ questionsAsked: 3, busy: { quiz: true } })
    await screen.findByText('Make from this chat')
    expect(make('Quiz')).toBeDisabled()
    expect(make('Quiz')).toHaveAttribute('aria-busy', 'true')
    expect(make('Quiz')).toHaveTextContent('Making…')
  })

  it('lists what is saved here, opens each, and reviews what is due on the full page', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listNotes.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }])
    api.listQuizzes.mockResolvedValue([{ id: 'q1', topic: 'Softmax', best_score: 100, questions: [] }])
    api.listDecks.mockResolvedValue([deck(6)])
    const { onOpenPanel } = renderDock({ questionsAsked: 12 })
    expect(await screen.findByRole('button', { name: 'Notes, 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quizzes, 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Flashcards, 10 cards' })).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Notes, 2' }))
    expect(onOpenPanel).toHaveBeenCalledWith('notes')
    // Review opens the full page for the deck with the most due; Back there returns to the chat.
    await user.click(screen.getByRole('button', { name: 'Review 6 due' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/fsd/t/flashcards?deck=k1&review=deck&from=chat')
  })

  it('names the one quiz worth another go, and says nothing about the solid ones', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listQuizzes.mockResolvedValue([
      { id: 'q1', topic: 'Softmax', best_score: 100, attempts: 2, questions: [] },
      { id: 'q3', topic: 'Masking', best_score: 40, attempts: 1, questions: [] },
    ])
    renderDock({ questionsAsked: 4 })
    expect(await screen.findByText('Masking is worth another go')).toBeInTheDocument()
    expect(screen.queryByText(/Softmax/)).not.toBeInTheDocument()
  })

  it('keeps the list of questions folded away, then jumps to one, newest first', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
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
    const fold = await screen.findByRole('button', { name: /Your questions · 2/ })
    expect(screen.queryByText('What is attention?')).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(fold)
    expect(fold).toHaveAttribute('aria-expanded', 'true')
    const items = screen.getAllByRole('button', { name: /attention\?|square root/ }).map((b) => b.textContent)
    expect(items[0]).toContain('square root')
    await user.click(screen.getByRole('button', { name: /What is attention/ }))
    expect(target.scrollIntoView).toHaveBeenCalled()
    target.remove()
  })

  it('draws the linked topics as a map right under your files, not folded away', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    renderDock({ questionsAsked: 1 })
    expect(await screen.findByText('the linked topics map')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Linked topics/ })).not.toBeInTheDocument()
  })

  it('says why a tile cannot be pressed yet, on the tile itself', async () => {
    api.listDocuments.mockResolvedValue([])
    renderDock()
    await screen.findByText('No files yet')
    expect(make('Quiz')).toHaveTextContent('Needs a file')
    expect(make('Cards')).toHaveTextContent('Needs a file')
    expect(make('Notes')).toHaveTextContent('After an answer')
  })

  it('lets you remove a file that is ready, after asking first', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.deleteDocument.mockResolvedValue(undefined)
    renderDock({ questionsAsked: 4 })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Remove Paper 1.pdf' }))
    expect(api.deleteDocument).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith('d1'))
  })

  it('shows upload progress while a file is sent, then reads the list again', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    let finish: (d: Document) => void = () => {}
    api.uploadDocument.mockImplementation((_s: string, _f: File, onProgress: (p: number) => void) => {
      onProgress(42)
      return new Promise<Document>((r) => (finish = r))
    })
    renderDock({ questionsAsked: 1 })
    await screen.findByText('Paper 1.pdf')
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText('Choose files to add'), new File(['x'], 'Lecture 3.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText('Uploading… 42%')).toBeInTheDocument()
    expect(screen.getByText('Lecture 3.pdf')).toBeInTheDocument()
    const reads = api.listDocuments.mock.calls.length
    finish(doc(2))
    await waitFor(() => expect(screen.queryByText(/Uploading…/)).not.toBeInTheDocument())
    await waitFor(() => expect(api.listDocuments.mock.calls.length).toBeGreaterThan(reads))
  })

  it('has no characters in it: the chat page is busy enough', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    api.listDecks.mockResolvedValue([deck(2)])
    const { container } = renderDock({ questionsAsked: 4 })
    await screen.findByText('Review 2 due')
    expect(container.querySelector('.bot, .bot-slot')).toBeNull()
  })

  it('does not show anything that might be wrong while the chat is still loading', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    const { rerender } = renderDock({ questionsAsked: null })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Your material')).not.toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <ToastProvider>
          <ContextDock subspaceId="sub-1" base="/fsd/t" panel={null} onRunAgent={vi.fn()} onOpenPanel={vi.fn()} onClosePanel={vi.fn()} questionsAsked={12} />
        </ToastProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Your material')).toBeInTheDocument()
  })

  it('lists a few files and sends the rest to the Files panel', async () => {
    api.listDocuments.mockResolvedValue([1, 2, 3, 4, 5].map((n) => doc(n)))
    const { onOpenPanel } = renderDock()
    await screen.findByText('Paper 1.pdf')
    expect(screen.queryByText('Paper 4.pdf')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /See all 5 files/ }))
    expect(onOpenPanel).toHaveBeenCalledWith('docs')
  })

  it('opens the file picker when the empty chat asks for a file', async () => {
    api.listDocuments.mockResolvedValue([])
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    renderDock()
    await screen.findByText('No files yet')
    window.dispatchEvent(new Event('sl:add-file'))
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })

  it('has Help one click away, in the header', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    const { onOpenPanel } = renderDock()
    await screen.findByText('Answering from 1 file')
    await userEvent.setup().click(screen.getByRole('button', { name: /Help/ }))
    expect(onOpenPanel).toHaveBeenCalledWith('help')
  })

  it('shows the answer style as one chip, and says what Normal means', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    renderDock({ questionsAsked: 1 })
    expect(await screen.findByText('Normal')).toBeInTheDocument()
    expect(screen.getByText(/Plain, direct answers/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
  })

  it('opens the Help panel with the steps, the fixes and a main button to give feedback', async () => {
    api.listDocuments.mockResolvedValue([doc(1)])
    renderDock({ panel: 'help' })
    expect(await screen.findByText('Add your files')).toBeInTheDocument()
    expect(screen.getByText('Ask questions')).toBeInTheDocument()
    expect(screen.getByText('It says it can’t find the answer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tell us what went wrong/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument()
  })
})
