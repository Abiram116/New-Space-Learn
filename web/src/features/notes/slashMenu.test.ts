/**
 * Which `/` commands are offered, and when.
 *
 * The rule this enforces: a command that cannot do anything must not be
 * offered. "Summarise" on a blank note used to sit there fully enabled and
 * return an apology from the model — an offer the product could not keep.
 */

import { describe, expect, it } from 'vitest'
import {
  availableCommands,
  readContext,
  SLASH_COMMANDS,
  type SlashContext,
} from './slashMenu'

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

describe('the command being typed is not note content', () => {
  // Regression: on a blank note, typing `/ai` puts the literal text "/ai" in
  // the document, so `hasText` came back true and the note was never treated
  // as blank. Ask-AI then generated on an invented topic instead of asking
  // what to write.
  //
  // Exercises the real `readContext` against a stub with the surface it
  // actually touches — testing my own arithmetic inline would pass whether or
  // not the function used it.
  const fakeEditor = (text: string) =>
    ({
      state: {
        selection: { from: text.length, to: text.length },
        doc: {
          textContent: text,
          textBetween: (from: number, to: number) => text.slice(from, to),
          descendants: () => undefined,
        },
      },
    }) as unknown as Parameters<typeof readContext>[0]

  it('a blank note plus a typed command still reads as blank', () => {
    const doc = '/ai'
    expect(readContext(fakeEditor(doc), { from: 0, to: doc.length }).hasText).toBe(false)
  })

  it('a note with real content still reads as having content', () => {
    const doc = 'Some notes./ai'
    expect(readContext(fakeEditor(doc), { from: 11, to: 14 }).hasText).toBe(true)
  })

  it('without the range it regresses — which is what broke', () => {
    // Documents the failure mode: omit `typing` and a bare command counts.
    expect(readContext(fakeEditor('/ai')).hasText).toBe(true)
  })

  it('so a blank note offers Ask AI and no content-dependent command', () => {
    const doc = '/ai'
    const ctx = readContext(fakeEditor(doc), { from: 0, to: doc.length })
    const ai = availableCommands('', ctx).filter((c) => c.group === 'ai')
    expect(ai.map((c) => c.id)).toEqual(['ai'])
  })
})

describe('the questions command asks for a real heading', () => {
  // Regression: the AI wrote three numbered questions straight into the
  // note with no lead-in at all — no "Practice Questions" heading, nothing
  // marking the block as a distinct section from whatever came before it.
  const questions = SLASH_COMMANDS.find((c) => c.id === 'questions')!

  it('asks for a heading with no selection', () => {
    expect(questions.ai!('')).toContain('## Practice Questions')
  })

  it('asks for a heading with a selection too', () => {
    expect(questions.ai!('self-attention')).toContain('## Practice Questions')
  })
})

describe('the command table itself stays well-formed', () => {
  it('has no duplicate ids', () => {
    const seen = SLASH_COMMANDS.map((c) => c.id)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('gives every command exactly one behaviour', () => {
    // An entry with neither is a dead menu row; with both, it is ambiguous.
    // `table` is the one deliberate exception: NoteEditor special-cases its
    // id (the same way it does 'ai') to open a size picker instead of
    // running anything from this table directly, so it has neither `ai`
    // nor `run` here on purpose — see the comment on its entry above.
    for (const c of SLASH_COMMANDS) {
      if (c.id === 'table') {
        expect(c.ai, 'table must not also define ai').toBeUndefined()
        expect(c.run, 'table must not also define run').toBeUndefined()
        continue
      }
      expect(Boolean(c.ai) !== Boolean(c.run), `${c.id} must have ai xor run`).toBe(true)
    }
  })

  it('does not offer an image command — paste and drag already do that', () => {
    expect(SLASH_COMMANDS.map((c) => c.id)).not.toContain('image')
  })

  it('gives every command exactly one way to draw itself', () => {
    // H1/H2/H3 are the deliberate exception (`glyph`, not `icon` — see
    // SlashCommand's own comment): there is no icon for an arbitrary
    // letter. Everything else must have a real icon and nothing else.
    for (const c of SLASH_COMMANDS) {
      expect(Boolean(c.icon) !== Boolean(c.glyph), `${c.id} must have icon xor glyph`).toBe(true)
    }
  })

  it('every insert command in a section has one assigned', () => {
    // section only matters within `insert` — the render only reads it
    // there — but a command silently missing one would just never get a
    // sub-header, not fail loudly, so it's worth pinning directly.
    for (const c of SLASH_COMMANDS.filter((cmd) => cmd.group === 'insert')) {
      expect(c.section, `${c.id} has no section`).toBeDefined()
    }
  })

  it('regression: the six commands that all drew the same generic doc icon now draw distinct ones', () => {
    // h1/h2/h3/bullet/ordered/quote (plus code and table, wrong rather than
    // generic) all rendered the same 'note' icon, or one unrelated to what
    // they do — a lightning bolt for code, a card deck for a data table.
    // Bullet/ordered/todo/quote now reuse BLOCK_ICON — the selection bar's
    // own, already-correct map — rather than a second, independent (and
    // previously wrong) assignment.
    const icons = ['bullet', 'ordered', 'todo', 'quote', 'code', 'table', 'toggle', 'divider'].map(
      (id) => SLASH_COMMANDS.find((c) => c.id === id)!.icon,
    )
    expect(new Set(icons).size).toBe(icons.length)
    expect(icons).not.toContain('note')
    expect(icons).not.toContain('agent')
    expect(icons).not.toContain('deck')
  })
})
