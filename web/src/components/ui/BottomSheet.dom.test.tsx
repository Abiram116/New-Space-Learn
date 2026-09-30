// @vitest-environment jsdom
/**
 * Every existing modal becomes a bottom sheet on a phone without touching a
 * call site — exercised through ConfirmDialog, the most common one. The
 * drag thresholds are covered on their own in `sheetDrag.test.ts`.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

function setViewport(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  cleanup()
  // @ts-expect-error — restore jsdom's default (no matchMedia).
  delete window.matchMedia
})

function renderConfirm(onCancel = vi.fn()) {
  render(
    <ConfirmDialog
      open
      title="Delete this deck?"
      description="Its cards go with it."
      confirmLabel="Delete"
      destructive
      onCancel={onCancel}
      onConfirm={() => {}}
    />,
  )
  return onCancel
}

describe('Modal on a phone', () => {
  it('renders as a bottom sheet with the same content and actions', () => {
    setViewport(true)
    renderConfirm()
    const dialog = screen.getByRole('dialog', { name: 'Delete this deck?' })
    expect(dialog.closest('[data-sheet-root]')).not.toBeNull()
    expect(screen.getByText('Its cards go with it.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('moves focus into the sheet and closes on Escape', () => {
    setViewport(true)
    const onCancel = renderConfirm()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('traps Tab inside the sheet', () => {
    setViewport(true)
    renderConfirm()
    screen.getByRole('button', { name: 'Delete' }).focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('closes on a backdrop tap', () => {
    setViewport(true)
    const onCancel = renderConfirm()
    const backdrop = document.querySelector('[data-sheet-root] > [aria-hidden]') as HTMLElement
    fireEvent.click(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('Modal on desktop', () => {
  it('stays the centred dialog', () => {
    setViewport(false)
    renderConfirm()
    expect(screen.getByRole('dialog', { name: 'Delete this deck?' })).toBeInTheDocument()
    expect(document.querySelector('[data-sheet-root]')).toBeNull()
  })
})
