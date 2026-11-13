// @vitest-environment jsdom
/**
 * The rail's in-place fields — rename, and "Add topic" — and what the rail
 * shows when it has no subjects.
 *
 * Every in-place field commits on blur, and a browser blurs a focused input
 * as it is removed. So closing one of these fields for ANY reason ran its
 * commit: Escape saved the rename it was cancelling, Escape on a new topic
 * created the topic, and Enter on a new topic could create it twice.
 *
 * jsdom does not fire that blur by itself, so — as in
 * `SpaceTree.rename.dom.test.tsx` — the key and the blur are dispatched inside
 * one `act()`, before React removes the input.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Space, Subspace } from '../../api/types'

const subspace: Subspace = { id: 'sub-1', subject_id: 'space-1', name: 'Attention', last_activity_at: null, counts: {} }
const space: Space = { id: 'space-1', name: 'CS', tone: 'brand', pinned: false, subspaces: [subspace] }

const renameSpace = vi.fn().mockResolvedValue(undefined)
const renameSubspace = vi.fn().mockResolvedValue(undefined)
const addSubspace = vi.fn()
const refresh = vi.fn().mockResolvedValue(undefined)
let state: { spaces: Space[]; error: string | null } = { spaces: [space], error: null }

vi.mock('./SpacesProvider', () => ({
  useSpaces: () => ({
    ...state,
    loading: false,
    refresh,
    addSubspace,
    deleteSpace: vi.fn(),
    deleteSubspace: vi.fn(),
    renameSpace,
    renameSubspace,
    setPinned: vi.fn(),
  }),
}))

import { SpaceTree } from './SpaceTree'

function renderTree() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <SpaceTree />
      </MemoryRouter>
    </ToastProvider>,
  )
}

/** A key, then the blur the browser fires when that key's handler removes the input. */
function keyThenBlur(input: HTMLElement, key: string) {
  act(() => {
    fireEvent.keyDown(input, { key })
    fireEvent.blur(input)
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  state = { spaces: [space], error: null }
})

describe('Escape cancels a rename', () => {
  it('does not save a subject name that was typed and then escaped', async () => {
    const user = userEvent.setup()
    renderTree()
    await user.click(screen.getByRole('button', { name: 'Actions for CS' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Rename CS' })
    await user.clear(input)
    await user.type(input, 'Wrong name')

    keyThenBlur(input, 'Escape')

    expect(renameSpace).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'CS' })).toBeInTheDocument()
  })

  it('does not save a topic name that was typed and then escaped', async () => {
    const user = userEvent.setup()
    renderTree()
    await user.click(screen.getByRole('button', { name: 'CS' }))
    await user.click(screen.getByRole('button', { name: 'Actions for Attention' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Rename Attention' })
    await user.clear(input)
    await user.type(input, 'Wrong name')

    keyThenBlur(input, 'Escape')

    expect(renameSubspace).not.toHaveBeenCalled()
  })

  it('still saves the next rename of the same row', async () => {
    const user = userEvent.setup()
    renderTree()
    await user.click(screen.getByRole('button', { name: 'Actions for CS' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    // Escape with no blur after it — a browser that does not blur on removal.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename CS' }), { key: 'Escape' })

    await user.click(screen.getByRole('button', { name: 'Actions for CS' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Rename CS' })
    await user.clear(input)
    await user.type(input, 'Computer Science')
    keyThenBlur(input, 'Enter')

    expect(renameSpace).toHaveBeenCalledTimes(1)
    expect(renameSpace).toHaveBeenCalledWith('space-1', 'Computer Science')
  })
})

describe('adding a topic from the rail', () => {
  async function openField() {
    const user = userEvent.setup()
    renderTree()
    await user.click(screen.getByRole('button', { name: 'CS' }))
    await user.click(screen.getByRole('button', { name: 'Add topic' }))
    const input = screen.getByRole('textbox', { name: 'New topic in CS' })
    await user.type(input, 'Transformers')
    return input
  }

  it('creates nothing when the name is escaped', async () => {
    const input = await openField()

    keyThenBlur(input, 'Escape')

    expect(addSubspace).not.toHaveBeenCalled()
  })

  it('creates the topic once for Enter and the blur that follows it', async () => {
    addSubspace.mockResolvedValue({ ...subspace, id: 'sub-2', name: 'Transformers' })
    const input = await openField()

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.blur(input)
    })

    expect(addSubspace).toHaveBeenCalledTimes(1)
    expect(addSubspace).toHaveBeenCalledWith('space-1', 'Transformers')
  })

  it('keeps the field, and can be sent again, when the request fails', async () => {
    addSubspace.mockRejectedValueOnce(new Error('offline'))
    addSubspace.mockResolvedValue({ ...subspace, id: 'sub-2', name: 'Transformers' })
    const input = await openField()

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(screen.getByRole('textbox', { name: 'New topic in CS' })).toHaveValue('Transformers')

    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'New topic in CS' }), { key: 'Enter' })
    })
    expect(addSubspace).toHaveBeenCalledTimes(2)
  })
})

describe('a rail with no subjects', () => {
  it('says so, and points at the + for a new account', () => {
    state = { spaces: [], error: null }
    renderTree()

    expect(screen.getByText(/No subjects yet/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers a retry when the list failed to load, instead of a blank rail', async () => {
    state = { spaces: [], error: "Can't reach the server." }
    renderTree()

    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load your subjects.')
    expect(screen.queryByText(/No subjects yet/)).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
