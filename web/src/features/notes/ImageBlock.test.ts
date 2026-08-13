/**
 * `parseTitle` / `buildTitle` — the round-trip a note's image survives on
 * every save and reload.
 *
 * Worth testing on its own for the same reason `ImageBlock.tsx`'s file
 * header gives for the design: a note is stored as markdown, so anything an
 * image "knows" (width, alignment) has to be encoded into the one string
 * markdown gives an image — `title` — and decoded back out correctly, or the
 * failure is silent. Nothing throws; the image just quietly forgets its size
 * or alignment the next time the note opens. That is exactly the class of
 * bug this suite exists to catch before a student notices it.
 */

import { describe, expect, it } from 'vitest'
import { MAX_WIDTH, MIN_WIDTH, buildTitle, parseTitle } from './ImageBlock'

describe('parseTitle', () => {
  it('reads null and empty titles as no width, centred', () => {
    expect(parseTitle(null)).toEqual({ width: null, align: 'center' })
    expect(parseTitle('')).toEqual({ width: null, align: 'center' })
  })

  it('reads a width', () => {
    expect(parseTitle('w=62')).toEqual({ width: 62, align: 'center' })
  })

  it('reads an alignment', () => {
    expect(parseTitle('a=left')).toEqual({ width: null, align: 'left' })
    expect(parseTitle('a=right')).toEqual({ width: null, align: 'right' })
  })

  it('reads both together, in either order', () => {
    expect(parseTitle('w=40;a=left')).toEqual({ width: 40, align: 'left' })
    expect(parseTitle('a=right;w=80')).toEqual({ width: 80, align: 'right' })
  })

  it('clamps a width outside the usable range', () => {
    expect(parseTitle(`w=${MIN_WIDTH - 15}`).width).toBe(MIN_WIDTH)
    expect(parseTitle(`w=${MAX_WIDTH + 50}`).width).toBe(MAX_WIDTH)
  })

  it('ignores an unparseable width rather than crashing on it', () => {
    // A hand-edited or corrupted note is exactly where this matters — a
    // markdown file is plain text, so nothing stops a stray edit.
    expect(parseTitle('w=not-a-number')).toEqual({ width: null, align: 'center' })
  })

  it('ignores an unrecognised alignment value', () => {
    expect(parseTitle('a=diagonal')).toEqual({ width: null, align: 'center' })
  })

  it('ignores an unrelated title string entirely', () => {
    // Standard markdown images can carry an ordinary title/tooltip; this
    // extension must not mistake one for its own key=value syntax.
    expect(parseTitle('A photo of the whiteboard')).toEqual({ width: null, align: 'center' })
  })
})

describe('buildTitle', () => {
  it('returns null when there is nothing worth writing', () => {
    // Centre is the default — writing "a=center" into every image in every
    // note would be pure noise, so it is specifically omitted.
    expect(buildTitle(null, 'center')).toBeNull()
  })

  it('writes width alone', () => {
    expect(buildTitle(62, 'center')).toBe('w=62')
  })

  it('writes alignment alone, when it is not centre', () => {
    expect(buildTitle(null, 'left')).toBe('a=left')
    expect(buildTitle(null, 'right')).toBe('a=right')
  })

  it('writes both together', () => {
    expect(buildTitle(40, 'left')).toBe('w=40;a=left')
  })

  it('rounds a fractional width', () => {
    // The resize handle produces fractional percentages mid-drag; nothing
    // downstream expects markdown to carry that precision.
    expect(buildTitle(62.7, 'center')).toBe('w=63')
  })
})

describe('the round-trip', () => {
  it('recovers exactly what was written, for every alignment', () => {
    for (const align of ['left', 'center', 'right'] as const) {
      for (const width of [MIN_WIDTH, 40, 62, MAX_WIDTH]) {
        const title = buildTitle(width, align)
        expect(parseTitle(title)).toEqual({ width, align })
      }
    }
  })

  it('recovers "no width set" as null, not as a number', () => {
    const title = buildTitle(null, 'left')
    expect(parseTitle(title).width).toBeNull()
  })

  it('survives a full width, centred image round-tripping to null and back', () => {
    // The "reset to full width" control sets width to null — confirm that
    // state itself survives a save/reload, not just the non-null cases.
    const title = buildTitle(null, 'center')
    expect(title).toBeNull()
    expect(parseTitle(title)).toEqual({ width: null, align: 'center' })
  })
})
