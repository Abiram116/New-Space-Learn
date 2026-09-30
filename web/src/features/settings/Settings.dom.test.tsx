// @vitest-environment jsdom
/**
 * Below `lg` the desktop rail is hidden, and for a while that meant a phone had
 * no way to reach anything after Account — including Privacy, where Sign out
 * and Delete account live. The section switcher is the only navigation there,
 * so these pin that it exists, that it is a proper tablist, and that choosing
 * a section actually changes what is on screen.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'student@example.com', user_metadata: { display_name: 'Sam' } },
    signOut: vi.fn(),
  }),
}))

vi.mock('../../api/me', () => ({
  getSettings: vi.fn().mockResolvedValue({
    daily_goal: 20,
    streak_freeze_enabled: true,
    answer_only_from_docs: false,
    always_show_citations: true,
  }),
  getStudentModel: vi.fn().mockResolvedValue({
    learning_style: null,
    session_length_minutes: 20,
    exam_context: null,
    teaching_preference: null,
    weak_areas: [],
    strong_areas: [],
    streak_days: 0,
    falling_areas: [],
    cold_areas: [],
    observed_habits: [],
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

function renderSettings() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Settings />
      </ToastProvider>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('Settings section switcher (phones and tablets)', () => {
  it('exposes every section as a tab, with Account selected first', async () => {
    renderSettings()
    const tablist = screen.getByRole('tablist', { name: 'Settings sections' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Account',
      'Study',
      'How you learn',
      'AI & sources',
      'Privacy',
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    // Only the selected tab is in the tab order (roving tabindex).
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1)
    await screen.findByText('Change password')
  })

  it('reaches Privacy — Sign out and Delete account — by tapping its tab', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByText('Change password')

    await user.click(screen.getByRole('tab', { name: 'Privacy' }))

    expect(screen.getByRole('tab', { name: 'Privacy' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument()
    expect(screen.queryByText('Change password')).not.toBeInTheDocument()
  })

  it('moves between tabs with the arrow keys', async () => {
    renderSettings()
    await screen.findByText('Change password')
    const account = screen.getByRole('tab', { name: 'Account' })
    account.focus()

    fireEvent.keyDown(account, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Study' })).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Study' }))

    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(document.activeElement as Element, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Privacy' })).toHaveAttribute('aria-selected', 'true')
  })

  it('asks for confirmation before deleting the account', async () => {
    const user = userEvent.setup()
    renderSettings()
    await screen.findByText('Change password')
    await user.click(screen.getByRole('tab', { name: 'Privacy' }))
    await user.click(screen.getByRole('button', { name: 'Delete account' }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete your account?' })
    const confirm = within(dialog).getByRole('button', { name: 'Delete my account' })
    // Disabled until "delete" is typed, and Cancel sits before it in DOM order.
    await waitFor(() => expect(confirm).toBeDisabled())
    const buttons = within(dialog).getAllByRole('button')
    expect(buttons.indexOf(within(dialog).getByRole('button', { name: 'Cancel' }))).toBeLessThan(
      buttons.indexOf(confirm),
    )
  })
})
