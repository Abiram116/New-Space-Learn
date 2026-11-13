// @vitest-environment jsdom
/**
 * The 404 offers a way back that works for whoever is looking at it: a
 * signed-out visitor used to get "Go home" and "Your profile", and both only
 * led to the sign-in page.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { NotFound } from './NotFound'

let session: unknown = null
vi.mock('../auth/AuthProvider', () => ({
  useOptionalAuth: () => ({ session }),
}))

afterEach(cleanup)

function renderPage() {
  return render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  )
}

it('sends a signed-out visitor to the landing page or sign-in', () => {
  session = null
  renderPage()
  expect(screen.getByRole('link', { name: 'Back to Space Learn' })).toHaveAttribute('href', '/welcome')
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin')
  expect(screen.queryByRole('link', { name: 'Your profile' })).toBeNull()
})

it('sends a signed-in student home or to their profile', () => {
  session = { user: { id: 'u1' } }
  renderPage()
  expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/home')
  expect(screen.getByRole('link', { name: 'Your profile' })).toHaveAttribute('href', '/profile')
})
