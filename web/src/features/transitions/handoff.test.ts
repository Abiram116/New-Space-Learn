// @vitest-environment jsdom

/**
 * The handoff's guarantees are all about ordering, and none of them are
 * visible in the rendered overlay — which is exactly why they are worth
 * testing. Each case here corresponds to a way the transition would look
 * broken to a student rather than to a way the code would throw.
 *
 * Timings are passed in, so these run in milliseconds rather than the real
 * ~2.5 seconds. `runHandoffSequence` takes them as arguments for this reason.
 */

import { describe, expect, it, vi } from 'vitest'
import { runHandoffSequence } from './Handoff'

type Phase = 'in' | 'out' | null

/** Records the phase timeline plus where the work landed inside it. */
function recorder() {
  const events: string[] = []
  return {
    events,
    onPhase: (p: Phase) => events.push(p === null ? 'clear' : p),
  }
}

describe('runHandoffSequence', () => {
  it('runs the work while the screen is covered, never before or after', async () => {
    const r = recorder()

    await runHandoffSequence({
      inMs: 40,
      outMs: 20,
      work: () => {
        r.events.push('work')
      },
      onPhase: r.onPhase,
    })

    // The whole point: the navigation happens between the cover landing and
    // the uncover starting. Work before 'in' is a visible hard cut; work
    // after 'out' is a page assembling itself in front of the student.
    expect(r.events).toEqual(['in', 'work', 'out', 'clear'])
  })

  it('holds the cover until the work finishes, even when it runs long', async () => {
    const r = recorder()
    const start = Date.now()

    await runHandoffSequence({
      inMs: 30,
      outMs: 10,
      work: async () => {
        await new Promise((res) => setTimeout(res, 120))
        r.events.push('work')
      },
      onPhase: r.onPhase,
    })

    expect(r.events).toEqual(['in', 'work', 'out', 'clear'])
    // Slow work extends the cover rather than being cut off by it.
    expect(Date.now() - start).toBeGreaterThanOrEqual(120)
  })

  it('lets go when the work hangs, instead of holding the screen hostage', async () => {
    const r = recorder()

    await runHandoffSequence({
      inMs: 20,
      outMs: 10,
      ceilingMs: 60,
      // Never resolves — a dead backend, an offline device.
      work: () => new Promise<void>(() => {}),
      onPhase: r.onPhase,
    })

    // The curtain must still come up. Failing to a usable app beats failing
    // to a beautiful permanent loading screen.
    expect(r.events).toEqual(['in', 'out', 'clear'])
  })

  it('completes the transition when the work throws', async () => {
    const r = recorder()

    await expect(
      runHandoffSequence({
        inMs: 20,
        outMs: 10,
        work: () => {
          throw new Error('preferences save failed')
        },
        onPhase: r.onPhase,
      }),
    ).resolves.toBeUndefined()

    // A failed save is recoverable and the caller reports it; being stranded
    // behind the curtain is not recoverable.
    expect(r.events).toEqual(['in', 'out', 'clear'])
  })

  it('always clears the overlay, even if a phase callback throws', async () => {
    const onPhase = vi.fn((p: Phase) => {
      if (p === 'out') throw new Error('render blew up')
    })

    await expect(
      runHandoffSequence({ inMs: 10, outMs: 10, work: () => {}, onPhase }),
    ).rejects.toThrow('render blew up')

    // The `finally` still fires, so the curtain is torn down rather than
    // left welded over a working app.
    expect(onPhase).toHaveBeenLastCalledWith(null)
  })
})
