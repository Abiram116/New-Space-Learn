// @vitest-environment jsdom
/**
 * The 2026-08 hardening pass found that `notes/format.ts`'s `sourceLine`
 * generates citation links to `${base}/docs?d=<document_id>`, explicitly
 * documented as making "a claim ... one click from the material it came
 * from" (and asserted by `format.test.ts`) — but `DocsView` never read the
 * `d` param at all. The link went to the right tab and did nothing further:
 * no scroll, no highlight, silently ignoring the id it was given.
 *
 * This mounts the real `DocsView` with `?d=` set to a real document's id and
 * proves the fix: the matching `SourceItem` is found by that id (which is
 * also its scroll target — see `SourceItem`'s `id={doc.id}`) and carries the
 * highlight ring. Before the fix, no element carried a highlight class at
 * all — this test would fail on the `ring-2 ring-brand` assertion.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Space, Subspace } from '../../api/types'

// jsdom does no real layout and doesn't implement scrollIntoView at all —
// same class of gap as NoteEditor.dom.test.tsx's Range stub, kept local to
// this file for the same reason.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// `vi.mock` factories are hoisted above the rest of the module, so the doc
// list has to be built inside `vi.hoisted` rather than referenced from a
// plain top-level const.
const { DOCS } = vi.hoisted(() => {
  const base = {
    mime_type: 'application/pdf',
    size_bytes: 1024,
    status: 'ready' as const,
    error: null,
    created_at: new Date().toISOString(),
    ready_at: new Date().toISOString(),
  }
  return {
    DOCS: [
      { ...base, id: 'doc-other', name: 'other.pdf' },
      { ...base, id: 'doc-target', name: 'attention.pdf' },
    ],
  }
})

vi.mock('../../api/documents', () => ({
  listDocuments: vi.fn().mockResolvedValue(DOCS),
  deleteDocument: vi.fn(),
  reprocessDocument: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({
    space: { id: 'space-1', name: 'CS', tone: 'brand' } as Space,
    subspace: { id: 'subspace-1', subject_id: 'space-1', name: 'Attention' } as Subspace,
    base: '/spaces/space-1/subspace-1',
  }),
}))

// A real fetch would be a second, unrelated network call this test isn't
// asking about — `RelatedTopics` renders nothing observable either way.
vi.mock('../spaces/RelatedTopics', () => ({ RelatedTopics: () => null }))

import { DocsView } from './DocsView'

describe('DocsView citation deep link', () => {
  afterEach(cleanup)

  it('highlights the document a citation link (`?d=`) pointed at', async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/spaces/space-1/subspace-1/docs?d=doc-target']}>
          <Routes>
            <Route path="/spaces/:spaceId/:subspaceId/docs" element={<DocsView />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    )

    await waitFor(() => expect(screen.getByText('attention.pdf')).toBeInTheDocument())

    const targetCard = document.getElementById('doc-target')
    expect(targetCard).not.toBeNull()
    expect(targetCard?.className).toMatch(/ring-2 ring-brand/)

    // The other document must not pick up the highlight meant for its sibling.
    const otherCard = document.getElementById('doc-other')
    expect(otherCard?.className ?? '').not.toMatch(/ring-2 ring-brand/)
  })

  it('does nothing (no crash, no stray highlight) when the id points at a document that no longer exists', async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/spaces/space-1/subspace-1/docs?d=doc-deleted']}>
          <Routes>
            <Route path="/spaces/:spaceId/:subspaceId/docs" element={<DocsView />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    )

    await waitFor(() => expect(screen.getByText('attention.pdf')).toBeInTheDocument())

    for (const d of DOCS) {
      expect(document.getElementById(d.id)?.className ?? '').not.toMatch(/ring-2 ring-brand/)
    }
    // And it says so: the link came from a citation, and opening the page as
    // if it had meant nothing left the student looking for a file that is gone.
    expect(await screen.findByText(/That file isn’t in this topic’s list/)).toBeInTheDocument()
  })
})

describe('DocsView uploads', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  const mount = async () => {
    const view = render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/spaces/space-1/subspace-1/docs']}>
          <Routes>
            <Route path="/spaces/:spaceId/:subspaceId/docs" element={<DocsView />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    )
    await waitFor(() => expect(screen.getByText('attention.pdf')).toBeInTheDocument())
    return view.container.querySelector<HTMLInputElement>('input[type="file"]')!
  }

  it('clears the picker after a choice, so the same file can be chosen again', async () => {
    const { uploadDocument } = await import('../../api/documents')
    vi.mocked(uploadDocument).mockRejectedValue(new Error('Upload failed, try again.'))
    const input = await mount()
    const file = new File(['x'], 'notes.pdf', { type: 'application/pdf' })
    let value = 'C:\\fakepath\\notes.pdf'
    Object.defineProperty(input, 'value', { get: () => value, set: (v: string) => (value = v), configurable: true })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1))
    expect(value).toBe('')
  })

  it('does not upload a file the server would refuse, and says why', async () => {
    const { uploadDocument } = await import('../../api/documents')
    const input = await mount()
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'song.mp3', { type: 'audio/mpeg' })], configurable: true })
    fireEvent.change(input)
    expect(await screen.findByText(/“song.mp3” can’t be read/)).toBeInTheDocument()
    expect(uploadDocument).not.toHaveBeenCalled()
  })
})

describe('uploadProblem', () => {
  it('mirrors the server: by extension, or by type when the name has none it knows', async () => {
    const { uploadProblem, UPLOAD_MAX_BYTES } = await import('./uploadCheck')
    expect(uploadProblem({ name: 'a.PDF', type: '', size: 10 })).toBeNull()
    expect(uploadProblem({ name: 'notes.md', type: 'application/octet-stream', size: 10 })).toBeNull()
    expect(uploadProblem({ name: 'scan', type: 'image/png', size: 10 })).toBeNull()
    expect(uploadProblem({ name: 'a.docx', type: 'application/vnd.openxmlformats', size: 10 })).toMatch(/can’t be read/)
    expect(uploadProblem({ name: 'a.pdf', type: 'application/pdf', size: UPLOAD_MAX_BYTES })).toBeNull()
    expect(uploadProblem({ name: 'a.pdf', type: 'application/pdf', size: UPLOAD_MAX_BYTES + 1 })).toMatch(/20 MB/)
  })
})
