// @vitest-environment jsdom
/**
 * Home's message stays current without any screen remembering to say so.
 *
 * These drive the real API client with a stubbed `fetch`: a write that succeeds
 * must leave the brief needing a refetch, a write that fails or changes nothing
 * relevant must not, and a burst of writes must cost one refetch, not one each.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const STATS = {
  streak_days: 1, max_streak: 1, study_minutes_this_week: 0, cards_due: 0, quiz_average: null,
  docs_indexed: 0, spaces_count: 1, heatmap: [], badges: [], daily_goal: 20,
  composition: { chat_messages: 0, cards_reviewed: 0, quizzes_taken: 0 }, due_forecast: [],
}

type Calls = { brief: string[]; stats: number; writes: string[] }

/** A backend whose brief text counts how many times it has been asked. */
function backend(over: { briefDelayMs?: number; failWrites?: boolean } = {}) {
  const calls: Calls = { brief: [], stats: 0, writes: [] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://x')
      const path = u.pathname.replace(/^\/api\/v1/, '') + u.search
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'GET' && path.startsWith('/me/brief')) {
        calls.brief.push(path)
        if (over.briefDelayMs) await new Promise((r) => setTimeout(r, over.briefDelayMs))
        return json({ headline: `Brief ${calls.brief.length}`, body: 'b', generated: true, suggestion: null })
      }
      if (method === 'GET' && path === '/me/stats') {
        calls.stats++
        return json(STATS)
      }
      if (method === 'GET' && path.includes('/documents')) {
        return json(documents)
      }
      calls.writes.push(`${method} ${path}`)
      if (over.failWrites) return json({ error: { code: 'internal_error', message: 'no' } }, 500)
      return json({ ok: true, id: 'x', status: 'processing' })
    }),
  )
  return calls
}

let documents: { id: string; status: string }[] = []

async function load() {
  vi.resetModules()
  const cache = await import('./briefCache')
  const quizzes = await import('../api/quizzes')
  const flashcards = await import('../api/flashcards')
  const notes = await import('../api/notes')
  const docs = await import('../api/documents')
  const spaces = await import('../api/spaces')
  const me = await import('../api/me')
  return { cache, quizzes, flashcards, notes, docs, spaces, me }
}

// Every `load()` re-evaluates the module, which registers another focus
// listener. In the app that happens once; here they would pile up and the
// earlier instances (holding earlier tests' entries) would refetch too.
const listeners: [EventTarget, string, EventListener][] = []

beforeEach(() => {
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target)
    vi.spyOn(target, 'addEventListener').mockImplementation(((type: string, fn: EventListener) => {
      listeners.push([target, type, fn])
      add(type, fn)
    }) as typeof target.addEventListener)
  }
  sessionStorage.clear()
  documents = []
  window.history.pushState({}, '', '/somewhere-else')
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  for (const [target, type, fn] of listeners.splice(0)) target.removeEventListener(type, fn)
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Read, then report how many times the backend has been asked. */
async function reads(cache: { getCachedBrief: () => Promise<{ headline: string }> }) {
  return (await cache.getCachedBrief()).headline
}

describe('a successful write makes the next brief fresh', () => {
  const cases: [string, (m: Awaited<ReturnType<typeof load>>) => Promise<unknown>][] = [
    ['submitting a quiz', (m) => m.quizzes.submitQuiz('q1', [0], 30)],
    ['grading a card', (m) => m.flashcards.gradeCard('c1', 'good')],
    ['generating cards', (m) => m.flashcards.generateCards('s1', { topic: 't' })],
    ['generating a quiz', (m) => m.quizzes.generateQuiz('s1', { topic: 't' })],
    ['generating a note', (m) => m.notes.generateNote('s1', { topic: 't' })],
    ['creating a note', (m) => m.notes.createNote('s1', { title: 'n' })],
    ['editing what a note says', (m) => m.notes.updateNote('n1', { body_md: 'more' })],
    ['creating a space', (m) => m.spaces.createSpace({ name: 'Chem' })],
    ['deleting a topic', (m) => m.spaces.deleteSubspace('s1')],
    ['changing the daily goal', (m) => m.me.updateSettings({ daily_goal: 30 })],
    ['changing the exam context', (m) => m.me.updateStudentModel({ exam_context: 'Boards' })],
  ]

  it.each(cases)('%s', async (_name, act) => {
    const calls = backend()
    const m = await load()
    expect(await reads(m.cache)).toBe('Brief 1')
    expect(await reads(m.cache)).toBe('Brief 1') // cached
    expect(calls.brief).toHaveLength(1)

    await act(m)
    expect(await reads(m.cache)).toBe('Brief 2')
    expect(calls.brief).toHaveLength(2)
    expect(calls.stats).toBeGreaterThanOrEqual(0)
  })

  it('also refreshes the stats', async () => {
    const calls = backend()
    const m = await load()
    await m.cache.getCachedStats()
    await m.quizzes.submitQuiz('q1', [0])
    await m.cache.getCachedStats()
    expect(calls.stats).toBe(2)
  })
})

describe('what does not invalidate', () => {
  it('a failed write', async () => {
    const calls = backend({ failWrites: true })
    const m = await load()
    await reads(m.cache)
    await expect(m.quizzes.submitQuiz('q1', [0])).rejects.toThrow()
    await reads(m.cache)
    expect(calls.brief).toHaveLength(1)
  })

  it('a read', async () => {
    const calls = backend()
    const m = await load()
    await reads(m.cache)
    await m.quizzes.listQuizzes('s1')
    await reads(m.cache)
    expect(calls.brief).toHaveLength(1)
  })

  it('a note edit that only toggles a flag, or an inline-AI request', async () => {
    const calls = backend()
    const m = await load()
    await reads(m.cache)
    await m.notes.updateNote('n1', { ai_touched: true })
    await m.notes.noteAiInline('s1', 'summarise', 'text')
    await reads(m.cache)
    expect(calls.brief).toHaveLength(1)
  })
})

describe('a burst of writes', () => {
  it('costs one refetch, not one per write', async () => {
    const calls = backend()
    const m = await load()
    await reads(m.cache)
    for (let i = 0; i < 25; i++) await m.flashcards.gradeCard(`c${i}`, 'good')
    expect(calls.brief).toHaveLength(1) // marking stale fetches nothing
    await reads(m.cache)
    await reads(m.cache)
    expect(calls.brief).toHaveLength(2)
  })
})

describe('documents', () => {
  it('finishing processing is noticed from the next read', async () => {
    const calls = backend()
    const m = await load()
    documents = [{ id: 'd1', status: 'processing' }]
    await m.docs.listDocuments('s1')
    await reads(m.cache)

    await m.docs.listDocuments('s1') // still processing: nothing changed
    await reads(m.cache)
    expect(calls.brief).toHaveLength(1)

    documents = [{ id: 'd1', status: 'ready' }]
    await m.docs.listDocuments('s1')
    await reads(m.cache)
    expect(calls.brief).toHaveLength(2)
  })

  it('a document first seen as ready is not a change', async () => {
    const calls = backend()
    const m = await load()
    await reads(m.cache)
    documents = [{ id: 'd9', status: 'ready' }]
    await m.docs.listDocuments('s1')
    await reads(m.cache)
    expect(calls.brief).toHaveLength(1)
  })
})

describe('the brief request', () => {
  it('tells the server the browser zone', async () => {
    const calls = backend()
    const m = await load()
    await reads(m.cache)
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(calls.brief[0]).toBe(`/me/brief?tz=${encodeURIComponent(zone)}`)
  })
})

describe('never blocks Home', () => {
  it('serves the previous message if the fresh one is slow', async () => {
    const calls = backend()
    const m = await load()
    await reads(m.cache)

    // Now the backend is slow (a cold start).
    backend({ briefDelayMs: 20_000 })
    await m.quizzes.submitQuiz('q1', [0])
    const read = reads(m.cache)
    await vi.advanceTimersByTimeAsync(1_600)
    expect(await read).toBe('Brief 1')
    expect(calls.brief).toHaveLength(1)
  })
})

describe('revalidation on return', () => {
  it('refreshes an open Home when the tab regains focus after a minute', async () => {
    const calls = backend()
    const m = await load()
    window.history.pushState({}, '', '/home')
    await reads(m.cache)

    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.brief).toHaveLength(1) // too soon

    await vi.advanceTimersByTimeAsync(61_000)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.brief).toHaveLength(2)
  })

  it('does not spend a refresh on a page that is not Home', async () => {
    const calls = backend()
    const m = await load()
    await reads(m.cache)
    await vi.advanceTimersByTimeAsync(61_000)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.brief).toHaveLength(1)
  })

  it('refreshes an open Home shortly after a write, once', async () => {
    const calls = backend()
    const m = await load()
    window.history.pushState({}, '', '/home')
    await reads(m.cache)
    for (let i = 0; i < 5; i++) await m.flashcards.gradeCard(`c${i}`, 'good')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(calls.brief).toHaveLength(2)
  })

  it('a hidden tab is left alone', async () => {
    const calls = backend()
    const m = await load()
    window.history.pushState({}, '', '/home')
    await reads(m.cache)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await vi.advanceTimersByTimeAsync(61_000)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.brief).toHaveLength(1)
  })
})

describe('sign-out', () => {
  it('forgets the brief outright', async () => {
    const calls = backend()
    const m = await load()
    await reads(m.cache)
    m.cache.clearBriefCache()
    await reads(m.cache)
    expect(calls.brief).toHaveLength(2)
  })
})
