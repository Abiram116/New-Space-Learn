// @vitest-environment jsdom

/**
 * The splash came down as soon as auth resolved, and then `OnboardingGate`
 * raised its own circular spinner while it fetched the student model — two
 * loading screens back to back, the second one generic, which makes the first
 * read as decoration rather than as the app starting.
 *
 * The hold is what fixes it, and it has two failure modes that matter more
 * than the happy path: releasing too early (the double spinner returns) and
 * never releasing (a slow request becomes a permanent splash). Both are here.
 *
 * The module keeps its state at module scope, so each test re-imports it with
 * `resetModules` to get a clean counter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

async function fresh() {
  vi.resetModules()
  document.body.innerHTML = '<div id="boot"></div>'
  return import('./bootSplash')
}

const splash = () => document.getElementById('boot')

beforeEach(() => {
  vi.useFakeTimers()
})

describe('boot splash holds', () => {
  it('tears down when nothing is holding', async () => {
    const { hideBootSplash } = await fresh()
    hideBootSplash()
    await vi.advanceTimersByTimeAsync(2000)
    expect(splash()).toBeNull()
  })

  it('stays up while a screen is still deciding what to render', async () => {
    const { hideBootSplash, holdBootSplash } = await fresh()
    holdBootSplash()
    hideBootSplash()

    await vi.advanceTimersByTimeAsync(2000)
    // The whole point: auth resolving is not the same as the app being ready.
    expect(splash()).not.toBeNull()
  })

  it('comes down when the last holder releases', async () => {
    const { hideBootSplash, holdBootSplash } = await fresh()
    const release = holdBootSplash()
    hideBootSplash()
    await vi.advanceTimersByTimeAsync(1000)
    expect(splash()).not.toBeNull()

    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(splash()).toBeNull()
  })

  it('waits for every holder, not just one', async () => {
    const { hideBootSplash, holdBootSplash } = await fresh()
    const a = holdBootSplash()
    const b = holdBootSplash()
    hideBootSplash()

    a()
    await vi.advanceTimersByTimeAsync(1000)
    expect(splash()).not.toBeNull()

    b()
    await vi.advanceTimersByTimeAsync(1000)
    expect(splash()).toBeNull()
  })

  it('ignores a double release rather than under-counting', async () => {
    const { hideBootSplash, holdBootSplash } = await fresh()
    const a = holdBootSplash()
    const b = holdBootSplash()
    hideBootSplash()

    a()
    a() // React can invoke a cleanup twice in development.
    await vi.advanceTimersByTimeAsync(1000)
    // `b` is still holding; a miscounted release would have dropped the splash.
    expect(splash()).not.toBeNull()

    b()
    await vi.advanceTimersByTimeAsync(1000)
    expect(splash()).toBeNull()
  })

  it('does not hide on release alone when nobody asked to hide', async () => {
    const { holdBootSplash } = await fresh()
    holdBootSplash()()
    await vi.advanceTimersByTimeAsync(2000)
    // Releasing a hold is not a claim that the app is ready.
    expect(splash()).not.toBeNull()
  })

  it('the failsafe overrides a holder that never releases', async () => {
    const { armBootSplashFailsafe, hideBootSplash, holdBootSplash } = await fresh()
    armBootSplashFailsafe()
    holdBootSplash() // never released — a hung fetch, a screen that threw
    hideBootSplash()

    await vi.advanceTimersByTimeAsync(3000)
    expect(splash()).not.toBeNull()

    await vi.advanceTimersByTimeAsync(10_000)
    // Failing to a usable app beats failing to a permanent loading screen.
    expect(splash()).toBeNull()
  })
})
