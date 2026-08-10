/**
 * Which `/` commands are offered, and when.
 *
 * The rule this enforces: a command that cannot do anything must not be
 * offered. "Summarise" on a blank note used to sit there fully enabled and
 * return an apology from the model — an offer the product could not keep.
 */

import { describe, expect, it } from 'vitest'
import { availableCommands, SLASH_COMMANDS, type SlashContext } from './slashMenu'

const EMPTY: SlashContext = { hasText: false, hasSelection: false, hasHeadings: false }
const WRITTEN: SlashContext = { hasText: true, hasSelection: false, hasHeadings: false }
const STRUCTURED: SlashContext = { hasText: true, hasSelection: false, hasHeadings: true }
const SELECTED: SlashContext = { hasText: false, hasSelection: true, hasHeadings: false }

const ids = (ctx: SlashContext) => availableCommands('', ctx).map((c) => c.id)

describe('availableCommands — availability follows the document', () => {
  it('offers writing and insert commands on a blank note', () => {
    const got = ids(EMPTY)
    expect(got).toContain('ai')
    expect(got).toContain('h1')
  })

  it('hides every command that needs text when there is none', () => {
    const got = ids(EMPTY)
    for (const id of ['summarise', 'explain', 'expand', 'keypoints', 'questions']) {
      expect(got).not.toContain(id)
    }
  })

  it('offers them once something is written', () => {
    const got = ids(WRITTEN)
    for (const id of ['summarise', 'explain', 'expand', 'keypoints', 'questions']) {
      expect(got).toContain(id)
    }
  })

  it('treats a selection as text to act on, even in an empty note', () => {
    expect(ids(SELECTED)).toContain('summarise')
  })

  it('withholds the table of contents until there are headings', () => {
    expect(ids(WRITTEN)).not.toContain('toc')
    expect(ids(STRUCTURED)).toContain('toc')
  })
})

describe('availableCommands — ordering and search', () => {
  it('puts AI commands before insert commands', () => {
    const groups = availableCommands('', STRUCTURED).map((c) => c.group)
    expect(groups.indexOf('insert')).toBeGreaterThan(-1)
    // No 'ai' may appear after the first 'insert'.
    expect(groups.slice(groups.indexOf('insert'))).not.toContain('ai')
  })

  it('matches on keywords, not just labels', () => {
    // Someone wanting a checklist types "todo", which is not in the label.
    expect(availableCommands('todo', EMPTY).map((c) => c.id)).toContain('todo')
  })

  it('still respects availability when searching', () => {
    expect(availableCommands('summar', EMPTY)).toHaveLength(0)
    expect(availableCommands('summar', WRITTEN).map((c) => c.id)).toContain('summarise')
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(availableCommands('zzzzz', STRUCTURED)).toHaveLength(0)
  })
})

describe('the command table itself stays well-formed', () => {
  it('has no duplicate ids', () => {
    const seen = SLASH_COMMANDS.map((c) => c.id)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('gives every command exactly one behaviour', () => {
    // An entry with neither is a dead menu row; with both, it is ambiguous.
    for (const c of SLASH_COMMANDS) {
      expect(Boolean(c.ai) !== Boolean(c.run), `${c.id} must have ai xor run`).toBe(true)
    }
  })

  it('does not offer an image command — paste and drag already do that', () => {
    expect(SLASH_COMMANDS.map((c) => c.id)).not.toContain('image')
  })
})
