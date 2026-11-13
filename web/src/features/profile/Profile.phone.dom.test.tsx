// @vitest-environment jsdom

/** Profile as the phone's "You" tab: three compact figures, Settings as a full-width row. */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { clearCache } from '../../lib/asyncCache'
import { MOBILE_QUERY } from '../../lib/useIsMobile'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'student@example.com', created_at: new Date().toISOString(), user_metadata: {} },
    setDisplayName: vi.fn(),
  }),
}))
vi.mock('../../lib/briefCache', () => ({
  getCachedStats: vi.fn().mockResolvedValue({
    streak_days: 3,
    max_streak: 10,
    study_minutes_this_week: 42,
    cards_due: 0,
    quiz_average: 80,
    docs_indexed: 2,
    spaces_count: 1,
    heatmap: [],
    badges: [],
    daily_goal: 20,
    composition: { chat_messages: 0, cards_reviewed: 0, quizzes_taken: 0 },
    due_forecast: [],
  }),
}))
vi.mock('../../api/me', () => ({ getStudentModel: vi.fn().mockResolvedValue(null) }))
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: [] }) }))

import { Profile } from './Profile'

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

function renderProfile() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Profile />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => clearCache())
afterEach(cleanup)

describe('Profile on a phone', () => {
  it('shows each figure with its reference in words, and Settings as a row', async () => {
    setDevice(true)
    renderProfile()
    // Each tile prints its reference twice — beside the number on a wide tile,
    // under the rail on a narrow one — and CSS shows whichever fits.
    expect((await screen.findAllByText(/best 10/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/goal 140/).length).toBeGreaterThan(0)
    // The short label for a tile a third of a phone wide.
    expect(screen.getByText('Streak')).toBeInTheDocument()
    const settings = screen.getByRole('button', { name: 'Settings' })
    expect(settings.className).toContain('w-full')
  })

  it('keeps the small Settings chip on desktop', async () => {
    setDevice(false)
    renderProfile()
    await screen.findAllByText(/best 10/)
    expect(screen.getByRole('button', { name: 'Settings' }).className).not.toContain('w-full')
  })
})
