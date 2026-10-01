// @vitest-environment jsdom
/**
 * The rail's bottom area: Skills sits apart from the topic list and the main
 * nav, as its own labelled link to the account-wide page, and carries the page
 * it was clicked on so "Back" can return there.
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '../../api/types'
import { ToastProvider } from '../ui/Toast'

const SPACES: Space[] = [
  {
    id: 'sp',
    name: 'Biology',
    tone: 'sky',
    pinned: false,
    subspaces: [{ id: 'sub', subject_id: 'sp', name: 'Cells', last_activity_at: null, counts: {} }],
  },
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

import { Sidebar } from './Sidebar'

afterEach(cleanup)

function renderRail(collapsed = false) {
  return render(
    <MemoryRouter initialEntries={['/biology/cells']}>
      <ToastProvider>
        <Sidebar collapsed={collapsed} />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('Sidebar › Skills', () => {
  it('is a link to the global Skills page, outside the main navigation', () => {
    renderRail()
    const skills = screen.getByRole('link', { name: 'Skills' })
    expect(skills).toHaveAttribute('href', '/skills')

    const primary = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(primary).queryByRole('link', { name: 'Skills' })).toBeNull()
  })

  it('comes after the topic list, so it cannot be mistaken for a topic', () => {
    renderRail()
    const topic = screen.getByText('Biology')
    const skills = screen.getByRole('link', { name: 'Skills' })
    expect(topic.compareDocumentPosition(skills) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('stays reachable, icon-only, when the rail is collapsed', () => {
    renderRail(true)
    const skills = screen.getByRole('link', { name: 'Skills' })
    expect(skills).toHaveAttribute('title', 'Skills')
    expect(skills).toHaveTextContent('')
  })
})
