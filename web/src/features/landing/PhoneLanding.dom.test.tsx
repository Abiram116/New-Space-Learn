// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'

vi.mock('../../routes/lazyRoutes', () => ({ prefetchAuthChunks: () => {} }))

import { PhoneLanding } from './PhoneLanding'

afterEach(cleanup)

function renderIt() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PhoneLanding />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('landing on a phone', () => {
  it('has one Get started, the honest device line, and a way to send the link', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    renderIt()

    expect(screen.getAllByRole('link', { name: /Get started/ })).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Get started/ })).toHaveAttribute('href', '/signup')
    expect(
      screen.getByText('Revise anywhere on your phone. Add files and chat with the tutor on a computer.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Send myself the link/ }))
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({ title: 'Space Learn', url: `${window.location.origin}/welcome` }),
    )
    Reflect.deleteProperty(navigator, 'share')
  })
})
