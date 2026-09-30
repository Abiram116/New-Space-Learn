// @vitest-environment jsdom
/**
 * The backstop inside ChatView itself: even if something mounts chat on a
 * phone, the student sees ChatOnDesktop — no composer, no messages request.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '../../api/types'
import { ToastProvider } from '../../components/ui/Toast'

const SPACES: Space[] = [
  {
    id: 'sp',
    name: 'RL',
    tone: 'sky',
    pinned: false,
    subspaces: [{ id: 'sub', subject_id: 'sp', name: 'MDPs', last_activity_at: null, counts: {} }],
  },
]

vi.mock('../spaces/SpacesProvider', () => ({
  useSpaces: () => ({ spaces: SPACES, loading: false, error: null, refresh: async () => {} }),
}))

const listMessages = vi.fn(async () => [])
vi.mock('../../api/chat', () => ({ listMessages: () => listMessages(), streamChat: vi.fn() }))

import { ChatView } from '../chat/ChatView'

afterEach(() => {
  cleanup()
  // @ts-expect-error — restore jsdom's default (no matchMedia).
  delete window.matchMedia
})

describe('ChatView on a phone', () => {
  it('renders ChatOnDesktop instead of chat', () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia

    render(
      <MemoryRouter initialEntries={['/s/sp/sub']}>
        <ToastProvider>
          <Routes>
            <Route path="/s/:spaceId/:subspaceId" element={<ChatView />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Chat is on the big screen' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(listMessages).not.toHaveBeenCalled()
  })
})
