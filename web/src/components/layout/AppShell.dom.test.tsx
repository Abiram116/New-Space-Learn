// @vitest-environment jsdom
/**
 * The shell picks its structure from `useIsMobile` — and only from it.
 *
 * Desktop/tablet must stay exactly the rail-and-main layout it always was
 * (no tab bar, no phone top bar). Phones get the revision shell: a five-tab
 * bar with the right tab lit, a due badge from the stats Home already
 * cached, no chat anywhere, and bars that step aside for immersive screens.
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '../../api/types'
import { writeCache } from '../../lib/asyncCache'
import { HOME_STATS_KEY } from '../../lib/homeKeys'
import { ToastProvider } from '../ui/Toast'
import { resetImmersiveForTests, useImmersive } from './immersive'

const SPACES: Space[] = [
  {
    id: 'sp',
    name: 'Reinforcement Learning',
    tone: 'sky',
    pinned: false,
    subspaces: [
      { id: 'sub', subject_id: 'sp', name: 'Markov decision processes', last_activity_at: null, counts: { cards: 12 } },
    ],
  },
]

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'ada@example.test', user_metadata: {} }, session: { user: { id: 'u' } }, loading: false }),
}))

vi.mock('../../features/spaces/SpacesProvider', () => ({
  SpacesProvider: ({ children }: { children: React.ReactNode }) => children,
  useSpaces: () => ({
    spaces: SPACES,
    loading: false,
    error: null,
    refresh: async () => {},
    createSpace: vi.fn(),
    renameSpace: vi.fn(),
    setPinned: vi.fn(),
    deleteSpace: vi.fn(),
    addSubspace: vi.fn(),
    renameSubspace: vi.fn(),
    deleteSubspace: vi.fn(),
  }),
}))

vi.mock('./OfflineBanner', () => ({ OfflineBanner: () => null }))

vi.mock('../../routes/lazyRoutes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../routes/lazyRoutes')>()),
  prefetchRouteChunks: () => {},
}))

import { AppShell } from './AppShell'

function setViewport(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function ImmersivePage() {
  useImmersive(true)
  return <div>reviewing</div>
}

function renderAt(path: string, page = <div>page body</div>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={page} />
          </Route>
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  resetImmersiveForTests()
  // @ts-expect-error — restore jsdom's default (no matchMedia).
  delete window.matchMedia
})

describe('AppShell on desktop and tablet (unchanged)', () => {
  it('renders the rail and the page, and none of the phone shell', () => {
    setViewport(false)
    renderAt('/home')
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getByText('page body')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(document.querySelector('[data-phone-shell]')).toBeNull()
  })

  it('behaves the same with no matchMedia at all (tests, old browsers)', () => {
    // @ts-expect-error — simulate an environment without matchMedia.
    delete window.matchMedia
    renderAt('/home')
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })
})

describe('AppShell on a phone', () => {
  beforeEach(() => setViewport(true))

  it('swaps the rail for the five revision tabs — and no chat', () => {
    renderAt('/home')
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
    const tabs = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link')
    expect(tabs.map((t) => t.textContent)).toEqual(['Today', 'Cards', 'Quizzes', 'Notes', 'ADYou'])
    expect(screen.queryByRole('link', { name: /chat/i })).toBeNull()
    expect(screen.queryByText(/^chat$/i)).toBeNull()
  })

  it('lights the tab for the current page, including inside a topic', () => {
    renderAt('/s/sp/sub/flashcards')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const current = within(nav).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAttribute('data-tab', 'cards')
    expect(screen.getByRole('heading', { level: 1, name: 'Cards' })).toBeInTheDocument()
  })

  it('points the section tabs at the current topic', () => {
    renderAt('/home')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Quizzes' })).toHaveAttribute('href', '/s/sp/sub/quizzes')
    expect(within(nav).getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/home')
    expect(within(nav).getByRole('link', { name: 'You' })).toHaveAttribute('href', '/profile')
  })

  it('shows the topic switcher in the top bar', () => {
    renderAt('/home')
    expect(screen.getByRole('button', { name: /Topic: Markov decision processes/ })).toBeInTheDocument()
  })

  it('badges Cards with the due count Home already cached', () => {
    writeCache(HOME_STATS_KEY, { cards_due: 12 })
    renderAt('/home')
    expect(screen.getByRole('link', { name: 'Cards, 12 due' })).toBeInTheDocument()
  })

  it('steps both bars aside for an immersive screen', () => {
    renderAt('/s/sp/sub/flashcards', <ImmersivePage />)
    expect(screen.getByText('reviewing')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 1, name: 'Cards' })).toBeNull()
  })
})
