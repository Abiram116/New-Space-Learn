/**
 * Pacing buffer for streamed replies.
 *
 * Network deltas arrive in bursts (a proxy flushes 400 chars at once, then
 * nothing for 300ms), and painting each burst as it lands reads as stutter.
 * Instead every delta goes into a queue and is *revealed* on
 * requestAnimationFrame at a steady cadence:
 *
 *   rate = max(MIN_CPS, backlog / CATCH_UP_S)
 *
 * so a small backlog is drained at a calm constant speed, and a large one is
 * drained proportionally faster — the display never lags more than about
 * `CATCH_UP_S` behind what the network has delivered. `flush()` (stream end,
 * Stop) reveals everything at once, and reduced-motion users get plain
 * instant reveal with no pacing at all.
 *
 * The clock and scheduler are injectable so the arithmetic is testable
 * without a browser.
 */

export const MIN_CPS = 140
export const CATCH_UP_S = 0.35
/** A backgrounded tab throttles rAF to ~1Hz; without a cap the first frame
 *  back would reveal seconds' worth of text in one jump. */
export const MAX_FRAME_MS = 64

/** How many characters to reveal this frame, plus the fractional remainder
 *  to carry (at 140 cps a 16ms frame is 2.24 chars — the .24 must not be lost
 *  or the speed would be quantised down to whole characters). */
export function charsToReveal(
  backlog: number,
  dtMs: number,
  carry = 0,
): { count: number; carry: number } {
  if (backlog <= 0) return { count: 0, carry: 0 }
  const dt = Math.min(Math.max(dtMs, 0), MAX_FRAME_MS)
  const rate = Math.max(MIN_CPS, backlog / CATCH_UP_S)
  const exact = (rate * dt) / 1000 + carry
  const count = Math.min(backlog, Math.floor(exact))
  return { count, carry: count === backlog ? 0 : exact - count }
}

export type Scheduler = {
  request: (cb: (t: number) => void) => number
  cancel: (id: number) => void
}

const browserScheduler: Scheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
}

export class StreamPacer {
  private full = ''
  private shown = 0
  private visible = ''
  private carry = 0
  private raf = 0
  private last = 0
  private disposed = false
  private readonly listeners = new Set<() => void>()

  private readonly opts: { instant?: boolean; scheduler?: Scheduler }

  constructor(opts: { instant?: boolean; scheduler?: Scheduler } = {}) {
    this.opts = opts
  }

  /** Everything received so far, revealed or not. */
  get received(): string {
    return this.full
  }

  /** Characters received but not yet shown. */
  get backlog(): number {
    return this.full.length - this.shown
  }

  // Arrow properties: handed straight to useSyncExternalStore.
  getSnapshot = (): string => this.visible

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  push(delta: string): void {
    if (this.disposed || !delta) return
    this.full += delta
    if (this.opts.instant) {
      this.reveal(this.full.length)
      return
    }
    if (!this.raf) this.raf = this.scheduler.request(this.tick)
  }

  /** Reveal everything now. Used when the stream ends or the user hits Stop. */
  flush(): void {
    this.stopFrames()
    this.reveal(this.full.length)
  }

  dispose(): void {
    this.disposed = true
    this.stopFrames()
    this.listeners.clear()
  }

  private get scheduler(): Scheduler {
    return this.opts.scheduler ?? browserScheduler
  }

  private stopFrames(): void {
    if (this.raf) this.scheduler.cancel(this.raf)
    this.raf = 0
    this.last = 0
    this.carry = 0
  }

  private tick = (now: number): void => {
    this.raf = 0
    if (this.disposed) return
    const dt = this.last ? now - this.last : 16
    this.last = now
    const { count, carry } = charsToReveal(this.backlog, dt, this.carry)
    this.carry = carry
    if (count > 0) this.reveal(this.shown + count)
    if (this.backlog > 0) this.raf = this.scheduler.request(this.tick)
    else this.last = 0
  }

  private reveal(to: number): void {
    let end = Math.min(to, this.full.length)
    // Never cut a surrogate pair in half — it renders as a replacement glyph.
    if (end < this.full.length && isHighSurrogate(this.full.charCodeAt(end - 1))) end += 1
    if (end === this.shown) return
    this.shown = end
    this.visible = this.full.slice(0, end)
    for (const fn of this.listeners) fn()
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}
