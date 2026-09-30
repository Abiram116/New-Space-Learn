// @vitest-environment jsdom
/**
 * The shared "an agent is running" state behind Make cards / Make quiz /
 * Save a note. The failure it exists to prevent: clicking and seeing nothing
 * for two seconds.
 */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/flashcards', () => ({ generateCards: vi.fn() }))
vi.mock('../../api/quizzes', () => ({ generateQuiz: vi.fn() }))
vi.mock('../../api/notes', () => ({ generateNote: vi.fn() }))

import { generateCards } from '../../api/flashcards'
import { generateNote } from '../../api/notes'
import { generateQuiz } from '../../api/quizzes'
import {
  REDIRECT_DELAY_MS,
  agentRunsReducer,
  busyAgents,
  clampTopic,
  progressTitle,
  useAgentRuns,
  type AgentRun,
} from './useAgentRuns'

const cardsMock = vi.mocked(generateCards)
const quizMock = vi.mocked(generateQuiz)
const noteMock = vi.mocked(generateNote)

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(source: string | undefined = 'Attention weighs tokens.') {
  const navigate = vi.fn()
  const hook = renderHook(() =>
    useAgentRuns({
      subspaceId: 's1',
      base: '/s/a/b',
      navigate,
      getSourceText: () => source,
    }),
  )
  return { navigate, ...hook }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('pure helpers', () => {
  const run = (over: Partial<AgentRun>): AgentRun => ({
    id: 1,
    agent: 'quiz',
    status: 'running',
    startedAt: 0,
    title: 't',
    ...over,
  })

  it('busyAgents flags only running runs', () => {
    expect(busyAgents([])).toEqual({ notes: false, quiz: false, flashcards: false })
    expect(
      busyAgents([run({ agent: 'flashcards' }), run({ id: 2, agent: 'quiz', status: 'done' })]),
    ).toEqual({ notes: false, quiz: false, flashcards: true })
  })

  it('a new run drops finished cards but keeps ones still running', () => {
    const before = [run({ id: 1, status: 'done' }), run({ id: 2, agent: 'notes' })]
    const after = agentRunsReducer(before, { type: 'start', run: run({ id: 3 }) })
    expect(after.map((r) => r.id)).toEqual([2, 3])
  })

  it('titles say what is being made and from what', () => {
    expect(progressTitle('flashcards', {}, true)).toBe('Making 8 flashcards from this answer…')
    expect(progressTitle('flashcards', {}, false)).toBe('Making 8 flashcards from this topic…')
    expect(progressTitle('flashcards', { topic: 'TCP' }, true)).toContain('“TCP”')
    expect(progressTitle('quiz', {}, false)).toBe('Writing a 5-question quiz from this topic…')
    expect(progressTitle('notes', {}, false)).toBe('Writing your note…')
  })

  it('clampTopic trims and truncates', () => {
    expect(clampTopic('  hi  ', 10)).toBe('hi')
    expect(clampTopic('abcdef', 3)).toBe('abc')
    expect(clampTopic('   ', 3)).toBeUndefined()
    expect(clampTopic(undefined, 3)).toBeUndefined()
  })
})

describe('useAgentRuns', () => {
  it('is busy and shows a progress run the moment start() is called', () => {
    const d = deferred<never>()
    cardsMock.mockReturnValue(d.promise)
    const { result } = setup()

    act(() => result.current.start('flashcards'))

    expect(result.current.busy.flashcards).toBe(true)
    expect(result.current.busy.quiz).toBe(false)
    expect(result.current.runs).toHaveLength(1)
    expect(result.current.runs[0]).toMatchObject({
      agent: 'flashcards',
      status: 'running',
      title: 'Making 8 flashcards from this answer…',
    })
  })

  it('ignores a second start of the same agent while one is running', () => {
    cardsMock.mockReturnValue(deferred<never>().promise)
    const { result } = setup()
    act(() => {
      result.current.start('flashcards')
      result.current.start('flashcards')
    })
    expect(cardsMock).toHaveBeenCalledTimes(1)
    expect(result.current.runs).toHaveLength(1)
  })

  it('seeds a deck from the last answer and shows success before redirecting', async () => {
    cardsMock.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, deck_id: 'deck-9' })) as never,
    )
    const { result, navigate } = setup()

    await act(async () => result.current.start('flashcards'))

    expect(cardsMock).toHaveBeenCalledWith('s1', {
      topic: undefined,
      source_text: 'Attention weighs tokens.',
      count: 8,
    })
    expect(result.current.runs[0]).toMatchObject({
      status: 'done',
      doneText: '8 cards ready',
      href: '/s/a/b/flashcards?deck=deck-9',
    })
    expect(result.current.busy.flashcards).toBe(false)
    // The success state is visible first...
    expect(navigate).not.toHaveBeenCalled()
    // ...then the redirect happens.
    await act(async () => {
      vi.advanceTimersByTime(REDIRECT_DELAY_MS)
    })
    expect(navigate).toHaveBeenCalledWith('/s/a/b/flashcards?deck=deck-9')
  })

  it('open() navigates immediately and cancels the pending redirect', async () => {
    quizMock.mockResolvedValue({ id: 'q7' } as never)
    const { result, navigate } = setup()
    await act(async () => result.current.start('quiz', { topic: 'TCP' }))
    expect(quizMock).toHaveBeenCalledWith('s1', { topic: 'TCP', count: 5 })
    const run = result.current.runs[0]
    expect(run.doneText).toBe('Quiz ready')

    act(() => result.current.open(run.id, run.href!))
    expect(navigate).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(REDIRECT_DELAY_MS * 3)
    })
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('passes the note brief through and lands on the new note', async () => {
    noteMock.mockResolvedValue({ id: 'n3' } as never)
    const { result, navigate } = setup()
    await act(async () =>
      result.current.start('notes', { topic: 'Paging', instructions: '  just a checklist ' }),
    )
    expect(noteMock).toHaveBeenCalledWith('s1', { topic: 'Paging', instructions: 'just a checklist' })
    expect(result.current.runs[0]).toMatchObject({ status: 'done', doneText: 'Note saved' })
    await act(async () => {
      vi.advanceTimersByTime(REDIRECT_DELAY_MS)
    })
    expect(navigate).toHaveBeenCalledWith('/s/a/b/notes?n=n3')
  })

  it('surfaces a failure with a message, never redirects, and retry runs it again', async () => {
    quizMock.mockRejectedValueOnce(new Error('Quiz service is down'))
    const { result, navigate } = setup()

    await act(async () => result.current.start('quiz'))
    expect(result.current.runs[0]).toMatchObject({
      status: 'error',
      error: 'Quiz service is down',
    })
    expect(result.current.busy.quiz).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(REDIRECT_DELAY_MS * 3)
    })
    expect(navigate).not.toHaveBeenCalled()

    quizMock.mockResolvedValueOnce({ id: 'q1' } as never)
    await act(async () => result.current.retry(result.current.runs[0].id))
    expect(quizMock).toHaveBeenCalledTimes(2)
    expect(result.current.runs[0]).toMatchObject({ status: 'done', href: '/s/a/b/quizzes?q=q1' })
  })

  it('a dismissed run never redirects', async () => {
    const d = deferred<{ id: string }>()
    noteMock.mockReturnValue(d.promise as never)
    const { result, navigate } = setup()
    act(() => result.current.start('notes'))
    act(() => result.current.dismiss(result.current.runs[0].id))
    await act(async () => {
      d.resolve({ id: 'n1' })
      vi.advanceTimersByTime(REDIRECT_DELAY_MS * 2)
    })
    expect(result.current.runs).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not redirect after unmount', async () => {
    quizMock.mockResolvedValue({ id: 'q1' } as never)
    const { result, navigate, unmount } = setup()
    await act(async () => result.current.start('quiz'))
    unmount()
    vi.advanceTimersByTime(REDIRECT_DELAY_MS * 2)
    expect(navigate).not.toHaveBeenCalled()
  })
})
