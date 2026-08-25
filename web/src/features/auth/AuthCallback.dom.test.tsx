// @vitest-environment jsdom
/**
 * The OAuth callback — see `SignIn.dom.test.tsx` for why this directory has
 * tests at all now. This one decides, based on whether Supabase actually
 * found a session in the URL, whether a visitor lands signed in or gets
 * bounced back to `/signin` — the one branch in this whole directory with
 * real security weight (misroute a signed-in visitor to `/signin` and
 * they're just annoyed; miss the "no session" case and let something
 * through and that's a real hole), so it's tested explicitly rather than
 * only exercised indirectly through Sign In/Sign Up.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCallback } from './AuthCallback'

let mockAuth: { loading: boolean; session: unknown }
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => mockAuth,
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const play = vi.fn(async (_variant: string, work: () => void) => work())
vi.mock('../transitions/Handoff', () => ({
  useHandoff: () => ({ play }),
}))

function renderCallback(initialEntries = ['/auth/callback']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthCallback />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  navigate.mockReset()
  play.mockClear()
})

afterEach(() => {
  cleanup()
})

it('shows a spinner and does not navigate while auth is still resolving', () => {
  mockAuth = { loading: true, session: null }
  renderCallback()

  expect(screen.getByText(/finishing sign-in/i)).toBeInTheDocument()
  expect(navigate).not.toHaveBeenCalled()
  expect(play).not.toHaveBeenCalled()
})

describe('once auth resolves', () => {
  it('bounces to /signin when no session was found in the URL', async () => {
    mockAuth = { loading: false, session: null }
    renderCallback()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/signin', { replace: true }))
    expect(play).not.toHaveBeenCalled()
  })

  it('plays the handoff and lands on /home when a session was found', async () => {
    mockAuth = { loading: false, session: { user: { id: 'u1' } } }
    renderCallback()

    await waitFor(() => expect(play).toHaveBeenCalledWith('threshold', expect.any(Function)))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home', { replace: true }))
  })

  it('honours a ?next= redirect target instead of /home', async () => {
    mockAuth = { loading: false, session: { user: { id: 'u1' } } }
    renderCallback(['/auth/callback?next=%2Fspaces%2Fs1'])

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/spaces/s1', { replace: true }),
    )
  })
})
