// @vitest-environment jsdom

/** Profile as the phone's "You" tab: figures as stacked cards, Settings as a full-width row. */

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
    // The reference is hidden in the squeezed desktop row below `sm`; the
    // stacked card always says it.
    expect(await screen.findByText('best 10')).toBeVisible()
    expect(screen.getByText('goal 140')).toBeInTheDocument()
    const settings = screen.getByRole('button', { name: 'Settings' })
    expect(settings.className).toContain('w-full')
  })

  it('keeps the small Settings chip on desktop', async () => {
    setDevice(false)
    renderProfile()
    await screen.findByText('best 10')
    expect(screen.getByRole('button', { name: 'Settings' }).className).not.toContain('w-full')
  })
})
