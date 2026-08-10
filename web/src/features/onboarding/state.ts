/**
 * Has this student been through first-run intake?
 *
 * Answered from the **student model**, not from a flag, wherever possible: if
 * any preference is already set then the intake has served its purpose,
 * whether it ran on this device or another one. A `localStorage` flag alone
 * would re-run the whole thing on a second browser for someone who has been
 * using the app for months.
 *
 * The local flag exists only for the case the server cannot cover — someone
 * who skipped every question. There is nothing stored to distinguish them from
 * a brand-new account, and asking again on every load would be the worse of
 * the two failures. Per-user key so two accounts on one machine don't inherit
 * each other's answer.
 */

import type { StudentModel } from '../../api/types'

const KEY = 'sl:onboarded:v1'

function key(userId: string): string {
  return `${KEY}:${userId}`
}

/** True when the student has answered or explicitly skipped, on this device. */
export function hasSkippedLocally(userId: string | null): boolean {
  if (!userId) return false
  try {
    return localStorage.getItem(key(userId)) === '1'
  } catch {
    // Private mode or a blocked store. Treat as "not skipped" — showing the
    // intake once more is recoverable; suppressing it forever is not.
    return false
  }
}

/** Called once the intake finishes, however it finished. */
export function markOnboarded(userId?: string | null): void {
  try {
    // The id is optional because the finishing component doesn't always have
    // it to hand; the un-suffixed key still stops the immediate re-prompt, and
    // the server-side check below is what actually decides on the next load.
    localStorage.setItem(userId ? key(userId) : KEY, '1')
  } catch {
    /* nothing to do — the server-side check still applies */
  }
}

/**
 * The real test: does the app already know how this student wants to be
 * taught? Any one answer is enough — the intake exists to get *something*,
 * not to fill every field.
 */
export function hasPreferences(model: StudentModel | null): boolean {
  if (!model) return false
  return Boolean(
    model.learning_style || model.teaching_preference || model.session_length_minutes,
  )
}
