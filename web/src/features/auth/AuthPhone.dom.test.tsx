// @vitest-environment jsdom

/**
 * Sign-in and sign-up on a phone: Google first (one tap, no typing), every
 * input at 16px so iOS doesn't zoom on focus, and no artifact panel.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { MOBILE_QUERY } from '../../lib/useIsMobile'

vi.mock('../../api/auth', () => ({
  signInWithPassword: vi.fn(),
  signInWithGoogle: vi.fn(),
  sendPasswordReset: vi.fn(),
  resendConfirmation: vi.fn(),
  signUpWithPassword: vi.fn(),
}))
vi.mock('../transitions/Handoff', () => ({
  useHandoff: () => ({ play: async (_v: string, work: () => void) => work() }),
}))

import { SignIn } from './SignIn'
import { SignUp } from './SignUp'

function setDevice(phone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q === MOBILE_QUERY ? phone : false,
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function renderIn(el: React.ReactNode) {
  return render(
    <MemoryRouter>
      <ToastProvider>{el}</ToastProvider>
    </MemoryRouter>,
  )
}

/** True when `a` comes before `b` in document order. */
function before(a: Element, b: Element) {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

afterEach(cleanup)

describe('auth on a phone', () => {
  beforeEach(() => setDevice(true))

  it('puts Google first on sign-in, and sizes inputs for a thumb', () => {
    renderIn(<SignIn />)
    const google = screen.getByRole('button', { name: /Continue with Google/ })
    const email = screen.getByLabelText('Email')
    expect(before(google, email)).toBe(true)
    expect(email.closest('[class*="text-[16px]"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Sign in' }).className).toContain('w-full')
    expect(screen.queryByText('Keep the page.')).not.toBeInTheDocument()
  })

  it('puts Google first on sign-up too', () => {
    renderIn(<SignUp />)
    expect(before(screen.getByRole('button', { name: /Continue with Google/ }), screen.getByLabelText('Name'))).toBe(true)
  })
})

describe('auth on desktop is unchanged', () => {
  beforeEach(() => setDevice(false))

  it('keeps email first and Google after it', () => {
    renderIn(<SignIn />)
    expect(before(screen.getByLabelText('Email'), screen.getByRole('button', { name: /Continue with Google/ }))).toBe(true)
  })
})
