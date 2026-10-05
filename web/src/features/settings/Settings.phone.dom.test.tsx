// @vitest-environment jsdom

/**
 * Settings on a phone: a grouped list of sections, each opening as its own
 * screen with one back button; Account holds Sign out and, apart from it,
 * Delete account behind a confirm sheet; skills are named as desktop-only.
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { MOBILE_QUERY } from '../../lib/useIsMobile'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'student@example.com', user_metadata: { display_name: 'Sam' } },
    signOut: vi.fn(),
    setDisplayName: vi.fn(),
  }),
}))
vi.mock('../../api/me', () => ({
  getSettings: vi.fn().mockResolvedValue({
    daily_goal: 20,
    streak_freeze_enabled: true,
    answer_only_from_docs: true,
    always_show_citations: true,
  }),
  getStudentModel: vi.fn().mockResolvedValue({
    learning_style: null,
    session_length_minutes: 15,
    exam_context: null,
    teaching_preference: null,
    weak_areas: [],
    strong_areas: [],
    streak_days: 0,
    falling_areas: [],
    cold_areas: [],
    observed_habits: [],
    intake_skipped_style: true,
  }),
  updateSettings: vi.fn(),
  updateStudentModel: vi.fn(),
  deleteAccount: vi.fn(),
}))
vi.mock('../../api/feedback', () => ({
  listPreferences: vi.fn().mockResolvedValue([]),
  resetFeedback: vi.fn(),
}))
vi.mock('../../api/auth', () => ({ signOutLocally: vi.fn() }))
vi.mock('../../api/supabase', () => ({ getSupabase: vi.fn() }))

import { Settings } from './Settings'

beforeEach(() => {
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
})
afterEach(cleanup)

function renderSettings(entry = '/settings') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Settings />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('Settings on a phone', () => {
  it('is a grouped list, not the tab strip', async () => {
    renderSettings()
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    for (const name of ['Learning', 'Study', 'Feedback', 'About & legal']) {
      expect(within(nav).getByRole('button', { name: new RegExp(name) })).toBeInTheDocument()
    }
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(await screen.findByText('20 cards a day')).toBeInTheDocument()
  })

  it('opens a section as its own screen and comes back to the list', async () => {
    renderSettings()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Study/ }))
    expect(await screen.findByRole('region', { name: 'Study' })).toBeInTheDocument()
    expect(await screen.findByText('Daily goal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument()
  })

  it('keeps Sign out and Delete account in Account, delete behind a confirm sheet (an old Privacy link still lands)', async () => {
    renderSettings('/settings?section=privacy')
    const user = userEvent.setup()
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete account' }))

    const sheet = await screen.findByRole('dialog', { name: 'Delete account?' })
    const confirm = within(sheet).getByRole('button', { name: 'Delete my account' })
    expect(confirm).toBeDisabled()
    await user.type(within(sheet).getByLabelText('Type delete to confirm'), 'delete')
    expect(confirm).toBeEnabled()
  })

  it('says skills are managed on desktop', async () => {
    renderSettings('/settings?section=study')
    expect(await screen.findByText('Skills shape the chat tutor and are managed on desktop.')).toBeInTheDocument()
  })

  it('never offers the skipped style questions on the phone itself', async () => {
    renderSettings('/settings?section=how-you-learn')
    expect(await screen.findByText('When something is new to you, what helps it click?')).toBeInTheDocument()
    expect(screen.queryByText('Tell me how you like to learn')).not.toBeInTheDocument()
  })
})
