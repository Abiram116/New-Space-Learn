import { describe, expect, it } from 'vitest'
import { CATCH_UP_S, charsToReveal, MAX_FRAME_MS, MIN_CPS, StreamPacer, type Scheduler } from './streamPacer'

/** A hand-cranked rAF. */
function fakeScheduler() {
  let cb: ((t: number) => void) | null = null
  let id = 0
  const s: Scheduler = {
    request: (fn) => {
      cb = fn
      return ++id
    },
    cancel: () => {
      cb = null
    },
  }
  return {
    s,
    pending: () => cb !== null,
    frame(t: number) {
      const fn = cb
      cb = null
      fn?.(t)
    },
  }
}

describe('charsToReveal', () => {
  it('reveals nothing with no backlog', () => {
    expect(charsToReveal(0, 16)).toEqual({ count: 0, carry: 0 })
  })

  it('runs at the steady minimum rate for a small backlog and carries fractions', () => {
    // 140 cps * 16ms = 2.24 chars
    const a = charsToReveal(10, 16, 0)
    expect(a.count).toBe(2)
    expect(a.carry).toBeCloseTo(0.24, 2)
    // The carried fraction is spent on the next frame: 2.24 + 2.24 = 4.48 -> 2 more.
    const b = charsToReveal(8, 16, a.carry)
    expect(b.count).toBe(2)
    expect(b.carry).toBeCloseTo(0.48, 2)
  })

  it('speeds up in proportion to the backlog so it never lags far behind', () => {
    const slow = charsToReveal(100, 16).count
    const fast = charsToReveal(4000, 16).count
    expect(fast).toBeGreaterThan(slow * 5)
    // A 4000-char backlog is cleared in about CATCH_UP_S.
    const perSecond = (4000 / CATCH_UP_S) * 1
    expect(fast).toBe(Math.floor((perSecond * 16) / 1000))
  })

  it('never reveals more than the backlog', () => {
    expect(charsToReveal(1, 64).count).toBe(1)
  })

  it('caps the frame time so a resumed background tab does not dump text', () => {
    const capped = charsToReveal(10_000, 60_000).count
    expect(capped).toBe(charsToReveal(10_000, MAX_FRAME_MS).count)
    expect(MIN_CPS).toBeGreaterThan(0)
  })
})

describe('StreamPacer', () => {
  it('reveals on frames, not on push', () => {
    const fs = fakeScheduler()
    const p = new StreamPacer({ scheduler: fs.s })
    p.push('Hello, world of streaming text.')
    expect(p.getSnapshot()).toBe('')
    expect(p.backlog).toBe(31)
    fs.frame(1000)
    const first = p.getSnapshot()
    expect(first.length).toBeGreaterThan(0)
    expect(first.length).toBeLessThan(31)
    expect('Hello, world of streaming text.'.startsWith(first)).toBe(true)
  })

  it('eventually shows everything and stops scheduling frames', () => {
    const fs = fakeScheduler()
    const p = new StreamPacer({ scheduler: fs.s })
    p.push('abcdefghij')
    let t = 0
    for (let i = 0; i < 100 && fs.pending(); i++) fs.frame((t += 16))
    expect(p.getSnapshot()).toBe('abcdefghij')
    expect(fs.pending()).toBe(false)
  })

  it('notifies subscribers only when the visible text changes', () => {
    const fs = fakeScheduler()
    const p = new StreamPacer({ scheduler: fs.s })
    let n = 0
    const off = p.subscribe(() => n++)
    p.push('abc')
    expect(n).toBe(0)
    fs.frame(16)
    fs.frame(32)
    expect(n).toBeGreaterThan(0)
    const before = n
    off()
    p.flush()
    expect(n).toBe(before)
  })

  it('flush reveals everything immediately and cancels pending frames', () => {
    const fs = fakeScheduler()
    const p = new StreamPacer({ scheduler: fs.s })
    p.push('a long reply that is still queued up')
    p.flush()
    expect(p.getSnapshot()).toBe('a long reply that is still queued up')
    expect(fs.pending()).toBe(false)
  })

  it('instant mode (reduced motion) reveals on push with no frames', () => {
    const fs = fakeScheduler()
    const p = new StreamPacer({ scheduler: fs.s, instant: true })
    p.push('hi ')
    p.push('there')
    expect(p.getSnapshot()).toBe('hi there')
    expect(fs.pending()).toBe(false)
  })

  it('does not split a surrogate pair', () => {
    const fs = fakeScheduler()
    const p = new StreamPacer({ scheduler: fs.s })
    p.push('a😀b😀c😀d😀e😀')
    let t = 0
    while (fs.pending()) {
      fs.frame((t += 16))
      const v = p.getSnapshot()
      const last = v.charCodeAt(v.length - 1)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    }
  })

  it('ignores pushes after dispose', () => {
    const fs = fakeScheduler()
    const p = new StreamPacer({ scheduler: fs.s })
    p.dispose()
    p.push('x')
    expect(fs.pending()).toBe(false)
    expect(p.getSnapshot()).toBe('')
  })
})
