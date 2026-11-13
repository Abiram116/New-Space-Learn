import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchHit } from '../../api/search'
import type { Space } from '../../api/types'
import { clearRecent, highlight, hrefFor, placeLine, readRecent, rememberSearch, RECENT_MAX } from './model'

const SPACES: Space[] = [
  {
    id: 'sp1',
    name: 'Operating Systems',
    slug: 'operating-systems',
    tone: 'sky',
    pinned: false,
    subspaces: [{ id: 't1', subject_id: 'sp1', name: 'Deadlock', slug: 'deadlock', last_activity_at: null, counts: {} }],
  },
  { id: 'sp2', name: 'Empty', slug: 'empty', tone: 'sky', pinned: false, subspaces: [] },
]

function hit(over: Partial<SearchHit>): SearchHit {
  return {
    kind: 'note',
    id: 'x',
    title: 'T',
    snippet: null,
    subject_id: 'sp1',
    subject_name: 'Operating Systems',
    subspace_id: 't1',
    subspace_name: 'Deadlock',
    deck_id: null,
    deck_name: null,
    document_id: null,
    locator: null,
    status: null,
    ...over,
  }
}

describe('hrefFor', () => {
  it('opens each kind at the exact thing', () => {
    expect(hrefFor(hit({ kind: 'topic', id: 't1' }), SPACES)).toBe('/operating-systems/deadlock')
    expect(hrefFor(hit({ kind: 'note', id: 'n1' }), SPACES)).toBe('/operating-systems/deadlock/notes?n=n1')
    expect(hrefFor(hit({ kind: 'card', id: 'c1', deck_id: 'd1' }), SPACES)).toBe(
      '/operating-systems/deadlock/flashcards?deck=d1',
    )
    expect(hrefFor(hit({ kind: 'quiz', id: 'q1' }), SPACES)).toBe('/operating-systems/deadlock/quizzes?q=q1')
    expect(hrefFor(hit({ kind: 'file', id: 'f1', document_id: 'f1' }), SPACES)).toBe(
      '/operating-systems/deadlock/docs?d=f1',
    )
    expect(hrefFor(hit({ kind: 'passage', id: 'ch', document_id: 'f1' }), SPACES)).toBe(
      '/operating-systems/deadlock/docs?d=f1',
    )
  })

  it('a subject opens its first topic, or nothing when it has none', () => {
    expect(hrefFor(hit({ kind: 'subject', id: 'sp1', subspace_id: null }), SPACES)).toBe('/operating-systems/deadlock')
    expect(hrefFor(hit({ kind: 'subject', id: 'sp2', subspace_id: null }), SPACES)).toBeNull()
  })

  it('falls back to the id address for a topic the list does not know yet', () => {
    expect(hrefFor(hit({ kind: 'note', id: 'n', subject_id: 's9', subspace_id: 't9' }), SPACES)).toBe(
      '/s/s9/t9/notes?n=n',
    )
  })
})

describe('placeLine', () => {
  it('names the subject, topic and deck', () => {
    expect(placeLine(hit({ kind: 'card', deck_name: 'Basics' }))).toBe('Operating Systems › Deadlock · Basics')
    expect(placeLine(hit({ kind: 'passage', locator: 'p. 4' }))).toBe('Operating Systems › Deadlock · p. 4')
  })
})

describe('highlight', () => {
  it('marks every case-insensitive match', () => {
    expect(highlight('Mutual mutual MUTUAL', 'mutual').filter((p) => p.match).map((p) => p.text)).toEqual([
      'Mutual',
      'mutual',
      'MUTUAL',
    ])
  })

  it('treats regex characters and unicode literally', () => {
    expect(highlight('cost (50%)?', '(50%)').map((p) => p.match)).toEqual([false, true, false])
    expect(highlight('Crème brûlée', 'BRÛ').find((p) => p.match)?.text).toBe('brû')
    expect(highlight('🙂 emoji 🙂', '🙂').filter((p) => p.match)).toHaveLength(2)
  })

  it('returns the text whole when there is nothing to mark', () => {
    expect(highlight('plain', '')).toEqual([{ text: 'plain', match: false }])
    expect(highlight('plain', 'zz')).toEqual([{ text: 'plain', match: false }])
  })
})

describe('recent searches', () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  afterEach(() => store.clear())

  it('keeps the newest first, without duplicates, capped', () => {
    for (let i = 0; i < 10; i++) rememberSearch(`q${i}`)
    rememberSearch('Q9')
    const list = readRecent()
    expect(list[0]).toBe('Q9')
    expect(list).toHaveLength(RECENT_MAX)
    expect(list.filter((s) => s.toLowerCase() === 'q9')).toHaveLength(1)
    clearRecent()
    expect(readRecent()).toEqual([])
  })

  it('survives garbage and storage that throws', () => {
    store.set('sl:recent-searches', '{not json')
    expect(readRecent()).toEqual([])
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readRecent()).toEqual([])
    // Remembered for this session only; nothing throws.
    expect(rememberSearch('x')).toEqual(['x'])
    expect(() => clearRecent()).not.toThrow()
  })
})
