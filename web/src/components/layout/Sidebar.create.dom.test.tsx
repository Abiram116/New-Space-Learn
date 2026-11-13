// @vitest-environment jsdom
/**
 * A subject created together with its first topic opens on that topic, with
 * the subject expanded in the rail — rather than appearing as one more closed
 * row, which looked as if nothing had been made.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '../../api/types'
import { ToastProvider } from '../ui/Toast'

const SPACES: Space[] = [
  {
    id: 'sp',
    name: 'Biology',
    tone: 'sky',
    pinned: false,
    slug: 'biology',
    subspaces: [{ id: 'sub', subject_id: 'sp', name: 'Cells', slug: 'cells', last_activity_at: null, counts: {} }],
  },
  { id: 'empty', name: 'Chemistry', tone: 'mint', pinned: false, slug: 'chemistry', subspaces: [] },
]

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'ada@example.test', user_metadata: {} }, session: null, loading: false }),
}))
vi.mock('../../features/spaces/SpacesProvider', () => ({
  useSpaces: () => ({
    spaces: SPACES,
    loading: false,
    error: null,
    refresh: async () => {},
    createSpace: vi.fn(),
    renameSpace: vi.fn(),
    setPinned: vi.fn(),
    deleteSpace: vi.fn(),
    addSubspace: vi.fn(),
    renameSubspace: vi.fn(),
    deleteSubspace: vi.fn(),
  }),
}))
// The dialog's own form is covered with the dialog. Here it only has to
// report what it reports in the app: the id of the subject it made.
vi.mock('../../features/spaces/NewSpaceModal', () => ({
  NewSpaceModal: ({ open, onCreated }: { open: boolean; onCreated?: (id: string) => void }) =>
    open ? (
      <>
        <button onClick={() => onCreated?.('sp')}>made with a topic</button>
        <button onClick={() => onCreated?.('empty')}>made without a topic</button>
      </>
    ) : null,
}))

import { Sidebar } from './Sidebar'

afterEach(cleanup)

function At() {
  return <p data-testid="at">{useLocation().pathname}</p>
}

function renderRail(onNavigate = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/home']}>
      <ToastProvider>
        <Routes>
          <Route path="/home" element={<Sidebar onNavigate={onNavigate} />} />
          <Route path="/:spaceId/:subspaceId" element={<Sidebar onNavigate={onNavigate} />} />
        </Routes>
        <At />
      </ToastProvider>
    </MemoryRouter>,
  )
  return onNavigate
}

describe('Sidebar › new subject', () => {
  it('goes to the first topic and shows the subject open', () => {
    const onNavigate = renderRail()
    // A subject with topics starts closed.
    expect(screen.queryByText('Cells')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'New subject' }))
    fireEvent.click(screen.getByText('made with a topic'))

    expect(screen.getByTestId('at')).toHaveTextContent('/biology/cells')
    expect(screen.getByText('Cells')).toBeInTheDocument()
    // In the phone-width drawer, this is what closes it.
    expect(onNavigate).toHaveBeenCalled()
  })

  it('stays put when the subject was made without a topic', () => {
    renderRail()
    fireEvent.click(screen.getByRole('button', { name: 'New subject' }))
    fireEvent.click(screen.getByText('made without a topic'))
    expect(screen.getByTestId('at')).toHaveTextContent('/home')
  })
})
