// @vitest-environment jsdom

/**
 * First run on a phone: three questions (name, session length with 15
 * pre-picked, an optional goal), no style/depth questions, no canvas — and the
 * skip is recorded so desktop can ask the two it left out.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { MOBILE_QUERY } from '../../lib/useIsMobile'

const setDisplayName = vi.fn().mockResolvedValue(undefined)
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', user_metadata: {} }, setDisplayName }),
}))
const updateStudentModel = vi.fn().mockResolvedValue({ intake_skipped_style: true })
vi.mock('../../api/me', () => ({ updateStudentModel: (...a: unknown[]) => updateStudentModel(...a) }))
vi.mock('../../lib/briefCache', () => ({
  getCachedBrief: vi.fn().mockResolvedValue(null),
  getCachedStats: vi.fn().mockResolvedValue(null),
}))
// The desktop intake must never mount on a phone — it owns the canvas.
vi.mock('./Organism', () => ({
  Organism: () => {
    throw new Error('the canvas organism rendered on a phone')
  },
}))

import { Onboarding } from './Onboarding'

function setPhone() {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q === MOBILE_QUERY || q.includes('reduce'),
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function renderIt() {
  return render(
    <MemoryRouter initialEntries={['/welcome-aboard']}>
      <ToastProvider>
        <Routes>
          <Route path="/welcome-aboard" element={<Onboarding />} />
          <Route path="/home" element={<p>Today screen</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setPhone()
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('phone onboarding', () => {
  it('asks three light questions and saves them with the skip recorded', async () => {
    renderIt()
    const user = userEvent.setup()

    expect(screen.getByRole('heading', { name: 'What should we call you?' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox'), 'Asha')
    await user.click(screen.getByRole('button', { name: /Continue/ }))

    expect(screen.getByRole('heading', { name: 'How long do you usually study in one go?' })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringContaining('15 minutes'),
      expect.stringContaining('30 minutes'),
      expect.stringContaining('An hour'),
    ])
    // 15 is the default.
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: /Continue/ }))

    expect(screen.getByRole('heading', { name: 'What are you working towards?' })).toBeInTheDocument()
    // No style or depth question anywhere in the flow.
    expect(screen.queryByText(/what makes it click/i)).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox'), 'Biology finals')
    await user.click(screen.getByRole('button', { name: /Finish/ }))

    await waitFor(() =>
      expect(updateStudentModel).toHaveBeenCalledWith({
        session_length_minutes: 15,
        exam_context: 'Biology finals',
        intake_skipped_style: true,
      }),
    )
    expect(setDisplayName).toHaveBeenCalledWith('Asha')
    expect(await screen.findByText('Today screen')).toBeInTheDocument()
    expect(localStorage.getItem('sl:onboarded:v1:u1')).toBe('1')
  })

  it('lets a different session length be picked, and the goal left blank', async () => {
    renderIt()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    await user.click(screen.getByRole('radio', { name: /30 minutes/ }))
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    await user.click(screen.getByRole('button', { name: /Finish without one/ }))

    await waitFor(() =>
      expect(updateStudentModel).toHaveBeenCalledWith({ session_length_minutes: 30, intake_skipped_style: true }),
    )
    expect(setDisplayName).not.toHaveBeenCalled()
  })

  it('can be skipped entirely, straight to Today', async () => {
    renderIt()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Skip' }))
    expect(await screen.findByText('Today screen')).toBeInTheDocument()
    expect(updateStudentModel).not.toHaveBeenCalled()
  })
})
