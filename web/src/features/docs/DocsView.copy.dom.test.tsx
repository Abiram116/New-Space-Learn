// @vitest-environment jsdom
/**
 * The Files page speaks the same plain words as the chat sidebar: Files,
 * Reading…, Ready, Try again, Remove. A student does not know what a chunk or
 * an embedding is, and should not have to.
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Space, Subspace } from '../../api/types'

const api = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  deleteDocument: vi.fn(),
  reprocessDocument: vi.fn(),
  uploadDocument: vi.fn(),
}))
vi.mock('../../api/documents', () => api)
vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({
    space: { id: 'space-1', name: 'Biology', tone: 'brand' } as Space,
    subspace: { id: 'sub-1', subject_id: 'space-1', name: 'Cells' } as Subspace,
    base: '/bio/cells',
  }),
}))
vi.mock('../../lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../spaces/RelatedTopics', () => ({ RelatedTopics: () => null }))
vi.mock('../../components/layout/SubspaceHeader', () => ({
  SubspaceHeader: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}))

import { DocsView } from './DocsView'

const doc = (id: string, extra: object = {}) => ({
  id,
  name: `${id}.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 1024,
  status: 'ready',
  error: null,
  created_at: '2026-09-01T00:00:00Z',
  ready_at: '2026-09-01T00:01:00Z',
  ...extra,
})

const mount = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <DocsView />
      </MemoryRouter>
    </ToastProvider>,
  )

const JARGON = /chunk|embed|index|reprocess|knowledge base|document/i

afterEach(cleanup)

describe('the Files page, in plain words', () => {
  it('names each file’s state the way the sidebar does, with no jargon', async () => {
    api.listDocuments.mockResolvedValue([
      doc('ready'),
      doc('reading', { status: 'processing', progress: 0.4, ready_at: null }),
      doc('broken', { status: 'failed', ready_at: null }),
    ])
    mount()
    expect(await screen.findByRole('heading', { name: 'Files' })).toBeInTheDocument()
    expect(screen.getByText('Ready for questions')).toBeInTheDocument()
    expect(screen.getByText('Getting it ready 40%')).toBeInTheDocument()
    expect(screen.getByText('Didn\'t work')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Read again/ }).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(JARGON)
  })

  it('asks before removing a file, in the same words', async () => {
    api.listDocuments.mockResolvedValue([doc('ready')])
    mount()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Remove ready.pdf' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Delete this file?')
    expect(dialog).toHaveTextContent('Your notes and chats will stay.')
    expect(dialog.textContent).not.toMatch(JARGON)
  })

  it('says what to add, and why, when there are no files', async () => {
    api.listDocuments.mockResolvedValue([])
    mount()
    expect(await screen.findByText('No files yet')).toBeInTheDocument()
    // The page's own words; the mascot's line beside them lives elsewhere.
    const said = screen.getByText(/answers in this topic can show the page they came from/)
    expect(said.textContent).not.toMatch(JARGON)
    expect(screen.getAllByRole('button', { name: 'Add a file' })).toHaveLength(2)
  })
})
