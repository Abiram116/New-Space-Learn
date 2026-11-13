// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prefetchMessages = vi.fn()
const listDocuments = vi.fn(async () => [])
vi.mock('../api/chat', () => ({ prefetchMessages: (...a: unknown[]) => prefetchMessages(...a) }))
vi.mock('../api/documents', () => ({ listDocuments: (...a: unknown[]) => listDocuments(...(a as [])) }))
vi.mock('../api/client', () => ({ hasAuthToken: () => true }))
vi.mock('../api/flashcards', () => ({ listAllDecks: vi.fn(async () => []) }))
vi.mock('../api/me', () => ({ getStudentModel: vi.fn(async () => ({})) }))
vi.mock('../api/notes', () => ({ listAllNotes: vi.fn(async () => []) }))
vi.mock('../api/quizzes', () => ({ listAllQuizzes: vi.fn(async () => []) }))
vi.mock('../features/chat/ChatView', () => ({}))
vi.mock('../features/mobile/TopicHub', () => ({}))
vi.mock('../features/docs/DocsView', () => ({}))
vi.mock('../features/flashcards/FlashcardsView', () => ({}))
vi.mock('../features/quizzes/QuizzesView', () => ({}))
vi.mock('../features/notes/NotesView', () => ({}))
vi.mock('../features/profile/Profile', () => ({}))
vi.mock('../features/settings/Settings', () => ({}))
vi.mock('../features/skills/SkillsView', () => ({}))

import type { Space } from '../api/types'
import { clearCache, readCache } from './asyncCache'
import { knownSpaces, rememberSpaces } from './knownSpaces'
import { prepare } from './prefetch'

const spaces: Space[] = [
  {
    id: 's1',
    name: 'Linear Algebra',
    tone: 'brand',
    pinned: false,
    subspaces: [
      { id: 't1', subject_id: 's1', name: 'Eigenvalues', last_activity_at: null, counts: {} },
    ],
  },
]

beforeEach(() => {
  clearCache()
  prefetchMessages.mockClear()
  listDocuments.mockClear()
  rememberSpaces(spaces)
})

describe('prepare', () => {
  it('starts a topic\'s history and files from its name-based address', () => {
    prepare('/linear-algebra/eigenvalues')
    expect(prefetchMessages).toHaveBeenCalledWith('t1')
    expect(listDocuments).toHaveBeenCalledWith('t1')
  })

  it('understands the old /s/ form and an id in place of a name', () => {
    prepare('/s/s1/t1')
    expect(prefetchMessages).toHaveBeenCalledWith('t1')
  })

  it('does nothing for a topic it has never seen, or a page that is not a topic', () => {
    prepare('/linear-algebra/something-new')
    prepare('/home')
    prepare('/settings/')
    expect(prefetchMessages).not.toHaveBeenCalled()
  })

  it('does not ask again for a screen whose data is already held', async () => {
    prepare('/linear-algebra/eigenvalues/docs')
    await vi.waitFor(() => expect(readCache('docs:t1')).toBeDefined())
    listDocuments.mockClear()
    prepare('/linear-algebra/eigenvalues/docs')
    expect(listDocuments).not.toHaveBeenCalled()
  })
})

describe('what the tab remembers', () => {
  it('is gone after sign-out', () => {
    expect(knownSpaces()).toHaveLength(1)
    clearCache()
    expect(knownSpaces()).toHaveLength(0)
  })
})
