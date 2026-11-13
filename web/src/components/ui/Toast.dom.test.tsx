// @vitest-environment jsdom
/**
 * Toasts are the fallback surface for things that went wrong, so they have to
 * stay readable when a lot goes wrong at once.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './Toast'

let toast: ReturnType<typeof useToast>
function Grab() {
  toast = useToast()
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  render(
    <ToastProvider>
      <Grab />
    </ToastProvider>,
  )
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const shown = () => screen.queryAllByRole('button').map((b) => b.textContent)

describe('Toast', () => {
  it('goes away on its own, errors staying longer, and on a click', () => {
    act(() => {
      toast.show('Saved.', 'success')
      toast.show('Could not save.', 'error')
    })
    expect(shown()).toEqual(['Saved.', 'Could not save.'])
    act(() => void vi.advanceTimersByTime(3600))
    expect(shown()).toEqual(['Could not save.'])
    fireEvent.click(screen.getByRole('button', { name: 'Could not save.' }))
    expect(shown()).toEqual([])
  })

  it('says the same thing once, and keeps it up from the latest time it was said', () => {
    act(() => {
      toast.show('Could not reach the server.', 'error')
      toast.show('Could not reach the server.', 'error')
    })
    expect(shown()).toEqual(['Could not reach the server.'])
    act(() => void vi.advanceTimersByTime(5000))
    act(() => toast.show('Could not reach the server.', 'error'))
    act(() => void vi.advanceTimersByTime(5000))
    expect(shown()).toEqual(['Could not reach the server.'])
    act(() => void vi.advanceTimersByTime(1100))
    expect(shown()).toEqual([])
  })

  it('never stacks more than three: the oldest gives way', () => {
    act(() => {
      for (const n of [1, 2, 3, 4, 5]) toast.show(`Problem ${n}`, 'error')
    })
    expect(shown()).toEqual(['Problem 3', 'Problem 4', 'Problem 5'])
    act(() => void vi.advanceTimersByTime(6100))
    expect(shown()).toEqual([])
  })
})
