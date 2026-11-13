// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthorBadge } from './AuthorBadge'
import { noteAuthorship } from './format'

afterEach(() => cleanup())

const flags = (origin: 'user' | 'agent' | 'doc', touched_by_user: boolean, touched_by_agent: boolean) => ({
  origin,
  touched_by_user,
  touched_by_agent,
})

describe('noteAuthorship', () => {
  it('tells you, the AI, both and a document apart', () => {
    expect(noteAuthorship(flags('user', true, false))).toBe('you')
    expect(noteAuthorship(flags('agent', false, true))).toBe('ai')
    expect(noteAuthorship(flags('agent', true, true))).toBe('both')
    expect(noteAuthorship(flags('user', true, true))).toBe('both')
    expect(noteAuthorship(flags('doc', true, true))).toBe('doc')
  })
})

describe('AuthorBadge', () => {
  it('draws a distinct mark for each, named for screen readers and on hover', () => {
    const cases = [
      [flags('user', true, false), 'Created by you', ['you']],
      [flags('agent', false, true), 'Created by AI', ['ai']],
      [flags('agent', true, true), 'Created by AI · Edited by you', ['you', 'ai']],
      [flags('doc', false, false), 'From a document', ['doc']],
    ] as const
    for (const [note, label, discs] of cases) {
      render(<AuthorBadge note={note} />)
      const badge = screen.getByRole('img', { name: label })
      expect(badge).toHaveAttribute('title', label)
      expect([...badge.querySelectorAll('[data-author]')].map((d) => d.getAttribute('data-author'))).toEqual(discs)
      cleanup()
    }
  })

  it('adds the short word only when asked', () => {
    render(<AuthorBadge note={flags('agent', true, true)} showLabel />)
    expect(screen.getByRole('img')).toHaveTextContent('You + AI')
    cleanup()
    render(<AuthorBadge note={flags('agent', true, true)} />)
    expect(screen.getByRole('img').textContent).toBe('')
  })
})
