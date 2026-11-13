// @vitest-environment jsdom
/**
 * Below `lg` the desktop rail is hidden, and for a while that meant a phone had
 * no way to reach anything after the first section — including Sign out and
 * Delete account. The section switcher is the only navigation there,
 * so these pin that it exists, that it is a proper tablist, and that choosing
 * a section actually changes what is on screen.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'

const setDisplayName = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'student@example.com', user_metadata: { display_name: 'Sam' } },
    signOut: vi.fn(),
    setDisplayName,
  }),
}))

const updateStudentModel = vi.hoisted(() => vi.fn())
vi.mock('../../api/me', () => ({
  getLimits: vi.fn().mockResolvedValue({
    answers: { per_day: 30, left_today: 24, burst: 6, per_minute: 4, quiz_costs: 2 },
    files: { max_mb: 20, max_passages: 1200, passage_chars: 900, scan_pages: 12 },
    messages: { max_chars: 4000, images_per_message: 3 },
    models: { chat: 'openai/gpt-oss-120b', fast: 'openai/gpt-oss-20b' },
  }),
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
  updateStudentModel,
  deleteAccount: vi.fn(),
}))
vi.mock('../../api/feedback', () => ({
  listPreferences: vi.fn().mockResolvedValue([]),
  resetFeedback: vi.fn(),
}))
vi.mock('../../api/auth', () => ({ signOutLocally: vi.fn() }))
vi.mock('../../api/supabase', () => ({ getSupabase: vi.fn() }))

import { Settings } from './Settings'
import { getSettings, getStudentModel, updateSettings } from '../../api/me'

/** Shows where the router is, and whether it got there by push or replace. */
function Where() {
  const { search } = useLocation()
  return <output data-testid="where">{`${useNavigationType()} ${search}`}</output>
}

function renderSettings(entry = '/settings') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Settings />
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

const STUDENT = {
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
}

describe('Settings section switcher (phones and tablets)', () => {
  it('exposes every section as a tab, with Learning selected first', async () => {
    renderSettings()
    const tablist = screen.getByRole('tablist', { name: 'Settings sections' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Learning', 'Study', 'Account', 'Feedback', 'About & legal'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    // Only the selected tab is in the tab order (roving tabindex).
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1)
    await screen.findByText('When something is new to you, what helps it click?')
  })

  it('reaches Account — Sign out and, last, Delete account — by tapping its tab', async () => {
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Account' }))

    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Change password')).toBeInTheDocument()
    const buttons = within(screen.getByRole('tabpanel')).getAllByRole('button')
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    // The one thing that cannot be undone is the last thing on the page.
    expect(buttons[buttons.length - 1]).toBe(screen.getByRole('button', { name: 'Delete account' }))
    expect(buttons.indexOf(signOut)).toBeLessThan(buttons.length - 1)
  })

  it('moves between tabs with the arrow keys', async () => {
    renderSettings()
    const first = screen.getByRole('tab', { name: 'Learning' })
    first.focus()

    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Study' })).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Study' }))

    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Learning' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(document.activeElement as Element, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'About & legal' })).toHaveAttribute('aria-selected', 'true')
  })

  it('asks for confirmation before deleting the account', async () => {
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Account' }))
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

describe('Settings chrome', () => {
  it('slides the nav indicator to the active tab and keeps tab/tabpanel roles', async () => {
    const user = userEvent.setup()
    renderSettings()
    const indicator = screen.getByTestId('nav-indicator')
    expect(indicator).toHaveAttribute('data-index', '0')
    await user.click(screen.getByRole('tab', { name: 'Account' }))
    expect(indicator).toHaveAttribute('data-index', '2')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-label', 'Account')
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
  })

  it('previews the student’s own session length', async () => {
    renderSettings()
    const box = await screen.findByRole('spinbutton', { name: 'Session length in minutes' })
    expect(box).toHaveValue('20')
    expect(screen.getByRole('radio', { name: '30 minutes' })).toHaveAttribute('aria-checked', 'false')
  })
})

describe('Settings › Learning', () => {
  it('shows the first-run choices and saves a pick as the sentence the AI reads', async () => {
    updateStudentModel.mockImplementation(async (patch: object) => ({ ...STUDENT, ...patch }))
    const user = userEvent.setup()
    renderSettings()

    await user.click(await screen.findByRole('checkbox', { name: /A concrete example/ }))
    expect(updateStudentModel).toHaveBeenLastCalledWith({ learning_style: 'examples first, then the general rule' })
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /A concrete example/ })).toHaveAttribute('aria-checked', 'true'))
    expect(await screen.findByText('saved')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Go deep/ }))
    expect(updateStudentModel).toHaveBeenLastCalledWith({
      teaching_preference: 'Go into real depth; I would rather have too much than too little.',
    })
    await user.click(screen.getByRole('radio', { name: '30 minutes' }))
    expect(updateStudentModel).toHaveBeenLastCalledWith({ session_length_minutes: 30 })
  })
})

describe('Settings › Account', () => {
  it('saves a new name only once it differs', async () => {
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Account' }))
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.clear(screen.getByLabelText('Your name'))
    await user.type(screen.getByLabelText('Your name'), 'Samira')
    await user.click(save)
    expect(setDisplayName).toHaveBeenCalledWith('Samira')
  })
})

describe('when the preferences fail to load', () => {
  it('offers a retry that brings the section back, rather than a dead red line', async () => {
    vi.mocked(getStudentModel).mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    renderSettings()

    const alert = await screen.findByRole('alert')
    expect(screen.queryByText('When something is new to you, what helps it click?')).not.toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('When something is new to you, what helps it click?')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the loading spinner', () => {
  it('waits on what the open section shows — not on Account, which needs neither list', async () => {
    let finish: (v: unknown) => void = () => {}
    vi.mocked(getSettings).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)) as never)
    const user = userEvent.setup()
    renderSettings()

    // Learning has its own data, so it shows without the preferences.
    await screen.findByText('When something is new to you, what helps it click?')
    expect(screen.queryByText('Loading your settings…')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Account' }))
    expect(screen.queryByText('Loading your settings…')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Study' }))
    expect(screen.getByText('Loading your settings…')).toBeInTheDocument()

    finish({ daily_goal: 20, streak_freeze_enabled: true, answer_only_from_docs: false, always_show_citations: true })
    expect(await screen.findByText('Daily goal')).toBeInTheDocument()
  })
})

describe('the open tab and the URL', () => {
  it('opens the tab the link names, and replaces the URL when another is chosen', async () => {
    const user = userEvent.setup()
    renderSettings('/settings?section=study')
    expect(screen.getByRole('tab', { name: 'Study' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: 'About & legal' }))
    expect(screen.getByRole('tab', { name: 'About & legal' })).toHaveAttribute('aria-selected', 'true')
    // Replaced, so Back leaves Settings rather than walking back through tabs.
    expect(screen.getByTestId('where')).toHaveTextContent('REPLACE ?section=about-legal')
  })

  it('does not claim the name and password save by themselves', () => {
    renderSettings()
    expect(screen.queryByText(/Everything here saves/)).not.toBeInTheDocument()
    expect(screen.getByText(/except your name and password/)).toBeInTheDocument()
  })
})

describe('two switches changed quickly', () => {
  it('puts back only the one whose save failed', async () => {
    let failFirst: (e: Error) => void = () => {}
    vi.mocked(updateSettings)
      .mockReturnValueOnce(new Promise((_, reject) => (failFirst = reject)) as never)
      .mockResolvedValueOnce({
        daily_goal: 20,
        streak_freeze_enabled: false,
        answer_only_from_docs: true,
        always_show_citations: true,
      } as never)
    const user = userEvent.setup()
    renderSettings('/settings?section=study')

    const freeze = await screen.findByRole('switch', { name: 'Streak freeze' })
    const docsOnly = screen.getByRole('switch', { name: 'Answer only from my docs' })
    await user.click(freeze)
    await user.click(docsOnly)
    await waitFor(() => expect(docsOnly).toBeChecked())
    expect(freeze).not.toBeChecked()

    failFirst(new Error('offline'))

    await waitFor(() => expect(freeze).toBeChecked())
    expect(docsOnly).toBeChecked()
  })
})

describe('the free-tier limits', () => {
  it('shows the real numbers and what is left of today, on the Study tab', async () => {
    renderSettings()
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Study' }))
    expect(await screen.findByText('Free-tier limits')).toBeInTheDocument()
    expect(await screen.findByText(/of 30 left/)).toBeInTheDocument()
    expect(screen.getByText(/Up to 20 MB each/)).toBeInTheDocument()
    expect(screen.getByText(/gpt-oss-120b writes answers/)).toBeInTheDocument()
  })
})
