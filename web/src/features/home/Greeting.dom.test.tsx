// @vitest-environment jsdom

/**
 * Nova's hello on desktop Home: one line above the brief, waving on arrival —
 * or, when the brief's headline already greets, a wave beside it and no
 * second hello. The brief itself is never repeated, and with the bots off the
 * greeting is plain text in the same place.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '../../api/types'
import { setBotsEnabled } from '../../lib/botPreference'

let spacesState: { spaces: Space[]; loading: boolean; error: string | null }
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ ...spacesState, refresh: vi.fn() }) }))
const getCachedBrief = vi.fn()
const getCachedStats = vi.fn()
vi.mock('../../lib/briefCache', () => ({
  getCachedBrief: (...a: unknown[]) => getCachedBrief(...a),
  getCachedStats: (...a: unknown[]) => getCachedStats(...a),
}))
vi.mock('../spaces/NewSpaceModal', () => ({ NewSpaceModal: () => null }))

import { Home } from './Home'

const STATS = {
  streak_days: 1, cards_due: 0, quiz_average: null, study_minutes_this_week: 0,
  due_forecast: [], composition: { chat_messages: 1, cards_reviewed: 0, quizzes_taken: 0 },
  daily_goal: 10, badges: [], heatmap: [], docs_indexed: 1, spaces_count: 1, max_streak: 1,
}
const space = { id: 'sp-1', name: 'ML', tone: 'brand', pinned: false, subspaces: [
  { id: 'sub-1', name: 'RL', last_activity_at: new Date().toISOString(), counts: { docs: 1, cards: 5, notes: 0, quizzes: 1 } },
] } as unknown as Space

const renderHome = () => render(<MemoryRouter><Home /></MemoryRouter>)
const nova = () => document.querySelector<SVGSVGElement>('svg.bot[data-agent="tutor"]')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  act(() => setBotsEnabled(true))
})

describe('Nova on desktop Home', () => {
  it('waves and says hello above a brief that does not greet, without repeating it', async () => {
    spacesState = { spaces: [space], loading: false, error: null }
    getCachedStats.mockResolvedValue(STATS)
    getCachedBrief.mockResolvedValue({ headline: 'RL is slipping', body: 'Go back over it.', generated: false, suggestion: null })
    renderHome()
    expect(await screen.findByRole('heading', { level: 1, name: 'RL is slipping' })).toBeInTheDocument()
    expect(nova()?.dataset.mood).toBe('wave')
    const hello = document.querySelector('.nova-hello .bot-bubble')!.textContent ?? ''
    expect(hello).not.toBe('')
    expect(hello).not.toContain('RL is slipping')
    expect(hello).not.toMatch(/this topic/i)
  })

  it('only waves beside a headline that already greets', async () => {
    spacesState = { spaces: [space], loading: false, error: null }
    getCachedStats.mockResolvedValue(STATS)
    getCachedBrief.mockResolvedValue({ headline: 'Good evening', body: 'Three due.', generated: true, suggestion: null })
    renderHome()
    expect(await screen.findByRole('heading', { level: 1, name: 'Good evening' })).toBeInTheDocument()
    expect(document.querySelector('.nova-hello')).toBeNull()
    expect(nova()).not.toBeNull()
  })

  it('keeps the greeting as text, and the heading and CTA, with the bots off', async () => {
    act(() => setBotsEnabled(false))
    spacesState = { spaces: [space], loading: false, error: null }
    getCachedStats.mockResolvedValue(STATS)
    getCachedBrief.mockResolvedValue({ headline: 'RL is slipping', body: 'Go back over it.', generated: false, suggestion: null })
    renderHome()
    expect(await screen.findByRole('heading', { level: 1, name: 'RL is slipping' })).toBeInTheDocument()
    expect(document.querySelector('svg.bot')).toBeNull()
    expect(document.querySelector('.nova-hello .bot-bubble')?.textContent).not.toBe('')
    expect(screen.getByRole('button', { name: /pick up where you left off/i })).toBeInTheDocument()
  })

  it('introduces itself once on a brand-new account', async () => {
    spacesState = { spaces: [], loading: false, error: null }
    getCachedStats.mockResolvedValue(STATS)
    getCachedBrief.mockResolvedValue({ headline: 'x', body: 'y', generated: false, suggestion: null })
    renderHome()
    expect(await screen.findByText(/bring what you're studying/i)).toBeInTheDocument()
    expect(document.querySelectorAll('svg.bot[data-agent="tutor"]')).toHaveLength(1)
  })
})
