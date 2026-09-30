import { describe, expect, it } from 'vitest'
import type { Space, StudyComposition } from '../../api/types'
import { deriveChecklist } from './checklist'
import { topicsByRecency } from './today'

function topics(counts: Record<string, number>) {
  const sp: Space = {
    id: 's',
    name: 'ML',
    tone: 'brand',
    pinned: false,
    subspaces: [{ id: 't', subject_id: 's', name: 'RL', last_activity_at: null, counts }],
  }
  return topicsByRecency([sp])
}

const comp = (chat_messages: number): StudyComposition => ({ chat_messages, cards_reviewed: 0, quizzes_taken: 0 })

describe('deriveChecklist', () => {
  it('a brand-new account starts at step 1', () => {
    const c = deriveChecklist([], { docs_indexed: 0, composition: comp(0) })
    expect(c.steps.map((s) => s.done)).toEqual([false, false, false])
    expect(c.next?.id).toBe('material')
    expect(c.complete).toBe(false)
  })

  it('material counts only once a document is ready', () => {
    // Uploaded but still processing: `docs` counts it, `docs_indexed` does not.
    expect(deriveChecklist(topics({ docs: 1 }), { docs_indexed: 0, composition: comp(0) }).next?.id).toBe('material')
    expect(deriveChecklist(topics({ docs: 1 }), { docs_indexed: 1, composition: comp(0) }).next?.id).toBe('practice')
  })

  it('falls back to topic counts while stats load, so a done step does not flash undone', () => {
    expect(deriveChecklist(topics({ docs: 2 }), null).steps[0].done).toBe(true)
  })

  it('cards or a quiz both complete step 2', () => {
    expect(deriveChecklist(topics({ quizzes: 1 }), { docs_indexed: 1, composition: comp(0) }).next?.id).toBe('tutor')
    expect(deriveChecklist(topics({ cards: 4 }), { docs_indexed: 1, composition: comp(0) }).next?.id).toBe('tutor')
  })

  it('one chat message completes it', () => {
    const c = deriveChecklist(topics({ cards: 4 }), { docs_indexed: 1, composition: comp(1) })
    expect(c.complete).toBe(true)
    expect(c.next).toBeNull()
  })

  it('steps are independent — later ones can light before earlier ones', () => {
    const c = deriveChecklist(topics({ cards: 4 }), { docs_indexed: 0, composition: comp(3) })
    expect(c.steps.map((s) => s.done)).toEqual([false, true, true])
    expect(c.next?.id).toBe('material')
  })

  it('survives a stale stats payload with no composition', () => {
    const c = deriveChecklist(topics({}), { docs_indexed: 0 } as never)
    expect(c.steps[2].done).toBe(false)
  })
})
