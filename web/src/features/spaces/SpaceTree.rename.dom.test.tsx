// @vitest-environment jsdom
/**
 * Regression for a real duplicate-request bug: confirming a rename with
 * Enter called `renameSpace`/`renameSubspace` twice.
 *
 * `commitRename` used to clear `renamingSpace` (unmounting the input)
 * *before* awaiting the API call. Removing a focused element fires a native
 * `blur` in a real browser, and the input's `onBlur` is *also* wired to
 * `commitRename` — so one Enter press produced two PATCH requests: one from
 * `onKeyDown`, one from the blur its own state update triggered. Same shape
 * for topics (`commitRenameSubspace`).
 *
 * jsdom does not fire `blur` automatically when a focused node is removed
 * from the DOM (real browsers do) — a first version of this test relied on
 * that and passed even against the unguarded, actually-buggy code. A second
 * version fired `keyDown` then `blur` as two separate `fireEvent` calls, but
 * each `fireEvent` flushes React's state update before returning, so by the
 * time `blur` fired the input was already unmounted and the event landed on
 * a detached node — still a false pass. Wrapping both dispatches in one
 * `act()` block defers that flush until after *both* handlers have run
 * synchronously, matching what a real browser actually does in one tick:
 * `onKeyDown` starts the first `commitRename`, and only then does the state
 * update (and the resulting unmount) become visible — which is exactly when
 * the guard has to already be in place.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Space, Subspace } from '../../api/types'

const subspace: Subspace = {
  id: 'sub-1',
  subject_id: 'space-1',
  name: 'Attention',
  last_activity_at: null,
  counts: {},
}
const space: Space = {
  id: 'space-1',
  name: 'CS',
  tone: 'brand',
  pinned: false,
  subspaces: [subspace],
}

const renameSpace = vi.fn().mockResolvedValue(undefined)
const renameSubspace = vi.fn().mockResolvedValue(undefined)

vi.mock('./SpacesProvider', () => ({
  useSpaces: () => ({
    spaces: [space],
    addSubspace: vi.fn(),
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

/** Enter, then the blur a real browser fires when that Enter's handler
 *  unmounts the (still-focused) input — the exact sequence the guard in
 *  `commitRename`/`commitRenameSubspace` exists to make idempotent. Both
 *  dispatches share one `act()` so neither's state update flushes (and
 *  unmounts the input) until after both handlers have fired. */
function confirmWithEnterThenBlur(input: HTMLElement) {
  act(() => {
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
  })
}

describe('SpaceTree rename — no duplicate request from Enter + the blur it triggers', () => {
  afterEach(() => {
    cleanup()
    renameSpace.mockClear()
    renameSubspace.mockClear()
  })

  it('renaming a subject calls renameSpace exactly once', async () => {
    const user = userEvent.setup()
    renderTree()

    await user.click(screen.getByRole('button', { name: 'Actions for CS' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const input = screen.getByRole('textbox', { name: 'Rename CS' })
    await user.clear(input)
    await user.type(input, 'Computer Science')
    confirmWithEnterThenBlur(input)

    expect(renameSpace).toHaveBeenCalledTimes(1)
    expect(renameSpace).toHaveBeenCalledWith('space-1', 'Computer Science')
  })

  it('renaming a topic calls renameSubspace exactly once', async () => {
    const user = userEvent.setup()
    renderTree()

    // An untouched subject only defaults open if it's the active route's
    // space or has zero topics (see treeState.ts) — neither is true in this
    // MemoryRouter with no :spaceId, so expand it explicitly first.
    await user.click(screen.getByRole('button', { name: 'CS' }))
    await user.click(screen.getByRole('button', { name: 'Actions for Attention' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const input = screen.getByRole('textbox', { name: 'Rename Attention' })
    await user.clear(input)
    await user.type(input, 'Self-Attention')
    confirmWithEnterThenBlur(input)

    expect(renameSubspace).toHaveBeenCalledTimes(1)
    expect(renameSubspace).toHaveBeenCalledWith('sub-1', 'Self-Attention')
  })
})
