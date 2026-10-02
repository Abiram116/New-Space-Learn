// @vitest-environment jsdom
/**
 * A dialog opened from a page that re-renders (the quiz ticks every second)
 * must not take focus back on every render.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

function Ticking({ onLeave }: { onLeave: () => void }) {
  const [, setTick] = useState(0)
  return (
    <>
      <button onClick={() => setTick((t) => t + 1)}>tick</button>
      {/* A new arrow function on every render, like the real callers. */}
      <ConfirmDialog open title="Leave?" confirmLabel="Leave" onCancel={() => {}} onConfirm={onLeave} />
    </>
  )
}

describe('Modal focus', () => {
  it('keeps the button the keyboard chose when the parent re-renders', () => {
    render(<Ticking onLeave={vi.fn()} />)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const leave = screen.getByRole('button', { name: 'Leave' })
    expect(cancel).toHaveFocus()

    fireEvent.keyDown(cancel, { key: 'ArrowRight' })
    expect(leave).toHaveFocus()

    for (let i = 0; i < 3; i++) act(() => void fireEvent.click(screen.getByText('tick')))
    expect(leave).toHaveFocus()
  })

  it('Esc still closes using the latest onClose', () => {
    const onCancel = vi.fn()
    const { rerender } = render(
      <ConfirmDialog open title="Leave?" confirmLabel="Leave" onCancel={() => {}} onConfirm={() => {}} />,
    )
    rerender(<ConfirmDialog open title="Leave?" confirmLabel="Leave" onCancel={onCancel} onConfirm={() => {}} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
