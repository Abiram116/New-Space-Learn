// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Stepper } from './parts'

afterEach(cleanup)

function setup(value = 30) {
  const onCommit = vi.fn()
  render(<Stepper value={value} min={5} max={60} step={5} unit="min" label="Length" onCommit={onCommit} />)
  return { onCommit, box: screen.getByRole('spinbutton', { name: 'Length' }) }
}

describe('Stepper', () => {
  it('exposes spinbutton semantics', () => {
    const { box } = setup()
    expect(box).toHaveAttribute('aria-valuemin', '5')
    expect(box).toHaveAttribute('aria-valuemax', '60')
    expect(box).toHaveAttribute('aria-valuenow', '30')
  })

  it('increments and decrements, saving once', () => {
    vi.useFakeTimers()
    const { onCommit, box } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Increase Length' }))
    fireEvent.click(screen.getByRole('button', { name: 'Increase Length' }))
    expect(box).toHaveValue('40')
    vi.advanceTimersByTime(500)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(40)
    vi.useRealTimers()
  })

  it('clamps to the limits and handles the keyboard', () => {
    const { onCommit, box } = setup(58)
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(box).toHaveValue('60')
    expect(screen.getByRole('button', { name: 'Increase Length' })).toBeDisabled()
    fireEvent.keyDown(box, { key: 'PageDown' })
    expect(box).toHaveValue('10')
    fireEvent.keyDown(box, { key: 'Home' })
    expect(box).toHaveValue('5')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onCommit).toHaveBeenLastCalledWith(5)
  })
})
