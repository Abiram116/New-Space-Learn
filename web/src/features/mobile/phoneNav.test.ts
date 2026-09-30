import { describe, expect, it } from 'vitest'
import type { Deck, Space } from '../../api/types'
import { reviewPlan } from './hubModel'
import {
  badgeText,
  phoneBackFor,
  phoneTabFor,
  phoneTitle,
  resolveTopic,
  showsTopicSwitcher,
  switchTarget,
  topicFromPath,
} from './phoneNav'
import { isChatRoute, phoneRoute } from './phoneRoute'
import { shareOrCopy } from './shareLink'

describe('phoneRoute — nothing on a phone links to chat', () => {
  it('maps the bare topic route (chat on desktop) to the topic hub', () => {
    expect(phoneRoute('/s/a/b')).toBe('/s/a/b')
    expect(phoneRoute('/s/a/b/')).toBe('/s/a/b')
  })

  it('maps the decision engine’s chat suggestions to the hub', () => {
    for (const action of ['fix_misconception', 'root_cause', 'continue', null, undefined]) {
      expect(phoneRoute('/s/a/b', action)).toBe('/s/a/b')
    }
  })

  it('sends a due-cards suggestion straight to cards, a weak/slipping one to quizzes', () => {
    expect(phoneRoute('/s/a/b', 'due_cards')).toBe('/s/a/b/flashcards')
    expect(phoneRoute('/s/a/b', 'slipping')).toBe('/s/a/b/quizzes')
    expect(phoneRoute('/s/a/b', 'weak_topic')).toBe('/s/a/b/quizzes')
  })

  it('treats the explicit chat and skills addresses as chat, dropping chat-only query', () => {
    expect(phoneRoute('/s/a/b/chat')).toBe('/s/a/b')
    expect(phoneRoute('/s/a/b/skills')).toBe('/s/a/b')
    expect(phoneRoute('/s/a/b?prefill=hi#end')).toBe('/s/a/b')
  })

  it('leaves every phone-safe route untouched, query and all', () => {
    for (const r of [
      '/s/a/b/flashcards?deck=d1',
      '/s/a/b/quizzes?q=q1',
      '/s/a/b/notes?n=n1',
      '/s/a/b/docs',
      '/home',
      '/profile',
      'https://example.com/s/a/b',
    ]) {
      expect(phoneRoute(r, 'continue')).toBe(r)
    }
  })

  it('isChatRoute recognises exactly the chat destinations', () => {
    expect(isChatRoute('/s/a/b')).toBe(true)
    expect(isChatRoute('/s/a/b/chat')).toBe(true)
    expect(isChatRoute('/s/a/b/skills')).toBe(true)
    expect(isChatRoute('/s/a/b/flashcards')).toBe(false)
    expect(isChatRoute('/home')).toBe(false)
  })
})

describe('phoneTabFor — which tab is lit', () => {
  it.each([
    ['/home', 'today'],
    ['/flashcards', 'cards'],
    ['/s/a/b/flashcards', 'cards'],
    ['/quizzes', 'quizzes'],
    ['/s/a/b/quizzes/', 'quizzes'],
    ['/s/a/b/notes', 'notes'],
    ['/profile', 'you'],
    ['/settings', 'you'],
  ])('%s → %s', (path, tab) => {
    expect(phoneTabFor(path)).toBe(tab)
  })

  it('lights nothing on topic-level pages that belong to no tab', () => {
    expect(phoneTabFor('/s/a/b')).toBeNull()
    expect(phoneTabFor('/s/a/b/docs')).toBeNull()
  })
})

describe('the top bar', () => {
  it('titles each page in the phone’s own words', () => {
    expect(phoneTitle('/home')).toBe('Today')
    expect(phoneTitle('/s/a/b')).toBe('Topic')
    expect(phoneTitle('/s/a/b/flashcards')).toBe('Cards')
    expect(phoneTitle('/s/a/b/docs')).toBe('Sources')
    expect(phoneTitle('/profile')).toBe('You')
    expect(phoneTitle('/settings')).toBe('Settings')
  })

  it('offers Back only on drill-in pages', () => {
    expect(phoneBackFor('/home')).toBeNull()
    expect(phoneBackFor('/s/a/b/flashcards')).toBeNull()
    expect(phoneBackFor('/s/a/b')).toBeNull()
    expect(phoneBackFor('/s/a/b/docs')).toBe('/s/a/b')
    expect(phoneBackFor('/settings')).toBe('/profile')
  })

  it('shows the topic switcher except on account pages', () => {
    expect(showsTopicSwitcher('/home')).toBe(true)
    expect(showsTopicSwitcher('/s/a/b/notes')).toBe(true)
    expect(showsTopicSwitcher('/profile')).toBe(false)
    expect(showsTopicSwitcher('/settings')).toBe(false)
  })

  it('switching topic keeps the section, or opens the hub from elsewhere', () => {
    expect(switchTarget('/s/a/b/flashcards', '/s/c/d')).toBe('/s/c/d/flashcards')
    expect(switchTarget('/s/a/b/docs', '/s/c/d')).toBe('/s/c/d/docs')
    expect(switchTarget('/notes', '/s/c/d')).toBe('/s/c/d/notes')
    expect(switchTarget('/home', '/s/c/d')).toBe('/s/c/d')
    expect(switchTarget('/s/a/b', '/s/c/d')).toBe('/s/c/d')
  })

  it('parses topic URLs', () => {
    expect(topicFromPath('/s/a/b')).toEqual({ spaceId: 'a', subspaceId: 'b', section: null })
    expect(topicFromPath('/s/a/b/notes')).toEqual({ spaceId: 'a', subspaceId: 'b', section: 'notes' })
    expect(topicFromPath('/home')).toBeNull()
  })
})

describe('badgeText', () => {
  it('hides zero and unknown, caps large counts', () => {
    expect(badgeText(0)).toBeNull()
    expect(badgeText(null)).toBeNull()
    expect(badgeText(7)).toBe('7')
    expect(badgeText(250)).toBe('99+')
  })
})

describe('reviewPlan — what the hub offers to review', () => {
  const deck = (id: string, sub: string, due: number): Deck => ({
    id,
    name: id,
    total: 10,
    due,
    known_pct: 0,
    subspace_id: sub,
  })

  it('sums due cards in this topic only, and opens the deck when only one has any', () => {
    const plan = reviewPlan([deck('d1', 'b', 4), deck('d2', 'b', 0), deck('d3', 'other', 9)], 'b')
    expect(plan).toEqual({ due: 4, decksDue: 1, deckId: 'd1' })
  })

  it('leaves the deck open when several have cards due', () => {
    const plan = reviewPlan([deck('d1', 'b', 4), deck('d2', 'b', 2)], 'b')
    expect(plan).toEqual({ due: 6, decksDue: 2, deckId: null })
  })

  it('is zero before the decks load', () => {
    expect(reviewPlan(null, 'b')).toEqual({ due: 0, decksDue: 0, deckId: null })
  })
})

describe('resolveTopic — the phone’s current topic', () => {
  const sub = (id: string, at: string | null) => ({ id, subject_id: 's', name: id, last_activity_at: at, counts: {} })
  const spaces: Space[] = [
    { id: 's1', name: 'One', tone: 'brand', pinned: false, subspaces: [sub('old', '2026-01-01T00:00:00Z')] },
    { id: 's2', name: 'Two', tone: 'sky', pinned: false, subspaces: [sub('new', '2026-09-01T00:00:00Z'), sub('never', null)] },
  ]

  it('prefers the URL, then the remembered topic, then the most recently active', () => {
    expect(resolveTopic(spaces, 'old', 'never')?.subspace.id).toBe('old')
    expect(resolveTopic(spaces, null, 'never')?.subspace.id).toBe('never')
    expect(resolveTopic(spaces, null, 'deleted')?.subspace.id).toBe('new')
    expect(resolveTopic([], null, null)).toBeNull()
  })
})

describe('shareOrCopy — “Send myself the link”', () => {
  const data = { title: 'Space Learn', url: 'https://x.test/s/a/b' }

  it('uses the native share sheet when there is one', async () => {
    const share = async () => {}
    expect(await shareOrCopy(data, { share })).toBe('shared')
  })

  it('says nothing when the student closes the share sheet', async () => {
    const share = async () => {
      throw Object.assign(new Error('closed'), { name: 'AbortError' })
    }
    const writes: string[] = []
    expect(await shareOrCopy(data, { share, clipboard: { writeText: async (t) => void writes.push(t) } })).toBe('cancelled')
    expect(writes).toEqual([])
  })

  it('falls back to copying the link', async () => {
    const writes: string[] = []
    expect(await shareOrCopy(data, { clipboard: { writeText: async (t) => void writes.push(t) } })).toBe('copied')
    expect(writes).toEqual([data.url])
  })

  it('reports failure when neither works', async () => {
    const clipboard = {
      writeText: async () => {
        throw new Error('denied')
      },
    }
    expect(await shareOrCopy(data, { clipboard })).toBe('failed')
    expect(await shareOrCopy(data, {})).toBe('failed')
  })
})
