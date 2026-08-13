/**
 * `resolveDone` — the frontend half of the citation-reconciliation contract
 * `rag.strip_invalid_citations` establishes on the backend.
 *
 * The backend strips a `[[n]]` marker pointing at a source that doesn't
 * exist AFTER the stream has already sent those tokens raw — so the
 * streamed buffer and the stored row can legitimately disagree, and the
 * `done` event's `content` is what actually got saved. Get this backwards
 * and a student sees one answer on screen and a different one on refresh,
 * silently — nothing throws, nothing errors, the bubble just doesn't match
 * history anymore.
 */

import { describe, expect, it } from 'vitest'
import type { Citation } from '../../api/types'
import { resolveDone } from './ChatView'

const cite = (marker: number): Citation => ({
  marker,
  document_id: `doc-${marker}`,
  document_name: `doc-${marker}.pdf`,
  locator: `p.${marker}`,
  snippet: 'snippet',
})

describe('text', () => {
  it('prefers the server canonical content over the streamed buffer', () => {
    // This is the actual bug class: the model emitted [[7]] with only 4
    // sources, the server stripped it, and the streamed text still has it.
    const result = resolveDone(
      { content: 'The answer, cleaned.', citations: [] },
      { text: 'The answer, with [[7]] still in it.', citations: [] },
    )
    expect(result.text).toBe('The answer, cleaned.')
  })

  it('falls back to the streamed buffer when an older backend sends no content', () => {
    const result = resolveDone(
      { content: null, citations: [] },
      { text: 'Streamed text only.', citations: [] },
    )
    expect(result.text).toBe('Streamed text only.')
  })

  it('falls back to a placeholder when there is nothing at all', () => {
    expect(resolveDone({ content: null, citations: [] }, null).text).toBe('(no reply)')
  })

  it('treats server content of only whitespace as nothing, not a blank bubble', () => {
    const result = resolveDone(
      { content: '   ', citations: [] },
      { text: 'irrelevant', citations: [] },
    )
    expect(result.text).toBe('(no reply)')
  })

  it('trims the resolved text', () => {
    const result = resolveDone(
      { content: '  padded  ', citations: [] },
      { text: '', citations: [] },
    )
    expect(result.text).toBe('padded')
  })
})

describe('citations', () => {
  it('prefers server citations when the server sent any', () => {
    const result = resolveDone(
      { content: 'x', citations: [cite(1)] },
      { text: '', citations: [cite(1), cite(2)] },
    )
    expect(result.citations).toEqual([cite(1)])
  })

  it('falls back to the streamed citations when the done event has none', () => {
    // NOT "no citations" — every citation is sent as its own `citation`
    // event mid-stream, so an empty array on `done` means "nothing new to
    // add here", not "there were none". Falling back to [] would make every
    // source card the student already saw vanish the instant the stream ends.
    const result = resolveDone(
      { content: 'x', citations: [] },
      { text: '', citations: [cite(1), cite(2)] },
    )
    expect(result.citations).toEqual([cite(1), cite(2)])
  })

  it('is an empty array, not undefined, when neither side has any', () => {
    expect(resolveDone({ content: 'x', citations: [] }, null).citations).toEqual([])
  })
})
