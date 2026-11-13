// @vitest-environment jsdom
/**
 * The linked-topics map in the chat dock. It is a drawing on top of a real
 * list of buttons, so everything here is driven the way a keyboard or screen
 * reader user would: by name. And it must call the same link endpoints the
 * old list did.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Space, Subspace } from '../../api/types'
import { ToastProvider } from '../../components/ui/Toast'

const api = vi.hoisted(() => ({
  listSubspaceLinks: vi.fn(),
  createSubspaceLink: vi.fn(),
  deleteSubspaceLink: vi.fn(),
}))
vi.mock('../../api/spaces', () => api)

const sub = (id: string, name: string, subject: string): Subspace => ({
  id,
  subject_id: subject,
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  last_activity_at: null,
  counts: {},
})
const HERE = sub('t1', 'Attention', 's1')
const ALGEBRA = sub('t2', 'Linear Algebra', 's2')
const PROB = sub('t3', 'Probability', 's2')
const SPACES: Space[] = [
  { id: 's1', name: 'Deep Learning', slug: 'dl', tone: 'brand', pinned: false, subspaces: [HERE] },
  { id: 's2', name: 'Maths', slug: 'maths', tone: 'sky', pinned: false, subspaces: [ALGEBRA, PROB] },
]
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: SPACES, loading: false }) }))

import { DockLinkedTopics } from './DockLinkedTopics'

function Where() {
  const l = useLocation()
  return <span data-testid="where">{l.pathname}</span>
}

const renderMap = () =>
  render(
    <MemoryRouter initialEntries={['/dl/attention']}>
      <ToastProvider>
        <DockLinkedTopics subspaceId="t1" />
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  api.listSubspaceLinks.mockResolvedValue([ALGEBRA])
  api.createSubspaceLink.mockResolvedValue(undefined)
  api.deleteSubspaceLink.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DockLinkedTopics', () => {
  it('says in one line what linking does, and lists each linked topic as a button', async () => {
    renderMap()
    expect(screen.getByText('When you ask, I also read the files in these topics.')).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Linked topics' })
    expect(within(list).getByRole('button', { name: 'Open Linear Algebra (Maths)' })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Link a topic' })).toBeInTheDocument()
  })

  it('opens a linked topic from its node', async () => {
    renderMap()
    await userEvent.setup().click(await screen.findByRole('button', { name: /Open Linear Algebra/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/maths/linear-algebra')
  })

  it('links another topic from the + node, through the same endpoint', async () => {
    renderMap()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Link a topic' }))
    api.listSubspaceLinks.mockResolvedValue([ALGEBRA, PROB])
    await user.click(screen.getByRole('button', { name: /Probability/ }))
    expect(api.createSubspaceLink).toHaveBeenCalledWith('t1', 't3')
    expect(await screen.findByRole('button', { name: 'Open Probability (Maths)' })).toBeInTheDocument()
  })

  it('unlinks from Edit, which is also the plain list', async () => {
    renderMap()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Unlink Linear Algebra' }))
    expect(api.deleteSubspaceLink).toHaveBeenCalledWith('t1', 't2')
    await waitFor(() => expect(screen.queryByRole('button', { name: /Open Linear Algebra/ })).not.toBeInTheDocument())
  })

  it('with nothing linked, offers only the + node and no Edit', async () => {
    api.listSubspaceLinks.mockResolvedValue([])
    renderMap()
    expect(await screen.findByRole('button', { name: 'Link a topic' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
