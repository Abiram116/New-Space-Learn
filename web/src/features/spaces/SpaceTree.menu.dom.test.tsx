// @vitest-environment jsdom
/**
 * The subject/topic `⋯` menu: where it opens and what gets focus.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'

vi.mock('./SpacesProvider', () => ({
  useSpaces: () => ({
    spaces: [
      {
        id: 'space-1',
        name: 'CS',
        tone: 'brand',
        pinned: false,
        subspaces: [{ id: 'sub-1', subject_id: 'space-1', name: 'Attention', last_activity_at: null, counts: {} }],
      },
    ],
    loading: false,
    createSpace: vi.fn(),
    createSubspace: vi.fn(),
    renameSpace: vi.fn(),
    renameSubspace: vi.fn(),
    deleteSpace: vi.fn(),
    deleteSubspace: vi.fn(),
    setPinned: vi.fn(),
  }),
}))

import { SpaceTree } from './SpaceTree'

afterEach(cleanup)

function renderTree() {
  render(
    <ToastProvider>
      <MemoryRouter>
        <SpaceTree />
      </MemoryRouter>
    </ToastProvider>,
  )
  const trigger = screen.getByRole('button', { name: 'Actions for CS' })
  // A rail-sized trigger near the left of a wide window.
  trigger.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 180, right: 220, width: 40, height: 40, x: 180, y: 100, toJSON: () => ({}) })
  return trigger
}

describe('row ⋯ menu', () => {
  it('opens beside the button, level with its row — not over the rows below', () => {
    const trigger = renderTree()
    fireEvent.click(trigger, { detail: 1 })
    const menu = screen.getByRole('menu', { name: 'Actions for CS' })
    expect(menu.style.left).toBe('226px') // 220 + 6
    expect(menu.style.top).toBe('100px')
  })

  it('opened with the mouse, no item wears a focus ring; the arrows still work', () => {
    const trigger = renderTree()
    fireEvent.click(trigger, { detail: 1 })
    const menu = screen.getByRole('menu', { name: 'Actions for CS' })
    expect(menu).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Pin to top' })).toHaveFocus()
  })

  it('opened from the keyboard, focus goes straight to the first item', () => {
    const trigger = renderTree()
    fireEvent.click(trigger, { detail: 0 })
    expect(screen.getByRole('menuitem', { name: 'Pin to top' })).toHaveFocus()
  })

  it('the name and the ⋯ share one row, so one focus ring can wrap both', () => {
    const trigger = renderTree()
    const row = trigger.closest('.group\\/row') as HTMLElement
    expect(row).toContainElement(screen.getByText('CS'))
    expect(row.className).toMatch(/has-\[:focus-visible\]:outline-2/)
  })

  it('the hover strip belongs to the row (name and ⋯ together); the ⋯ has its own stronger chip', () => {
    const trigger = renderTree()
    const row = trigger.closest('.group\\/row') as HTMLElement
    const name = screen.getByText('CS').closest('button') as HTMLElement
    expect(row.className).toMatch(/hover:bg-line-soft/)
    expect(name.className).not.toMatch(/hover:bg-/)
    expect(trigger.className).toMatch(/hover:bg-white\/10/)
  })

  it('renaming: one ring on the field, no row ring around it, and no ⋯ beside it', () => {
    const trigger = renderTree()
    fireEvent.click(trigger, { detail: 1 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Rename CS' })
    const row = input.closest('.group\\/row') as HTMLElement
    expect(row.className).not.toMatch(/has-\[:focus-visible\]:outline-2/)
    expect(input.className).toMatch(/ring-1/)
    expect(screen.queryByRole('button', { name: 'Actions for CS' })).toBeNull()
  })
})

