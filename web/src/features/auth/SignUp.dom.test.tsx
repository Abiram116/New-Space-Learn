// @vitest-environment jsdom
/**
 * Sign-up, mounted for real — see `SignIn.dom.test.tsx` for why this
 * directory has tests at all now.
 *
 * The one piece of real branching logic here is `requiresConfirmation`:
 * Supabase can return either an active session (skip straight to intake)
 * or none (show the "check your inbox" screen instead) for the exact same
 * form submission, and the two paths render completely different UI.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/errors'
import { ToastProvider } from '../../components/ui/Toast'
import { SignUp } from './SignUp'

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

const signUpWithPassword = vi.fn()
const signInWithGoogle = vi.fn()
const resendConfirmation = vi.fn()

vi.mock('../../api/auth', () => ({
  signUpWithPassword: (...args: unknown[]) => signUpWithPassword(...args),
  signInWithGoogle: (...args: unknown[]) => signInWithGoogle(...args),
  resendConfirmation: (...args: unknown[]) => resendConfirmation(...args),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('../transitions/Handoff', () => ({
  useHandoff: () => ({ play: async (_variant: string, work: () => void) => work() }),
}))

function renderSignUp() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <ToastProvider>
        <SignUp />
      </ToastProvider>
    </MemoryRouter>,
  )
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/name/i), 'Maya Raghavan')
  await user.type(screen.getByLabelText(/email/i), 'maya@studies.edu')
  await user.type(screen.getByLabelText(/password/i), 'longenoughpassword')
}

beforeEach(() => {
  signUpWithPassword.mockReset()
  signInWithGoogle.mockReset()
  resendConfirmation.mockReset()
  navigate.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('validation', () => {
  it('blocks submission on a one-character name without calling the API', async () => {
    const user = userEvent.setup()
    renderSignUp()
    await user.type(screen.getByLabelText(/name/i), 'M')
    await user.type(screen.getByLabelText(/email/i), 'maya@studies.edu')
    await user.type(screen.getByLabelText(/password/i), 'longenoughpassword')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/add your name/i)).toBeInTheDocument()
    expect(signUpWithPassword).not.toHaveBeenCalled()
  })

  it('blocks submission on a password under 8 characters', async () => {
    const user = userEvent.setup()
    renderSignUp()
    await user.type(screen.getByLabelText(/name/i), 'Maya Raghavan')
    await user.type(screen.getByLabelText(/email/i), 'maya@studies.edu')
    await user.type(screen.getByLabelText(/password/i), 'short1')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(signUpWithPassword).not.toHaveBeenCalled()
  })
})

describe('confirmation required', () => {
  it('shows the check-your-inbox screen instead of navigating', async () => {
    signUpWithPassword.mockResolvedValue({ session: null, requiresConfirmation: true })
    const user = userEvent.setup()
    renderSignUp()
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument()
    expect(screen.getByText(/maya@studies\.edu/)).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('resends to the pending email from that screen', async () => {
    signUpWithPassword.mockResolvedValue({ session: null, requiresConfirmation: true })
    resendConfirmation.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderSignUp()
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))
    await user.click(await screen.findByRole('button', { name: /resend/i }))

    await waitFor(() => expect(resendConfirmation).toHaveBeenCalledWith('maya@studies.edu'))
  })

  it('"Start over" returns to the form', async () => {
    signUpWithPassword.mockResolvedValue({ session: null, requiresConfirmation: true })
    const user = userEvent.setup()
    renderSignUp()
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))
    await user.click(await screen.findByRole('button', { name: /start over/i }))

    expect(await screen.findByLabelText(/name/i)).toBeInTheDocument()
  })
})

describe('immediate session', () => {
  it('skips confirmation and goes straight to the intake, not /home', async () => {
    signUpWithPassword.mockResolvedValue({ session: { user: { id: 'u1' } }, requiresConfirmation: false })
    const user = userEvent.setup()
    renderSignUp()
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/welcome-aboard', { replace: true }),
    )
  })
})

describe('failure', () => {
  it('shows a friendly error and stays on the form', async () => {
    signUpWithPassword.mockRejectedValue(
      new ApiError('validation_error', 'An account with that email already exists.'),
    )
    const user = userEvent.setup()
    renderSignUp()
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('Google sign-up', () => {
  it('starts the OAuth redirect on click', async () => {
    signInWithGoogle.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderSignUp()
    await user.click(screen.getByRole('button', { name: /continue with google/i }))

    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalled())
  })
})
