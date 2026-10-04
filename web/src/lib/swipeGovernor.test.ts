import { describe, expect, it } from 'vitest'
import { createSwipeGovernor, isApplePlatform } from './swipeGovernor'

/** Wheel events at 60Hz following a momentum curve: `first` px, shrinking by `decay` each frame. */
function momentum(first: number, decay: number): number[] {
  const out: number[] = []
  for (let d = first; d > 1; d *= decay) out.push(d)
  return out
}

/** Feed a stream through the governor; returns how far it let the page travel. */
function travel(deltas: number[], cap: number, frameMs = 16.7): number {
  const admit = createSwipeGovernor(() => cap)
  return deltas.reduce((sum, d, i) => (admit(d, i * frameMs) ? sum + d : sum), 0)
}

describe('createSwipeGovernor', () => {
  it('stops a flick at about one screen instead of letting its whole momentum (≈2,000px) through', () => {
    const flick = momentum(120, 0.94) // ≈2,000px in all
    expect(flick.reduce((a, b) => a + b, 0)).toBeGreaterThan(1900)
    const moved = travel(flick, 900)
    // One window's worth, plus the thin tail that arrives after the window has slid on.
    expect(moved).toBeGreaterThan(800)
    expect(moved).toBeLessThan(1100)
  })

  it('leaves a gentle flick, a slow drag and mouse-wheel notches alone', () => {
    expect(travel(momentum(50, 0.94), 900)).toBeCloseTo(momentum(50, 0.94).reduce((a, b) => a + b, 0), 5)
    expect(travel(Array(120).fill(15), 1800)).toBe(1800) // 15px × 60/s for 2s, one screen = 1800 here
    expect(travel(Array(8).fill(100), 900, 100)).toBe(800) // 8 notches over 0.8s
  })

  it('lets the next swipe through once the window has passed', () => {
    const admit = createSwipeGovernor(() => 900, 900)
    expect(admit(600, 0)).toBe(true)
    expect(admit(600, 100)).toBe(false) // same swipe: over the cap
    expect(admit(600, 1000)).toBe(true) // a second later: a new swipe
  })

  it('always admits the first event, however big, so a single large notch still moves the page', () => {
    expect(createSwipeGovernor(() => 900)(2000, 0)).toBe(true)
  })

  it('follows the cap as the window is resized', () => {
    let height = 900
    const admit = createSwipeGovernor(() => height)
    expect(admit(800, 0)).toBe(true)
    expect(admit(200, 10)).toBe(false)
    height = 1400
    expect(admit(200, 20)).toBe(true)
  })
})

describe('isApplePlatform', () => {
  const ua = (value: string) => Object.defineProperty(navigator, 'userAgent', { value, configurable: true })

  it('is true on a Mac and an iPad, false on Windows and Linux', () => {
    ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')
    expect(isApplePlatform()).toBe(true)
    ua('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15')
    expect(isApplePlatform()).toBe(true)
    ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')
    expect(isApplePlatform()).toBe(false)
    ua('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')
    expect(isApplePlatform()).toBe(false)
  })
})
