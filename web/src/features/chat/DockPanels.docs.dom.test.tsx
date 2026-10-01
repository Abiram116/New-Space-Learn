// @vitest-environment jsdom
/**
 * The Docs panel in the chat sidebar shows the topic's sources themselves — a
 * few of them — instead of only a link to the full page.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Document } from '../../api/types'

vi.mock('../spaces/RelatedTopics', () => ({ RelatedTopics: () => <div>related topics</div> }))
vi.mock('./panels/CardsPanel', () => ({ CardsPanel: () => null }))
vi.mock('./panels/NotesPanel', () => ({ NotesPanel: () => null }))
vi.mock('./panels/QuizzesPanel', () => ({ QuizzesPanel: () => null }))

import { DockPanelBody } from './DockPanels'

const doc = (n: number, extra: Partial<Document> = {}): Document => ({
  id: `d${n}`,
  name: `Paper ${n}.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 1000,
  status: 'ready',
  error: null,
  created_at: '2026-09-01T00:00:00Z',
  ready_at: '2026-09-01T00:01:00Z',
  ...extra,
})

function renderDocs(docs: Document[], loading = false) {
  return render(
    <MemoryRouter>
      <DockPanelBody
        panel="docs"
        subspaceId="sub-1"
        base="/fsd/transformer"
        onRunAgent={() => {}}
        docs={docs}
        docsLoading={loading}
      />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('Docs panel in the dock', () => {
  it('shows the first few sources and sends the rest to the full page', () => {
    renderDocs([1, 2, 3, 4, 5].map((n) => doc(n)))
    expect(screen.getByText('Sources · 5')).toBeInTheDocument()
    for (const n of [1, 2, 3]) expect(screen.getByText(`Paper ${n}.pdf`)).toBeInTheDocument()
    expect(screen.queryByText('Paper 4.pdf')).not.toBeInTheDocument()
    expect(screen.getByText(/and 2 more/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /See all 5 sources/ })).toHaveAttribute('href', '/fsd/transformer/docs')
  })

  it('shows every source when there are only a few, with a plain manage link', () => {
    renderDocs([doc(1), doc(2)])
    expect(screen.getByText('Paper 2.pdf')).toBeInTheDocument()
    expect(screen.queryByText(/more\./)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Manage sources/ })).toHaveAttribute('href', '/fsd/transformer/docs')
  })

  it('says so when there are none, rather than showing an empty box', () => {
    renderDocs([])
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument()
  })

  it('shows placeholders, not "nothing here", while the list is still loading', () => {
    renderDocs([], true)
    expect(screen.queryByText(/Nothing here yet/)).not.toBeInTheDocument()
  })
})
