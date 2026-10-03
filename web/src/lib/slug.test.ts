import { describe, expect, it } from 'vitest'
import type { Space, Subspace } from '../api/types'
import { resolveTopicSegments, subspacePath } from './nav'
import { RESERVED_ROOTS, slugify, withSlugs } from './slug'

const sub = (id: string, name: string, subject_id = 'sp1'): Subspace => ({
  id,
  subject_id,
  name,
  last_activity_at: null,
  counts: {},
})
const space = (id: string, name: string, subspaces: Subspace[] = []): Space => ({
  id,
  name,
  tone: 'brand',
  pinned: false,
  subspaces,
})

describe('slugify', () => {
  it('lowercases, drops punctuation and joins words with hyphens', () => {
    expect(slugify('Markov Decision Processes!')).toBe('markov-decision-processes')
  })

  it('strips accents rather than dropping the letter', () => {
    expect(slugify('Café Économie')).toBe('cafe-economie')
  })

  it('spells out an ampersand so "A & B" does not collapse to "a-b"', () => {
    expect(slugify('Pros & Cons')).toBe('pros-and-cons')
  })

  it('caps the length without leaving a trailing hyphen', () => {
    const out = slugify('word '.repeat(40))
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.endsWith('-')).toBe(false)
  })

  it('gives the same answer the second time (it is remembered)', () => {
    expect(slugify('Café Économie')).toBe('cafe-economie')
    expect(slugify('Café Économie')).toBe('cafe-economie')
  })

  it('returns empty when nothing usable is left, so callers can fall back', () => {
    expect(slugify('తెలుగు')).toBe('')
    expect(slugify('   ')).toBe('')
  })
})

describe('withSlugs', () => {
  it('gives every subject and topic a readable slug', () => {
    const [rl] = withSlugs([space('s1', 'Reinforcement Learning', [sub('t1', 'Markov Decision Processes')])])
    expect(rl.slug).toBe('reinforcement-learning')
    expect(rl.subspaces[0].slug).toBe('markov-decision-processes')
  })

  it('falls back to an id-based slug for a name with no Latin characters', () => {
    const [s] = withSlugs([space('a1b2c3d4-0000-0000-0000-000000000000', 'తెలుగు')])
    expect(s.slug).toBe('subject-a1b2c3')
  })

  it('gives same-named topics in one subject an id tail each, not just the later one', () => {
    const [s] = withSlugs([
      space('s1', 'Bio', [sub('aaaa1111', 'Notes'), sub('bbbb2222', 'Notes'), sub('cccc3333', 'Cells')]),
    ])
    const slugs = s.subspaces.map((t) => t.slug)
    expect(slugs).toEqual(['notes-aaaa', 'notes-bbbb', 'cells'])
  })

  it('does not change a slug when the same-named items are reordered', () => {
    const a = sub('aaaa1111', 'Notes')
    const b = sub('bbbb2222', 'Notes')
    const one = withSlugs([space('s1', 'Bio', [a, b])])[0].subspaces
    const two = withSlugs([space('s1', 'Bio', [b, a])])[0].subspaces
    const bySlug = (list: Subspace[]) => Object.fromEntries(list.map((t) => [t.id, t.slug]))
    expect(bySlug(one)).toEqual(bySlug(two))
  })

  it('lets two subjects reuse a topic name, since topic slugs are scoped to their subject', () => {
    const out = withSlugs([
      space('s1', 'Math', [sub('t1', 'Intro')]),
      space('s2', 'Physics', [sub('t2', 'Intro', 's2')]),
    ])
    expect(out[0].subspaces[0].slug).toBe('intro')
    expect(out[1].subspaces[0].slug).toBe('intro')
  })

  it('keeps a subject off the names of pages, which share its first URL segment', () => {
    const out = withSlugs([
      space('aaaa1111-0000-0000-0000-000000000000', 'Notes'),
      space('bbbb2222-0000-0000-0000-000000000000', 'Home'),
      space('cccc3333-0000-0000-0000-000000000000', 'Biology'),
    ])
    expect(out.map((s) => s.slug)).toEqual(['notes-aaaa', 'home-bbbb', 'biology'])
    for (const s of out) expect(RESERVED_ROOTS.has(s.slug!)).toBe(false)
  })

  it('does not reserve topic names, which are never a first segment', () => {
    const [s] = withSlugs([space('s1', 'Bio', [sub('t1', 'Notes')])])
    expect(s.subspaces[0].slug).toBe('notes')
  })

  it('does not mutate its input', () => {
    const input = [space('s1', 'Math', [sub('t1', 'Intro')])]
    withSlugs(input)
    expect(input[0].slug).toBeUndefined()
  })
})

describe('subspacePath', () => {
  it('uses slugs once they exist and ids before that', () => {
    const [s] = withSlugs([space('s1', 'Math', [sub('t1', 'Intro')])])
    expect(subspacePath(s, s.subspaces[0])).toBe('/math/intro')
    const bare = space('s1', 'Math', [sub('t1', 'Intro')])
    expect(subspacePath(bare, bare.subspaces[0])).toBe('/s1/t1')
  })
})

describe('resolveTopicSegments', () => {
  const spaces = withSlugs([
    space('s1', 'Math', [sub('t1', 'Intro')]),
    space('s2', 'Physics', [sub('t2', 'Intro', 's2'), sub('t3', 'Waves', 's2')]),
  ])

  it('resolves slugs', () => {
    const r = resolveTopicSegments(spaces, 'physics', 'waves')
    expect(r.space?.id).toBe('s2')
    expect(r.subspace?.id).toBe('t3')
  })

  it('resolves ids, so old links and server-built routes still land', () => {
    const r = resolveTopicSegments(spaces, 's2', 't3')
    expect(r.subspace?.id).toBe('t3')
  })

  it('looks for the topic only inside the subject it was written under', () => {
    expect(resolveTopicSegments(spaces, 'math', 'waves').subspace).toBeNull()
    expect(resolveTopicSegments(spaces, 'physics', 'intro').subspace?.id).toBe('t2')
  })

  it('returns nulls for names that do not exist', () => {
    expect(resolveTopicSegments(spaces, 'nope', 'intro')).toEqual({ space: null, subspace: null })
    expect(resolveTopicSegments(spaces, undefined, undefined)).toEqual({ space: null, subspace: null })
  })
})
