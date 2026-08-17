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
import { labelFor, notePreview, originLabel, provenanceLabel, relativeTime, sourceLine } from './format'
import type { Note } from '../../api/types'

const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'T',
  body_md: '',
  origin: 'user',
  source_ids: null,
  updated_at: new Date().toISOString(),
  touched_by_user: (over.origin ?? 'user') === 'user',
  touched_by_agent: over.origin === 'agent',
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

  it('counts a note both AI and Mine once the other party has touched it — AI/Mine are not exclusive', () => {
    // Regression: counts used to come from `origin` alone, which only ever
    // says who created a note — an AI-created note a student then edited
    // still counted only under AI, never under Mine.
    const notes = [note({ id: 'n1', origin: 'agent', touched_by_agent: true, touched_by_user: true })]
    expect(labelFor('ai', notes)).toContain('1')
    expect(labelFor('mine', notes)).toContain('1')
  })
})

describe('originLabel', () => {
  it('distinguishes who wrote the note', () => {
    expect(originLabel('user')).not.toBe(originLabel('agent'))
  })
})

describe('provenanceLabel', () => {
  it('reads "Created by AI" for an untouched AI note', () => {
    expect(provenanceLabel(note({ origin: 'agent', touched_by_agent: true, touched_by_user: false })))
      .toBe('Created by AI')
  })

  it('reads "Created by you" for an untouched user note', () => {
    expect(provenanceLabel(note({ origin: 'user', touched_by_user: true, touched_by_agent: false })))
      .toBe('Created by you')
  })

  it('reads "Created by AI · Edited by you" once a user has edited an AI note', () => {
    expect(provenanceLabel(note({ origin: 'agent', touched_by_agent: true, touched_by_user: true })))
      .toBe('Created by AI · Edited by you')
  })

  it('reads "Created by you · Edited by AI" once AI has touched a user note', () => {
    expect(provenanceLabel(note({ origin: 'user', touched_by_user: true, touched_by_agent: true })))
      .toBe('Created by you · Edited by AI')
  })

  it('reads "From a document" for a doc-origin note regardless of touched flags', () => {
    expect(provenanceLabel(note({ origin: 'doc', touched_by_user: true, touched_by_agent: true })))
      .toBe('From a document')
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

describe('sourceLine', () => {
  const base = '/s/space-1/topic-1'
  const src = (over: Partial<Parameters<typeof sourceLine>[0][number]> = {}) => ({
    document_id: 'doc-1',
    document_name: 'RL Lecture.pdf',
    locator: 'p. 43',
    ...over,
  })

  it('renders nothing when the answer had no sources', () => {
    // "Source:" with nothing after it states the opposite of the truth.
    expect(sourceLine([], base)).toBe('')
  })

  it('links the document at its locator', () => {
    const out = sourceLine([src()], base)
    expect(out).toContain('RL Lecture.pdf · p. 43')
    expect(out).toContain(`${base}/docs?d=doc-1`)
  })

  it('collapses repeated chunks from one document', () => {
    // Six chunks from one PDF is one source to a reader.
    const out = sourceLine([src(), src(), src()], base)
    expect(out.match(/RL Lecture\.pdf/g)).toHaveLength(1)
  })

  it('keeps genuinely different documents', () => {
    const out = sourceLine([src(), src({ document_id: 'doc-2', document_name: 'Notes.pdf' })], base)
    expect(out).toContain('RL Lecture.pdf')
    expect(out).toContain('Notes.pdf')
  })

  it('omits the separator when a source has no locator', () => {
    expect(sourceLine([src({ locator: '' })], base)).toContain('[RL Lecture.pdf]')
  })

  it('escapes a bracket in a filename so the link cannot break', () => {
    const out = sourceLine([src({ document_name: 'Week [3].pdf' })], base)
    expect(out).toContain('Week [3\\].pdf')
  })

  it('is valid markdown that survives the note round-trip', () => {
    // Plain italic text plus links — no custom node, nothing to serialise.
    const out = sourceLine([src()], base)
    expect(out.trim().startsWith('*Source:')).toBe(true)
    expect(out.trim().endsWith('*')).toBe(true)
  })
})
