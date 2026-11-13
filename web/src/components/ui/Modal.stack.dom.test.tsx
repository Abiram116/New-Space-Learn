// @vitest-environment jsdom
/**
 * Stacked dialogs: a confirm opened over a form. One press of Escape closes
 * the one on top and leaves the one underneath open — on a desktop (centred
 * modals) and on a phone (bottom sheets).
 */

import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal } from './Modal'
import { Select } from './Select'

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

function Stacked() {
  const [form, setForm] = useState(true)
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <Modal open={form} onClose={() => setForm(false)} title="Edit deck">
        <button type="button" onClick={() => setConfirm(true)}>
          Delete deck
        </button>
      </Modal>
      <ConfirmDialog
        open={confirm}
        title="Delete this deck?"
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => setConfirm(false)}
      />
    </>
  )
}

describe.each([
  ['desktop', false],
  ['phone', true],
])('stacked dialogs on a %s', (_name, phone) => {
  it('Escape closes only the dialog on top', () => {
    setViewport(phone)
    render(<Stacked />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete deck' }))
    expect(screen.getByRole('dialog', { name: 'Delete this deck?' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    // The sheet stays mounted while it slides out, so ask what is still open
    // by pressing again: the first press must not have reached the form.
    expect(screen.getByRole('dialog', { name: 'Edit deck' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete deck' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    if (!phone) expect(screen.queryByRole('dialog', { name: 'Edit deck' })).toBeNull()
  })

  it('the first Escape leaves the form open; the second closes it', () => {
    setViewport(phone)
    const closed: string[] = []
    function Probe() {
      const [confirm, setConfirm] = useState(true)
      return (
        <>
          <Modal open onClose={() => closed.push('form')} title="Edit deck">
            body
          </Modal>
          <ConfirmDialog
            open={confirm}
            title="Sure?"
            confirmLabel="Yes"
            onCancel={() => {
              closed.push('confirm')
              setConfirm(false)
            }}
            onConfirm={() => {}}
          />
        </>
      )
    }
    render(<Probe />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closed).toEqual(['confirm'])
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closed).toEqual(['confirm', 'form'])
  })
})

describe('a dropdown open inside a dialog', () => {
  it('Escape closes the dropdown, not the dialog', () => {
    setViewport(false)
    let closes = 0
    render(
      <Modal open onClose={() => (closes += 1)} title="Filter">
        <Select value="a" onChange={() => {}} ariaLabel="Subject" options={[{ value: 'a', label: 'A' }]} />
      </Modal>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Subject' }))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(closes).toBe(0)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closes).toBe(1)
  })
})

describe('the backdrop', () => {
  const setup = () => {
    setViewport(false)
    let closes = 0
    render(
      <Modal open onClose={() => (closes += 1)} title="Rename">
        <input aria-label="Name" defaultValue="Biology" />
      </Modal>,
    )
    return { backdrop: screen.getByRole('dialog', { name: 'Rename' }), count: () => closes }
  }

  it('closes on a click that starts and ends on it', () => {
    const { backdrop, count } = setup()
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(count()).toBe(1)
  })

  it('does not close when a drag that began in a field is let go outside the panel', () => {
    const { backdrop, count } = setup()
    fireEvent.mouseDown(screen.getByLabelText('Name'))
    // The browser reports the click on the nearest common ancestor: the backdrop.
    fireEvent.click(backdrop)
    expect(count()).toBe(0)
  })
})
