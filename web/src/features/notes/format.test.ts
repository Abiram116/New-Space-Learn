/**
 * Notes-list formatting.
 *
 * `notePreview` is the interesting one. Images are stored as data URLs inside
 * the markdown, so a note that opens with a screenshot previews as several
 * thousand characters of base64 unless they are stripped first — and
 * `stripMarkdown` has no reason to know that. Splitting these helpers out of
 * `NotesView.tsx` is what made the case testable at all.
 */

import { describe, expect, it } from 'vitest'
import { labelFor, notePreview, originLabel, relativeTime } from './format'
import type { Note } from '../../api/types'

const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'T',
  body_md: '',
  origin: 'user',
  source_ids: null,
  updated_at: new Date().toISOString(),
  ...over,
})

describe('notePreview', () => {
  it('strips markdown syntax down to readable text', () => {
    expect(notePreview('# Title\n\n**bold** and *em*')).toBe('Title bold and em')
  })

  // Guards the behaviour, not the implementation: it does not matter WHERE
  // images get stripped, only that a note starting with a screenshot never
  // previews as base64. This test survives `stripMarkdown` changing hands.
  it('drops images entirely rather than previewing base64', () => {
    const huge = 'x'.repeat(5000)
    const out = notePreview(`![shot](data:image/png;base64,${huge})\n\nReal text here.`)
    expect(out).not.toContain('base64')
    expect(out).not.toContain('xxxx')
    expect(out).toContain('Real text here.')
  })

  it('collapses whitespace so a preview stays one line', () => {
    expect(notePreview('a\n\n\n   b\t\tc')).toBe('a b c')
  })

  it('truncates with an ellipsis past the limit', () => {
    const out = notePreview('word '.repeat(60), 40)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('…')).toBe(true)
  })

  it('leaves short text untouched, with no ellipsis', () => {
    expect(notePreview('Short.')).toBe('Short.')
  })

  it('returns empty string for an empty note', () => {
    expect(notePreview('')).toBe('')
  })

  it('survives a note that is nothing but an image', () => {
    expect(notePreview('![a](data:image/png;base64,AAAA)')).toBe('')
  })
})

describe('labelFor', () => {
  it('shows counts once notes have loaded', () => {
    const notes = [note(), note({ id: 'n2', origin: 'agent' })]
    expect(labelFor('all', notes)).toContain('2')
    expect(labelFor('ai', notes)).toContain('1')
    expect(labelFor('mine', notes)).toContain('1')
  })

  it('omits counts while still loading', () => {
    expect(labelFor('all', null)).toBe('All')
  })
})

describe('originLabel', () => {
  it('distinguishes who wrote the note', () => {
    expect(originLabel('user')).not.toBe(originLabel('agent'))
  })
})

describe('relativeTime', () => {
  it('reads as just now for a fresh timestamp', () => {
    expect(relativeTime(new Date().toISOString()).toLowerCase()).toContain('now')
  })

  it('does not crash on an unparseable date', () => {
    expect(() => relativeTime('not-a-date')).not.toThrow()
  })
})
