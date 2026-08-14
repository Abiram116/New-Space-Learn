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

import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
  })
})
