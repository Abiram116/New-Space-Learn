// @vitest-environment jsdom
/**
 * The Files panel in the chat dock: every file with a plain word for its state,
 * a way to retry one that failed, and a clear first step when there are none.
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Document } from '../../api/types'
import { ToastProvider } from '../../components/ui/Toast'

const api = vi.hoisted(() => ({ reprocessDocument: vi.fn(), uploadDocument: vi.fn(), deleteDocument: vi.fn() }))
vi.mock('../../api/documents', () => api)
vi.mock('../spaces/RelatedTopics', () => ({ RelatedTopics: () => <div>related topics</div> }))
vi.mock('./panels/CardsPanel', () => ({ CardsPanel: () => null }))
vi.mock('./panels/NotesPanel', () => ({ NotesPanel: () => null }))
vi.mock('./panels/QuizzesPanel', () => ({ QuizzesPanel: () => null }))

import { DockPanelBody } from './DockPanels'
import { sourcesState } from './DockSources'

const doc = (n: number, extra: Partial<Document> = {}): Document => ({
  id: `d${n}`,
  name: `Paper ${n}.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 2_097_152,
  status: 'ready',
  error: null,
  created_at: '2026-09-01T00:00:00Z',
  ready_at: '2026-09-01T00:01:00Z',
  ...extra,
})

function renderDocs(docs: Document[], loading = false, onChanged = () => {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DockPanelBody
          panel="docs"
          subspaceId="sub-1"
          base="/fsd/transformer"
          onRunAgent={() => {}}
          docs={docs}
          docsLoading={loading}
          onDocsChanged={onChanged}
        />
      </ToastProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Files panel in the dock', () => {
  it('lists every file with its kind, size and state in words', () => {
    renderDocs([doc(1), doc(2, { status: 'processing', progress: 0.4, ready_at: null }), doc(3, { status: 'failed', error: 'Scanned.' })])
    expect(screen.getByText('Paper 1.pdf')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Reading… 40%')).toBeInTheDocument()
    expect(screen.getByText('Couldn’t read this')).toBeInTheDocument()
    expect(screen.getAllByText(/PDF · 2\.0 MB/)).toHaveLength(3)
  })

  it('retries a file that failed, then asks to read the list again', async () => {
    api.reprocessDocument.mockResolvedValue(doc(3))
    const onChanged = vi.fn()
    const user = userEvent.setup()
    renderDocs([doc(3, { status: 'failed', error: 'Scanned.' })], false, onChanged)
    await user.click(screen.getByRole('button', { name: /Try again/ }))
    expect(api.reprocessDocument).toHaveBeenCalledWith('d3')
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('says what to do first when there are none, rather than showing an empty box', () => {
    renderDocs([])
    expect(screen.getByRole('button', { name: /Add your notes or PDFs/ })).toBeInTheDocument()
  })

  it('shows placeholders, not the drop box, while the list is still loading', () => {
    renderDocs([], true)
    expect(screen.queryByText('Add your notes or PDFs')).not.toBeInTheDocument()
  })

  it('has its main button at the bottom and a quiet way to the full page above it', () => {
    renderDocs([doc(1)])
    // One Add files button: the panel's own, not a second one under the list.
    expect(screen.getAllByRole('button', { name: /Add files/ })).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Open all files/ })).toHaveAttribute('href', '/fsd/transformer/docs')
  })

  it('shows linked topics under their own plain heading', () => {
    renderDocs([doc(1)])
    expect(screen.getByText('Linked topics')).toBeInTheDocument()
    expect(screen.getByText('related topics')).toBeInTheDocument()
  })

  it('lets a file that failed be removed', async () => {
    api.deleteDocument.mockResolvedValue({ ok: true })
    const onChanged = vi.fn()
    renderDocs([doc(3, { status: 'failed', error: 'Scanned.' })], false, onChanged)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove' }))
    expect(api.deleteDocument).toHaveBeenCalledWith('d3')
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})

describe('sourcesState', () => {
  it('describes the topic in one line, from the state of its files', () => {
    expect(sourcesState([], true).kind).toBe('loading')
    expect(sourcesState([], false)).toMatchObject({ kind: 'none', title: 'No files yet' })
    expect(sourcesState([doc(1)], false)).toMatchObject({ kind: 'ready', title: 'Answering from 1 file', hint: '' })
    expect(sourcesState([doc(1), doc(2)], false).title).toBe('Answering from 2 files')
    expect(sourcesState([doc(1), doc(2, { status: 'processing' })], false).hint).toBe('Still reading 1 more.')
    expect(sourcesState([doc(1, { status: 'processing' })], false).kind).toBe('reading')
    expect(sourcesState([doc(1, { status: 'failed' })], false).kind).toBe('failed')
  })

  it('does not call a topic empty while its first load is still running', () => {
    expect(sourcesState([], true).kind).toBe('loading')
    expect(sourcesState([doc(1)], true).kind).toBe('ready')
  })
})
