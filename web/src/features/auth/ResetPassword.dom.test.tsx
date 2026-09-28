// @vitest-environment jsdom
/**
 * The password-reset landing screen — see SignIn.dom.test.tsx for why this
 * directory has tests at all. Covers the two things worth getting wrong:
 * validation blocking a mismatched/too-short password, and a successful
 * update landing on /home.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { ResetPassword } from './ResetPassword'

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

const updateUser = vi.fn()
vi.mock('../../api/supabase', () => ({
  getSupabase: () => ({ auth: { updateUser: (...args: unknown[]) => updateUser(...args) } }),
}))

let mockAuth: { loading: boolean; session: unknown }
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => mockAuth,
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('../transitions/Handoff', () => ({
  useHandoff: () => ({ play: async (_variant: string, work: () => void) => work() }),
}))

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/auth/reset-password']}>
      <ToastProvider>
        <ResetPassword />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  updateUser.mockReset()
  navigate.mockReset()
  mockAuth = { loading: false, session: { user: { id: 'u1' } } }
})

afterEach(() => {
  cleanup()
})

it('bounces to /signin when there is no recovery session', async () => {
  mockAuth = { loading: false, session: null }
  renderScreen()

  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/signin', { replace: true }))
  expect(updateUser).not.toHaveBeenCalled()
})

describe('validation', () => {
  it('blocks submission on a too-short password', async () => {
    const user = userEvent.setup()
    renderScreen()
    await user.type(screen.getByLabelText(/new password/i), 'short')
    await user.type(screen.getByLabelText(/confirm password/i), 'short')
    await user.click(screen.getByRole('button', { name: /update password/i }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('blocks submission when the two passwords do not match', async () => {
    const user = userEvent.setup()
    renderScreen()
    await user.type(screen.getByLabelText(/new password/i), 'longenough1')
    await user.type(screen.getByLabelText(/confirm password/i), 'longenough2')
    await user.click(screen.getByRole('button', { name: /update password/i }))

    expect(await screen.findByText(/don't match/i)).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
  })
})

it('updates the password and lands on /home', async () => {
  updateUser.mockResolvedValue({ error: null })
  const user = userEvent.setup()
  renderScreen()
  await user.type(screen.getByLabelText(/new password/i), 'correcthorse')
  await user.type(screen.getByLabelText(/confirm password/i), 'correcthorse')
  await user.click(screen.getByRole('button', { name: /update password/i }))

  await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'correcthorse' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home', { replace: true }))
})
