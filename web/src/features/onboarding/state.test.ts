// @vitest-environment jsdom

/**
 * "Skip for now" shipped doing nothing, and it is worth being precise about
 * why, because the code looked correct at both ends.
 *
 * `markOnboarded(userId?)` falls back to an un-suffixed key when no id is
 * passed. `hasSkippedLocally(userId)` only ever reads the per-user key. Each
 * function is defensible alone; together they meant the intake wrote its "done"
 * flag to a key nothing reads, so the gate re-checked the server, found no
 * preferences — because you had just skipped answering — and sent you straight
 * back to the screen you were trying to leave.
 *
 * The bug lived in the *gap* between two functions, which is exactly the kind
 * a per-function test misses. So these tests assert the round trip.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { hasPreferences, hasSkippedLocally, markOnboarded } from './state'

const USER = 'user-abc-123'

beforeEach(() => {
  localStorage.clear()
})

describe('onboarding skip round trip', () => {
  it('remembers a skip for the user who skipped', () => {
    markOnboarded(USER)
    expect(hasSkippedLocally(USER)).toBe(true)
  })

  it('does NOT remember a skip when the id is omitted', () => {
    // The regression, pinned deliberately. This is the real behaviour of the
    // fallback path — writing it down means the next caller who is tempted to
    // drop the argument sees the consequence in a test name rather than in a
    // student bouncing off the intake forever.
    markOnboarded()
    expect(hasSkippedLocally(USER)).toBe(false)
  })

  it('keeps two accounts on one machine independent', () => {
    markOnboarded(USER)
    expect(hasSkippedLocally('someone-else')).toBe(false)
  })

  it('treats a missing user as not-skipped rather than throwing', () => {
    expect(hasSkippedLocally(null)).toBe(false)
  })
})

describe('hasPreferences', () => {
  it('accepts any single answer — the intake exists to get something', () => {
    expect(hasPreferences({ learning_style: 'examples first' } as never)).toBe(true)
    expect(hasPreferences({ session_length_minutes: 30 } as never)).toBe(true)
    expect(hasPreferences({ teaching_preference: 'go deep' } as never)).toBe(true)
  })

  it('rejects an empty or absent model', () => {
    expect(hasPreferences(null)).toBe(false)
    expect(hasPreferences({} as never)).toBe(false)
  })

  it('does not count an empty string as an answer', () => {
    // Otherwise submitting the free-text step with nothing typed would read as
    // "already onboarded" and suppress the intake on every future device.
    expect(hasPreferences({ teaching_preference: '' } as never)).toBe(false)
  })
})
