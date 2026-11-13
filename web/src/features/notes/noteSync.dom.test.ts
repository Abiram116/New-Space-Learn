// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Note } from '../../api/types'
import { announceNoteChange, onNoteChange } from './noteSync'

const note: Note = {
  id: 'n1', title: 'T', body_md: 'Body', origin: 'user', source_ids: null,
  updated_at: '2026-01-01T00:00:00Z', touched_by_user: true, touched_by_agent: true,
}

describe('noteSync', () => {
  it('delivers each change once to every listener, and stops after unsubscribing', async () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = onNoteChange(a)
    const offB = onNoteChange(b)
    announceNoteChange(note, 'added')
    await vi.waitFor(() => expect(a).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(b).toHaveBeenCalledTimes(1))
    expect(a.mock.calls[0][0]).toMatchObject({ noteId: 'n1', body_md: 'Body', addition: 'added', touched_by_agent: true })
    offA()
    announceNoteChange(note, 'again')
    await vi.waitFor(() => expect(b).toHaveBeenCalledTimes(2))
    expect(a).toHaveBeenCalledTimes(1)
    offB()
  })
})
