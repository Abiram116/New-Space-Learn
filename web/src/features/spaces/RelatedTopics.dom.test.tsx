// @vitest-environment jsdom
/**
 * "Related topics": the links a topic draws on, and the picker that adds one.
 *
 * Two dead ends. A failed load left the control rendering nothing at all — a
 * toast, then no way to link or unlink until a reload. And the picker, once
 * open, only closed from its own button: Escape and a click elsewhere did
 * nothing, so it sat over the page.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'

const listSubspaceLinks = vi.fn()
vi.mock('../../api/spaces', () => ({
  listSubspaceLinks: (...a: unknown[]) => listSubspaceLinks(...a),
  createSubspaceLink: vi.fn(),
  deleteSubspaceLink: vi.fn(),
}))
vi.mock('./SpacesProvider', () => ({
  useSpaces: () => ({
    spaces: [
      {
        id: 'sp-1',
        name: 'Maths',
        tone: 'brand',
        pinned: false,
        subspaces: [
          { id: 'sub-1', subject_id: 'sp-1', name: 'Calculus', last_activity_at: null, counts: {} },
          { id: 'sub-2', subject_id: 'sp-1', name: 'Linear algebra', last_activity_at: null, counts: {} },
        ],
      },
    ],
  }),
}))

import { RelatedTopics } from './RelatedTopics'

function renderLinks() {
  return render(
    <ToastProvider>
      <button type="button">elsewhere</button>
      <RelatedTopics subspaceId="sub-1" />
    </ToastProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Related topics', () => {
  it('offers a retry when the links fail to load, instead of disappearing', async () => {
    listSubspaceLinks.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([])
    const user = userEvent.setup()
    renderLinks()

    await user.click(await screen.findByRole('button', { name: /Couldn’t load related topics/ }))

    expect(await screen.findByRole('button', { name: 'Link a topic' })).toBeInTheDocument()
    expect(listSubspaceLinks).toHaveBeenCalledTimes(2)
  })

  it('closes the picker on Escape and on a click elsewhere', async () => {
    listSubspaceLinks.mockResolvedValue([])
    const user = userEvent.setup()
    renderLinks()
    const trigger = await screen.findByRole('button', { name: 'Link a topic' })

    await user.click(trigger)
    expect(screen.getByRole('button', { name: /Linear algebra/ })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /Linear algebra/ })).not.toBeInTheDocument()

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByRole('button', { name: /Linear algebra/ })).not.toBeInTheDocument()
  })
})
