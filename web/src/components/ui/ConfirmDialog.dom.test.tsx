// @vitest-environment jsdom
/**
 * `ConfirmDialog` is the shared destructive-action dialog behind every
 * delete flow in the app (Docs, Notes, Skills, Spaces/Subspaces — Cards uses
 * a different, already-safe "close first" pattern, see FlashcardsView). The
 * double-submit fix in each caller is just "pass `loading={busy}`" — this
 * proves that prop actually does its job once, here, rather than trusting
 * each caller's own test to notice if `Button`'s `disabled` handling ever
 * regressed.
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

describe('ConfirmDialog', () => {
  it('disables Confirm and Cancel while loading, so a second click cannot fire another request', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(
      <ConfirmDialog
        open
        title="Delete note"
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        destructive
        loading
      />,
    )

    const confirmBtn = screen.getByRole('button', { name: 'Working…' })
    expect(confirmBtn).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    await user.click(confirmBtn)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows the neutral label and enabled buttons when not loading', () => {
    render(
      <ConfirmDialog
        open
        title="Delete note"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        destructive
      />,
    )

    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })
})
