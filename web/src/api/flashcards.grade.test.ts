// @vitest-environment jsdom
/**
 * A grade must survive a blip — and must never be applied twice.
 *
 * Review moves on the instant you grade, so a failed request used to leave the
 * card silently due. `gradeCard` now retries, and every attempt for one grade
 * carries the same `review_id`, which is what lets the server apply it once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  gradeCard,
  onUnsavedGrades,
  resetUnsavedGradesForTests,
  retryUnsavedGrades,
  unsavedGradeCount,
} from './flashcards'

const ok = (body: unknown = { id: 'c1' }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const fail = (code: number) =>
  new Response(JSON.stringify({ error: { code: code === 422 ? 'validation_error' : 'upstream_unavailable', message: 'no' } }), {
    status: code,
    headers: { 'content-type': 'application/json' },
  })

type Call = { url: string; body: { grade: string; review_id: string }; tz: string | null }
let calls: Call[]
let replies: Array<() => Response | Promise<Response>>

beforeEach(() => {
  vi.useFakeTimers()
  resetUnsavedGradesForTests()
  calls = []
  replies = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(init.body as string),
        tz: new Headers(init.headers).get('X-Timezone'),
      })
      const next = replies.shift()
      if (!next) throw new Error('unexpected request')
      return next()
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const netDown = () => {
  throw new TypeError('Failed to fetch')
}

describe('gradeCard', () => {
  it('re-sends after a dropped connection, with the SAME review id', async () => {
    replies = [netDown, () => fail(503), () => ok()]
    const done = gradeCard('c1', 'good')
    await vi.runAllTimersAsync()
    await expect(done).resolves.toEqual({ id: 'c1' })
    expect(calls).toHaveLength(3)
    expect(new Set(calls.map((c) => c.body.review_id)).size).toBe(1)
    expect(calls[0].body.review_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(calls[0].body.grade).toBe('good')
  })

  it('does not retry something the server refused', async () => {
    replies = [() => fail(422)]
    const done = gradeCard('c1', 'good')
    const settled = expect(done).rejects.toMatchObject({ status: 422 })
    await vi.runAllTimersAsync()
    await settled
    expect(calls).toHaveLength(1)
  })

  it('gives up after four attempts and reports the failure', async () => {
    replies = [netDown, netDown, netDown, netDown]
    const done = gradeCard('c1', 'easy')
    const settled = expect(done).rejects.toBeTruthy()
    await vi.runAllTimersAsync()
    await settled
    expect(calls).toHaveLength(4)
  })

  it('two grades are two ids', async () => {
    replies = [() => ok(), () => ok()]
    const both = Promise.all([gradeCard('c1', 'again'), gradeCard('c2', 'good')])
    await vi.runAllTimersAsync()
    await both
    expect(calls[0].body.review_id).not.toBe(calls[1].body.review_id)
  })

  it('grades for one card go out in order, even when the first is slow', async () => {
    let release: (r: Response) => void = () => {}
    replies = [() => new Promise<Response>((r) => (release = r)), () => ok()]
    const first = gradeCard('c1', 'again')
    const second = gradeCard('c1', 'good')
    await vi.advanceTimersByTimeAsync(50)
    expect(calls.map((c) => c.body.grade)).toEqual(['again']) // the second is waiting
    release(ok())
    await vi.runAllTimersAsync()
    await Promise.all([first, second])
    expect(calls.map((c) => c.body.grade)).toEqual(['again', 'good'])
  })

  it('a failed grade does not block the next one for that card', async () => {
    replies = [() => fail(422), () => ok()]
    const first = gradeCard('c1', 'again')
    const firstSettled = expect(first).rejects.toBeTruthy()
    const second = gradeCard('c1', 'good')
    await vi.runAllTimersAsync()
    await firstSettled
    await expect(second).resolves.toEqual({ id: 'c1' })
  })

  it('sends the student\'s time zone with the request', async () => {
    replies = [() => ok()]
    const done = gradeCard('c1', 'good')
    await vi.runAllTimersAsync()
    await done
    expect(calls[0].tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})

/**
 * A grade that ran out of attempts is kept, not dropped: it is counted as
 * unsaved until it gets through, and it goes out again with the same id.
 */
describe('grades that could not be sent', () => {
  const failAll = (n: number) => Array.from({ length: n }, () => netDown)

  it('counts a grade as unsaved from its first failed attempt until it is saved', async () => {
    const seen: number[] = []
    const off = onUnsavedGrades(() => seen.push(unsavedGradeCount()))
    replies = [netDown, () => ok()]
    const done = gradeCard('c1', 'good')
    await vi.advanceTimersByTimeAsync(10)
    expect(unsavedGradeCount()).toBe(1) // retrying, not saved yet
    await vi.runAllTimersAsync()
    await done
    expect(unsavedGradeCount()).toBe(0)
    expect(seen).toEqual([1, 0])
    off()
  })

  it('keeps a grade that ran out of attempts and sends it again on request, same id', async () => {
    replies = failAll(4)
    const done = gradeCard('c1', 'good')
    const settled = expect(done).rejects.toBeTruthy()
    await vi.runAllTimersAsync()
    await settled
    expect(unsavedGradeCount()).toBe(1)

    replies = [() => ok()]
    await expect(retryUnsavedGrades()).resolves.toBe(0)
    expect(calls).toHaveLength(5)
    expect(new Set(calls.map((c) => c.body.review_id)).size).toBe(1)
    expect(unsavedGradeCount()).toBe(0)

    // Nothing left: asking again sends nothing.
    await expect(retryUnsavedGrades()).resolves.toBe(0)
    expect(calls).toHaveLength(5)
  })

  it('stays unsaved when the retry fails too', async () => {
    replies = failAll(4)
    const done = gradeCard('c1', 'hard')
    const settled = expect(done).rejects.toBeTruthy()
    await vi.runAllTimersAsync()
    await settled
    replies = [netDown]
    await expect(retryUnsavedGrades()).resolves.toBe(1)
    expect(unsavedGradeCount()).toBe(1)
  })

  it('sends again by itself when the browser comes back online', async () => {
    replies = failAll(4)
    const done = gradeCard('c1', 'good')
    const settled = expect(done).rejects.toBeTruthy()
    await vi.runAllTimersAsync()
    await settled

    replies = [() => ok()]
    window.dispatchEvent(new Event('online'))
    await vi.runAllTimersAsync()
    expect(unsavedGradeCount()).toBe(0)
    expect(calls[4].body.review_id).toBe(calls[0].body.review_id)
  })

  it('a later grade for the same card waits behind the one still unsaved', async () => {
    replies = failAll(4)
    const first = gradeCard('c1', 'again')
    const firstSettled = expect(first).rejects.toBeTruthy()
    await vi.runAllTimersAsync()
    await firstSettled

    // Still offline: the second grade must not jump the queue, so it waits too.
    replies = [netDown]
    const second = gradeCard('c1', 'good')
    const secondSettled = expect(second).rejects.toBeTruthy()
    await vi.runAllTimersAsync()
    await secondSettled
    expect(unsavedGradeCount()).toBe(2)
    expect(calls.map((c) => c.body.grade)).toEqual(['again', 'again', 'again', 'again', 'again'])

    replies = [() => ok(), () => ok()]
    await expect(retryUnsavedGrades()).resolves.toBe(0)
    expect(calls.slice(5).map((c) => c.body.grade)).toEqual(['again', 'good'])
    expect(calls[5].body.review_id).toBe(calls[0].body.review_id)
    expect(calls[6].body.review_id).not.toBe(calls[0].body.review_id)
  })

  it('a grade that gets through takes the waiting ones for other cards with it', async () => {
    replies = failAll(4)
    const lost = gradeCard('c1', 'good')
    const lostSettled = expect(lost).rejects.toBeTruthy()
    await vi.runAllTimersAsync()
    await lostSettled

    replies = [() => ok({ id: 'c2' }), () => ok()]
    await expect(gradeCard('c2', 'easy')).resolves.toEqual({ id: 'c2' })
    await vi.runAllTimersAsync()
    expect(unsavedGradeCount()).toBe(0)
    expect(calls.at(-1)?.url).toContain('/cards/c1/grade')
  })

  it('lets go of a waiting grade the server refuses, and never counts a refusal as unsaved', async () => {
    replies = failAll(4)
    const done = gradeCard('c1', 'good')
    const settled = expect(done).rejects.toBeTruthy()
    await vi.runAllTimersAsync()
    await settled

    replies = [() => fail(422)]
    await expect(retryUnsavedGrades()).resolves.toBe(0)

    replies = [() => fail(422)]
    const refused = gradeCard('c2', 'good')
    const refusedSettled = expect(refused).rejects.toMatchObject({ status: 422 })
    await vi.runAllTimersAsync()
    await refusedSettled
    expect(unsavedGradeCount()).toBe(0)
  })
})
