// @vitest-environment jsdom
/**
 * Renaming yourself on the profile page.
 *
 * The name field commits on blur, and a browser blurs a focused input as it is
 * removed. Escape removes the field — so Escape saved the name it was meant to
 * discard, and Enter saved it twice. As in the rail's rename test, the key and
 * that blur are dispatched in one `act()`, before React removes the input.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'

const setDisplayName = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'student@example.com', created_at: new Date().toISOString(), user_metadata: { display_name: 'Sam' } },
    setDisplayName,
  }),
}))
vi.mock('../../lib/briefCache', () => ({ getCachedStats: vi.fn().mockResolvedValue(null) }))
vi.mock('../../api/me', () => ({ getStudentModel: vi.fn().mockResolvedValue(null) }))
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: [] }) }))

import { Profile } from './Profile'

async function openNameField() {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <ToastProvider>
        <Profile />
      </ToastProvider>
    </MemoryRouter>,
  )
  await user.click(screen.getByRole('button', { name: 'Rename yourself' }))
  const input = screen.getByRole('textbox', { name: 'Your name' })
  await user.clear(input)
  await user.type(input, 'Samira')
  return input
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the name on the profile page', () => {
  it('is not saved when the edit is escaped', async () => {
    const input = await openNameField()

    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' })
      fireEvent.blur(input)
    })

    expect(setDisplayName).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sam')
  })

  it('is saved once for Enter and the blur that follows it', async () => {
    const input = await openNameField()

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.blur(input)
    })

    expect(setDisplayName).toHaveBeenCalledTimes(1)
    expect(setDisplayName).toHaveBeenCalledWith('Samira')
  })
})
