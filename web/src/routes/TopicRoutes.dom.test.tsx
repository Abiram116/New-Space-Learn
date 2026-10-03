// @vitest-environment jsdom
/**
 * Chat never renders on a phone: the topic root becomes the hub, explicit
 * chat/skills addresses explain themselves, and the backstop inside ChatView
 * catches anything that mounts it anyway. Desktop keeps chat at the same URLs.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Deck, Space } from '../api/types'
import { ToastProvider } from '../components/ui/Toast'

const SPACES: Space[] = [
  {
    id: 'sp',
    name: 'Reinforcement Learning',
    tone: 'sky',
    pinned: false,
    subspaces: [
      {
        id: 'sub',
        subject_id: 'sp',
        name: 'Markov decision processes',
        last_activity_at: null,
        counts: { cards: 12, quizzes: 2, notes: 5, docs: 3 },
      },
    ],
  },
]

const DECKS: Deck[] = [
  { id: 'd1', name: 'Bellman', total: 12, due: 3, known_pct: 40, subspace_id: 'sub' },
  { id: 'd2', name: 'Other topic', total: 8, due: 6, known_pct: 10, subspace_id: 'elsewhere' },
]

vi.mock('../features/spaces/SpacesProvider', () => ({
  SpacesProvider: ({ children }: { children: React.ReactNode }) => children,
  useSpaces: () => ({ spaces: SPACES, loading: false, error: null, refresh: async () => {} }),
}))

vi.mock('../api/flashcards', () => ({ listAllDecks: vi.fn(async () => DECKS) }))
vi.mock('../features/chat/ChatView', () => ({ ChatView: () => <div>desktop chat</div> }))
vi.mock('../features/skills/SkillsView', () => ({ SkillsView: () => <div>desktop skills</div> }))

import { useTopicScope } from '../lib/useTopicScope'
import { ChatAliasRoute, SkillsRoute, TopicIndexRoute, TopicSkillsRedirect } from './TopicRoutes'

/** Stands in for Notes / Cards / Quizzes: shows which topic the screen would work in. */
function ScopeProbe() {
  const { subspace, base, isGlobal } = useTopicScope()
  return (
    <div>
      {isGlobal ? 'global' : 'in-topic'} · {subspace?.name ?? 'no topic'} · {base}
    </div>
  )
}

function setViewport(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/flashcards" element={<ScopeProbe />} />
          <Route path="/:spaceId/:subspaceId">
            <Route index element={<TopicIndexRoute />} />
            <Route path="chat" element={<ChatAliasRoute />} />
            <Route path="skills" element={<SkillsRoute />} />
            <Route path="flashcards" element={<ScopeProbe />} />
          </Route>
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  // @ts-expect-error — restore jsdom's default (no matchMedia).
  delete window.matchMedia
  localStorage.clear()
})

describe('on a phone', () => {
  it('opens the topic hub, not chat, at the topic root', async () => {
    setViewport(true)
    renderAt('/sp/sub')
    expect(await screen.findByRole('heading', { name: 'Markov decision processes' })).toBeInTheDocument()
    expect(screen.queryByText('desktop chat')).toBeNull()

    // Due cards come from this topic's decks only, and open the one deck with any.
    const review = await screen.findByTestId('review-due')
    expect(review).toHaveTextContent('Review 3 due cards')
    expect(review).toHaveAttribute('href', '/sp/sub/flashcards?deck=d1')

    for (const [label, href, count] of [
      ['Cards', '/sp/sub/flashcards', '12'],
      ['Quizzes', '/sp/sub/quizzes', '2'],
      ['Notes', '/sp/sub/notes', '5'],
      ['Sources', '/sp/sub/docs', '3'],
    ]) {
      const row = screen.getByRole('link', { name: new RegExp(`^${label}`) })
      expect(row).toHaveAttribute('href', href)
      expect(row).toHaveTextContent(count)
    }
    expect(screen.getByRole('link', { name: /Add material/ })).toHaveAttribute('href', '/sp/sub/docs')
  })

  it('explains that chat is on desktop at a chat address, with ways to revise instead', async () => {
    setViewport(true)
    renderAt('/sp/sub/chat')
    expect(await screen.findByRole('heading', { name: 'Chat is on the big screen' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cards' })).toHaveAttribute('href', '/sp/sub/flashcards')
    expect(screen.getByRole('link', { name: 'Quizzes' })).toHaveAttribute('href', '/sp/sub/quizzes')
    expect(screen.getByRole('link', { name: 'Notes' })).toHaveAttribute('href', '/sp/sub/notes')
    expect(screen.queryByText('desktop chat')).toBeNull()
  })

  it('"Send myself the link" copies the desktop chat URL when there is no share sheet', async () => {
    setViewport(true)
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderAt('/sp/sub/chat')
    fireEvent.click(await screen.findByRole('button', { name: /Send myself the link/ }))
    expect(await screen.findByText(/Link copied/)).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/sp/sub`)
  })

  it('treats Skills as part of chat', async () => {
    setViewport(true)
    renderAt('/sp/sub/skills')
    expect(await screen.findByRole('heading', { name: 'Skills live with chat' })).toBeInTheDocument()
    expect(screen.queryByText('desktop skills')).toBeNull()
  })
})

describe('on desktop (unchanged)', () => {
  it('keeps chat at the topic root', async () => {
    setViewport(false)
    renderAt('/sp/sub')
    expect(await screen.findByText('desktop chat')).toBeInTheDocument()
  })

  it('forwards the explicit chat address to it', async () => {
    setViewport(false)
    renderAt('/sp/sub/chat')
    expect(await screen.findByText('desktop chat')).toBeInTheDocument()
  })

  it('keeps Skills', async () => {
    setViewport(false)
    renderAt('/sp/sub/skills')
    expect(await screen.findByText('desktop skills')).toBeInTheDocument()
  })
})

describe('account-wide list URLs', () => {
  it('stay where they are and borrow the current topic for new items', async () => {
    setViewport(true)
    renderAt('/flashcards')
    expect(
      await screen.findByText('global · Markov decision processes · /sp/sub'),
    ).toBeInTheDocument()
  })

  it('use the topic in the address when there is one', async () => {
    setViewport(false)
    renderAt('/sp/sub/flashcards')
    expect(
      await screen.findByText('in-topic · Markov decision processes · /sp/sub'),
    ).toBeInTheDocument()
  })
})

/** The App's real wiring for skills: a topic's `…/skills` forwards to the
 *  account-wide `/skills`, which is chat furniture on a phone. */
function renderSkillsAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/skills" element={<SkillsRoute />} />
          <Route path="/:spaceId/:subspaceId/skills" element={<TopicSkillsRedirect />} />
          <Route path="/s/:spaceId/:subspaceId/skills" element={<TopicSkillsRedirect />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('skills addresses as the app wires them', () => {
  for (const path of ['/skills', '/sp/sub/skills', '/s/sp/sub/skills']) {
    it(`${path} never shows the skills screen on a phone`, async () => {
      setViewport(true)
      renderSkillsAt(path)
      expect(await screen.findByRole('heading', { name: 'Skills live with chat' })).toBeInTheDocument()
      expect(screen.queryByText('desktop skills')).toBeNull()
    })

    it(`${path} shows Skills on desktop`, async () => {
      setViewport(false)
      renderSkillsAt(path)
      expect(await screen.findByText('desktop skills')).toBeInTheDocument()
    })
  }
})
