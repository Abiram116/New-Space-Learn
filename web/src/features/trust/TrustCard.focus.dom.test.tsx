// @vitest-environment jsdom
/**
 * The card is a modal dialog: focus moves into it, Tab stays with the card and
 * the corner links that are its tabs, and focus goes back to whatever opened
 * it. jsdom does not move focus on Tab, so — as in `Modal.focus.dom.test` —
 * only the two ends, where the card's own code steps in, are asserted.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { TrustCard } from './TrustCard'

afterEach(cleanup)

function open() {
  const opener = document.createElement('button')
  opener.textContent = 'Privacy (in the page)'
  document.body.appendChild(opener)
  opener.focus()
  const view = render(
    <MemoryRouter initialEntries={['/privacy']}>
      <TrustCard slug="privacy" motion="enter" onClose={() => {}} />
    </MemoryRouter>,
  )
  const dialog = screen.getByRole('dialog', { name: 'Privacy' })
  const tabs = within(screen.getByRole('navigation', { name: 'About Space Learn' })).getAllByRole('link')
  const inCard = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button'))
  return { opener, view, dialog, firstStop: tabs[0], lastTab: tabs[tabs.length - 1], lastStop: inCard[inCard.length - 1] }
}

describe('TrustCard as a dialog', () => {
  it('is modal, takes focus on open and gives it back on close', () => {
    const { opener, view, dialog } = open()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(dialog)
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('Tab past the last control comes round to the first, and back', () => {
    const { opener, firstStop, lastStop } = open()
    lastStop.focus()
    fireEvent.keyDown(lastStop, { key: 'Tab' })
    expect(document.activeElement).toBe(firstStop)

    fireEvent.keyDown(firstStop, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(lastStop)
    opener.remove()
  })

  it('Shift+Tab from the card itself goes to its tabs, not the page underneath', () => {
    const { opener, dialog, lastTab } = open()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(lastTab)
    opener.remove()
  })

  it('pulls focus back in if it has ended up outside', () => {
    const { opener, firstStop } = open()
    opener.focus()
    fireEvent.keyDown(opener, { key: 'Tab' })
    expect(document.activeElement).toBe(firstStop)
    opener.remove()
  })

  it('puts the tab title back only if nothing else has named the tab since', () => {
    document.title = 'Space Learn'
    const first = open()
    expect(document.title).toBe('Privacy · Space Learn')
    first.view.unmount()
    expect(document.title).toBe('Space Learn')
    first.opener.remove()

    const second = open()
    document.title = 'Sign in · Space Learn'
    second.view.unmount()
    expect(document.title).toBe('Sign in · Space Learn')
    second.opener.remove()
  })
})
