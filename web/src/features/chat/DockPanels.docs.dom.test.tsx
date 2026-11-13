// @vitest-environment jsdom
/**
 * The Files panel in the chat dock: every file with a plain word for its state,
 * a way to retry one that failed, and a clear first step when there are none.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    expect(screen.getByText('Drop your notes or a PDF here')).toBeInTheDocument()
  })

  it('shows placeholders, not the drop box, while the list is still loading', () => {
    renderDocs([], true)
    expect(screen.queryByText('Drop your notes or a PDF here')).not.toBeInTheDocument()
  })

  it('has its main button at the bottom and a quiet way to the full page above it', () => {
    renderDocs([doc(1)])
    expect(screen.getByRole('button', { name: /Add a file/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open all files/ })).toHaveAttribute('href', '/fsd/transformer/docs')
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

describe('adding files in the dock', () => {
  const file = (name: string, type: string, size = 1000) => {
    const f = new File(['x'], name, { type })
    Object.defineProperty(f, 'size', { value: size })
    return f
  }
  const drop = (files: File[]) =>
    fireEvent.drop(screen.getByRole('region', { name: 'Files' }), { dataTransfer: { files } })

  it('adds every file dropped together, not only the first', async () => {
    api.uploadDocument.mockResolvedValue(doc(9))
    const onChanged = vi.fn()
    renderDocs([doc(1)], false, onChanged)
    drop([file('a.pdf', 'application/pdf'), file('b.md', '')])
    await vi.waitFor(() => expect(api.uploadDocument).toHaveBeenCalledTimes(2))
    expect(api.uploadDocument.mock.calls.map((c) => (c[1] as File).name)).toEqual(['a.pdf', 'b.md'])
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
  })

  it('says why a file cannot be added instead of uploading it to be refused', async () => {
    renderDocs([doc(1)])
    drop([file('lecture.mp4', 'video/mp4'), file('huge.pdf', 'application/pdf', 21 * 1024 * 1024)])
    expect(await screen.findByText(/“lecture.mp4” can’t be read/)).toBeInTheDocument()
    expect(await screen.findByText(/“huge.pdf” is larger than the 20 MB limit/)).toBeInTheDocument()
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })

  it('says a file is being added while the list already has files', async () => {
    let finish!: (d: Document) => void
    let progress!: (percent: number) => void
    api.uploadDocument.mockImplementation((_id: string, _file: File, onProgress: (p: number) => void) => {
      progress = onProgress
      return new Promise<Document>((r) => (finish = r))
    })
    renderDocs([doc(1)])
    drop([file('a.pdf', 'application/pdf')])
    expect(await screen.findByText('Adding your file… 0%')).toBeInTheDocument()
    // The real figure from the upload, not a spinner that says nothing.
    act(() => progress(42))
    expect(screen.getByText('Adding your file… 42%')).toBeInTheDocument()
    finish(doc(9))
    await vi.waitFor(() => expect(screen.queryByText(/Adding your file…/)).not.toBeInTheDocument())
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
