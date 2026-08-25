// @vitest-environment jsdom
/**
 * Sign-in, mounted for real. This whole directory had zero tests before —
 * the highest-risk gap in the app to leave untested, since it's the one
 * screen that decides whether someone gets a session at all.
 *
 * Covers the paths that actually matter: client-side validation blocking a
 * request before it's sent, a wrong password surfacing a message without
 * ever navigating, a correct one navigating to the right place, the
 * unconfirmed-email recovery path, forgot-password, and Google sign-in.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/errors'
import { ToastProvider } from '../../components/ui/Toast'
import { SignIn } from './SignIn'

// `ArtifactField` (inside `AuthShell`) reads pointer position via
// `usePointerParallax`, which calls `matchMedia` on mount — jsdom has no
// layout engine and doesn't implement it at all.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const signInWithPassword = vi.fn()
const signInWithGoogle = vi.fn()
const sendPasswordReset = vi.fn()
const resendConfirmation = vi.fn()

vi.mock('../../api/auth', () => ({
  signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
  signInWithGoogle: (...args: unknown[]) => signInWithGoogle(...args),
  sendPasswordReset: (...args: unknown[]) => sendPasswordReset(...args),
  resendConfirmation: (...args: unknown[]) => resendConfirmation(...args),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

// The handoff transition is a GSAP curtain animation with no equivalent in
// jsdom — real behaviour here is "does the work run and does it run once",
// not the choreography, so it's mocked down to exactly that.
vi.mock('../transitions/Handoff', () => ({
  useHandoff: () => ({ play: async (_variant: string, work: () => void) => work() }),
}))

function renderSignIn(initialEntries = ['/signin']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ToastProvider>
        <SignIn />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  signInWithPassword.mockReset()
  signInWithGoogle.mockReset()
  sendPasswordReset.mockReset()
  resendConfirmation.mockReset()
  navigate.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('validation', () => {
  it('blocks submission on an invalid email without calling the API', async () => {
    const user = userEvent.setup()
    renderSignIn()
    await user.type(screen.getByLabelText(/email/i), 'not-an-email')
    await user.type(screen.getByLabelText(/password/i), 'longenough')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/enter a valid email/i)).toBeInTheDocument()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('blocks submission on a too-short password without calling the API', async () => {
    const user = userEvent.setup()
    renderSignIn()
    await user.type(screen.getByLabelText(/email/i), 'maya@studies.edu')
    await user.type(screen.getByLabelText(/password/i), 'short')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/at least 6 characters/i)).toBeInTheDocument()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })
})

describe('signing in', () => {
  it('signs in with the typed credentials and lands on /home by default', async () => {
    signInWithPassword.mockResolvedValue({ user: { id: 'u1' } })
    const user = userEvent.setup()
    renderSignIn()
    await user.type(screen.getByLabelText(/email/i), 'maya@studies.edu')
    await user.type(screen.getByLabelText(/password/i), 'correcthorse')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith('maya@studies.edu', 'correcthorse'),
    )
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home', { replace: true }))
  })

  it('honours a ?next= redirect target instead of the default', async () => {
    signInWithPassword.mockResolvedValue({ user: { id: 'u1' } })
    const user = userEvent.setup()
    renderSignIn(['/signin?next=%2Fspaces%2Fs1'])
    await user.type(screen.getByLabelText(/email/i), 'maya@studies.edu')
    await user.type(screen.getByLabelText(/password/i), 'correcthorse')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/spaces/s1', { replace: true }))
  })

  it('shows a wrong-password error and never navigates', async () => {
    signInWithPassword.mockRejectedValue(
      new ApiError('validation_error', 'Email or password is incorrect.'),
    )
    const user = userEvent.setup()
    renderSignIn()
    await user.type(screen.getByLabelText(/email/i), 'maya@studies.edu')
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/email or password is incorrect/i)).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('offers a resend link for an unconfirmed account, and it re-sends to the typed email', async () => {
    signInWithPassword.mockRejectedValue(
      new ApiError('validation_error', 'Confirm your email before signing in.'),
    )
    resendConfirmation.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderSignIn()
    await user.type(screen.getByLabelText(/email/i), 'maya@studies.edu')
    await user.type(screen.getByLabelText(/password/i), 'correcthorse')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    const resend = await screen.findByRole('button', { name: /resend confirmation email/i })
    await user.click(resend)

    await waitFor(() => expect(resendConfirmation).toHaveBeenCalledWith('maya@studies.edu'))
  })
})

describe('forgot password', () => {
  it('asks for an email first if the field is empty', async () => {
    const user = userEvent.setup()
    renderSignIn()
    await user.click(screen.getByRole('button', { name: /forgot password/i }))

    expect(await screen.findByText(/enter your email above first/i)).toBeInTheDocument()
    expect(sendPasswordReset).not.toHaveBeenCalled()
  })

  it('sends a reset link once an email is entered', async () => {
    sendPasswordReset.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderSignIn()
    await user.type(screen.getByLabelText(/email/i), 'maya@studies.edu')
    await user.click(screen.getByRole('button', { name: /forgot password/i }))

    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledWith('maya@studies.edu'))
  })
})

describe('Google sign-in', () => {
  it('starts the OAuth redirect on click', async () => {
    signInWithGoogle.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderSignIn()
    await user.click(screen.getByRole('button', { name: /continue with google/i }))

    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalled())
  })
})
