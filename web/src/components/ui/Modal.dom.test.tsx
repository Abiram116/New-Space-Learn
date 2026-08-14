// @vitest-environment jsdom
/**
 * Modal's focus management, exercised through the configuration every
 * destructive action in the app actually renders — `ConfirmDialog` (delete
 * note/deck/card/space, sign out, delete account) — rather than a synthetic
 * fixture with its own made-up shape.
 *
 * jsdom has no layout engine, so a bare Tab keypress never moves focus the
 * way a real browser does — there is nothing meaningful to assert about the
 * *middle* of a tab sequence (Cancel -> Confirm), because the browser does
 * that, not Modal. What Modal's own code does, and the only thing worth
 * pinning here, is intervene at the two boundaries: Tab past the last
 * focusable control wraps to the first, and Shift+Tab past the first wraps
 * to the last. Both are asserted by reading `document.activeElement` after
 * firing the key — not by asserting `preventDefault` was called, which a
 * broken implementation (wrong element focused, or none at all) could still
 * satisfy.
 */

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      {/* Stands in for the rest of the page. If a wrap-around ever escaped
          the dialog, this is what it would land on. */}
      <button type="button">Behind the modal</button>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ConfirmDialog
        open={open}
        title="Delete this?"
        description="This can't be undone."
        confirmLabel="Delete"
        destructive
        onCancel={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
      />
    </div>
  )
}

afterEach(() => {
  cleanup()
})

describe("Modal's focus management (via ConfirmDialog)", () => {
  it('moves focus into the dialog on open', () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()

    fireEvent.click(opener)

    // First focusable control in the dialog's DOM order is Cancel.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('wraps Tab from the last control back to the first, not out to the page', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Delete' })
    const behind = screen.getByRole('button', { name: 'Behind the modal' })
    confirm.focus()
    expect(document.activeElement).toBe(confirm)

    fireEvent.keyDown(window, { key: 'Tab' })

    expect(document.activeElement).toBe(cancel)
    expect(document.activeElement).not.toBe(behind)
  })

  it('wraps Shift+Tab from the first control back to the last', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(document.activeElement).toBe(cancel)

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(confirm)
  })

  it('restores focus to the element that opened it, on close', () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(document.activeElement).toBe(opener)
  })
})
