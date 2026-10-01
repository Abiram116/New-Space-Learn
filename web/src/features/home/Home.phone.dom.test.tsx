// @vitest-environment jsdom

/**
 * Home by device: Today on a phone (one primary action, a welcome-back chunk
 * instead of a backlog, honest desktop copy with "Send myself the link", an
 * inline first subject), and on desktop the first-run checklist plus the
 * offer of the questions a phone intake skipped.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Space, Stats } from '../../api/types'
import { ToastProvider } from '../../components/ui/Toast'
import { clearCache, writeCache } from '../../lib/asyncCache'
import { MOBILE_QUERY } from '../../lib/useIsMobile'

const refreshSpaces = vi.fn()
const createSpace = vi.fn()
const addSubspace = vi.fn()
let spacesState: { spaces: Space[]; loading: boolean; error: string | null }

vi.mock('../spaces/SpacesProvider', () => ({
  useSpaces: () => ({ ...spacesState, refresh: refreshSpaces, createSpace, addSubspace }),
}))

const getCachedBrief = vi.fn()
const getCachedStats = vi.fn()
vi.mock('../../lib/briefCache', () => ({
  getCachedBrief: (...a: unknown[]) => getCachedBrief(...a),
  getCachedStats: (...a: unknown[]) => getCachedStats(...a),
}))
vi.mock('../spaces/NewSpaceModal', () => ({ NewSpaceModal: () => null }))
vi.mock('../../auth/AuthProvider', () => {
  const auth = { user: { id: 'u1', email: 'asha@example.com', user_metadata: { display_name: 'Asha Rao' } } }
  return { useAuth: () => auth, useOptionalAuth: () => auth }
})
vi.mock('../../api/quizzes', () => ({ listAllQuizzes: vi.fn().mockResolvedValue([]) }))
vi.mock('../../api/notes', () => ({ listAllNotes: vi.fn().mockResolvedValue([]) }))
const updateStudentModel = vi.fn()
vi.mock('../../api/me', () => ({ updateStudentModel: (...a: unknown[]) => updateStudentModel(...a) }))

import { Home } from './Home'

function setDevice(phone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q === MOBILE_QUERY ? phone : q.includes('reduce'),
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function isoDaysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function stats(over: Partial<Stats> = {}): Stats {
  return {
    streak_days: 3,
    max_streak: 5,
    study_minutes_this_week: 40,
    cards_due: 0,
    quiz_average: null,
    docs_indexed: 1,
    spaces_count: 1,
    heatmap: [{ day: isoDaysAgo(0), minutes: 10, intensity: 2 }],
    badges: [],
    cards_reviewed_today: 8,
    daily_goal: 20,
    composition: { chat_messages: 0, cards_reviewed: 8, quizzes_taken: 0 },
    due_forecast: [],
    ...over,
  }
}

function space(counts: Space['subspaces'][number]['counts'] = { docs: 1, cards: 20 }): Space {
  return {
    id: 'sp-1',
    name: 'Biology',
    tone: 'brand',
    pinned: false,
    subspaces: [
      { id: 'sub-1', subject_id: 'sp-1', name: 'Cell respiration', last_activity_at: new Date().toISOString(), counts },
    ],
  }
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <ToastProvider>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/:a/:b/docs" element={<p>Docs screen</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  clearCache()
  localStorage.clear()
  getCachedBrief.mockResolvedValue({ headline: 'Cells are coming along', body: 'Keep the cards moving.', generated: false, suggestion: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Today, on a phone', () => {
  beforeEach(() => setDevice(true))

  it('greets by first name and leads with one review action, timed', async () => {
    spacesState = { spaces: [space()], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats({ cards_due: 12 }))
    renderHome()

    // Nova carries the greeting now — in its own words, but always by name.
    expect(await screen.findByText(/Asha/, { selector: '.nova-hello .bot-bubble' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'Cells are coming along' })).toBeInTheDocument()
    const action = await screen.findByRole('link', { name: /Review 12 cards/ })
    expect(action).toHaveTextContent('~4 min')
    expect(action).toHaveAttribute('href', '/sp-1/sub-1/flashcards?review=due')
    // Not the desktop dashboard.
    expect(screen.queryByText('Current streak')).not.toBeInTheDocument()
    expect(screen.queryByText('Coming due')).not.toBeInTheDocument()
    // Streak, goal ring and week, lightly.
    expect(screen.getByText('8/20')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Last seven days' }).children).toHaveLength(7)
  })

  it('welcomes someone back after weeks away with a small first chunk, and the rest one tap away', async () => {
    spacesState = { spaces: [space()], loading: false, error: null }
    getCachedStats.mockResolvedValue(
      stats({ cards_due: 46, cards_reviewed_today: 0, heatmap: [{ day: isoDaysAgo(23), minutes: 20, intensity: 2 }] }),
    )
    renderHome()

    const start = await screen.findByRole('link', { name: /Start with 10 of your 46 cards/ })
    expect(start.getAttribute('href')).toContain('limit=10')
    expect(screen.getByText(/Welcome back/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Review all 46 instead/ })).toHaveAttribute(
      'href',
      '/sp-1/sub-1/flashcards?review=due',
    )
  })

  it('with nothing added yet, leads with Add material and is honest about desktop', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    spacesState = { spaces: [space({})], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats({ docs_indexed: 0, cards_due: 0 }))
    renderHome()

    const add = await screen.findByRole('link', { name: /Add material/ })
    expect(add).toHaveAttribute('href', '/sp-1/sub-1/docs?add=1')
    expect(screen.getByText(/chat tutor and deep note-writing are on a computer/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Send myself the link/ }))
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: 'Space Learn', url: `${window.location.origin}/` }))
    Reflect.deleteProperty(navigator, 'share')
  })

  it('falls back to the clipboard where there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    spacesState = { spaces: [space({})], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats({ docs_indexed: 0 }))
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: /Send myself the link/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(await screen.findByText(/Link copied/)).toBeInTheDocument()
  })

  it('creates the first subject inline, then goes to add material', async () => {
    spacesState = { spaces: [], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats({ docs_indexed: 0, spaces_count: 0 }))
    createSpace.mockResolvedValue({ id: 'new-sp', name: 'Chemistry', tone: 'brand', pinned: false, subspaces: [] })
    addSubspace.mockResolvedValue({ id: 'new-t', subject_id: 'new-sp', name: 'Chemistry', last_activity_at: null, counts: {} })
    renderHome()

    const user = userEvent.setup()
    await user.type(await screen.findByPlaceholderText('e.g. Biology'), 'Chemistry')
    await user.click(screen.getByRole('button', { name: /Next: add material/ }))

    await waitFor(() => expect(createSpace).toHaveBeenCalledWith({ name: 'Chemistry', tone: 'brand' }))
    expect(addSubspace).toHaveBeenCalledWith('new-sp', 'Chemistry')
    expect(await screen.findByText('Docs screen')).toBeInTheDocument()
  })

  it('does not say hello twice when the brief already greets', async () => {
    spacesState = { spaces: [space()], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats({ cards_due: 3 }))
    getCachedBrief.mockResolvedValue({ headline: 'Good evening, Asha', body: 'Three cards due.', generated: true, suggestion: null })
    renderHome()
    expect(await screen.findByRole('heading', { level: 1, name: 'Good evening, Asha' })).toBeInTheDocument()
    expect(screen.queryByText(/, Asha\.$/)).not.toBeInTheDocument()
  })

  it('never offers a chat destination from the decision engine', async () => {
    spacesState = { spaces: [space({ docs: 1, quizzes: 1 })], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats({ cards_due: 0 }))
    getCachedBrief.mockResolvedValue({
      headline: 'Osmosis is shaky',
      body: 'Test it.',
      generated: false,
      suggestion: { label: 'Firm up osmosis', route: '/s/sp-1/sub-1', action: 'weak_topic', reason: 'Two low scores.' },
    })
    renderHome()

    const link = await screen.findByRole('link', { name: /Firm up osmosis/ })
    expect(link).toHaveAttribute('href', '/s/sp-1/sub-1/quizzes')
  })
})

describe('Home on desktop', () => {
  beforeEach(() => setDevice(false))

  it('walks a new account through three steps, with the next one as the button', async () => {
    spacesState = { spaces: [space({ docs: 1 })], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats({ docs_indexed: 1, composition: { chat_messages: 0, cards_reviewed: 0, quizzes_taken: 0 } }))
    renderHome()

    const band = await screen.findByRole('region', { name: 'Get set up' })
    expect(within(band).getByText('1 of 3 done')).toBeInTheDocument()
    const steps = within(band).getAllByRole('listitem')
    expect(steps[1]).toHaveAttribute('aria-current', 'step')
    expect(within(steps[1]).getByRole('link', { name: /Make cards/ })).toHaveAttribute('href', '/sp-1/sub-1/flashcards')
    // The dashboard is still there underneath.
    expect(screen.getByText('Current streak')).toBeInTheDocument()
  })

  it('drops the checklist once all three are done', async () => {
    spacesState = { spaces: [space({ docs: 1, cards: 3 })], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats({ docs_indexed: 1, composition: { chat_messages: 4, cards_reviewed: 0, quizzes_taken: 0 } }))
    renderHome()

    await screen.findByText('Current streak')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Get set up' })).not.toBeInTheDocument())
  })

  it('offers the questions a phone sign-up skipped, and answering clears the offer', async () => {
    writeCache('student-model', {
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
    })
    updateStudentModel.mockImplementation(async (patch: Record<string, unknown>) => ({
      learning_style: patch.learning_style ?? null,
      teaching_preference: patch.teaching_preference ?? null,
      session_length_minutes: 15,
      exam_context: null,
      weak_areas: [],
      strong_areas: [],
      streak_days: 0,
      falling_areas: [],
      cold_areas: [],
      observed_habits: [],
      intake_skipped_style: false,
    }))
    spacesState = { spaces: [space({ docs: 1, cards: 3 })], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats())
    renderHome()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Answer them' }))
    await user.click(screen.getByRole('checkbox', { name: /A concrete example/ }))
    await user.click(screen.getByRole('radio', { name: /Keep it short/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateStudentModel).toHaveBeenCalledWith({
        learning_style: 'examples first, then the general rule',
        teaching_preference: 'Keep explanations short and direct.',
        intake_skipped_style: false,
      }),
    )
    await waitFor(() => expect(screen.queryByText('Tell me how you like to learn')).not.toBeInTheDocument())
  })

  it('does not offer them to someone who answered the full intake', async () => {
    writeCache('student-model', {
      learning_style: 'x',
      teaching_preference: 'y',
      session_length_minutes: 30,
      exam_context: null,
      weak_areas: [],
      strong_areas: [],
      streak_days: 0,
      falling_areas: [],
      cold_areas: [],
      observed_habits: [],
      intake_skipped_style: true,
    })
    spacesState = { spaces: [space({ docs: 1, cards: 3 })], loading: false, error: null }
    getCachedStats.mockResolvedValue(stats())
    renderHome()
    await screen.findByText('Current streak')
    expect(screen.queryByText('Tell me how you like to learn')).not.toBeInTheDocument()
  })
})
