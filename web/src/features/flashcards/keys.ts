/**
 * Keyboard for card review, as a pure function — see quizzes/keys.ts for the
 * gate every keydown passes first (typing, modifiers, modals, held keys).
 *
 *   Space / Enter   flip the card; once flipped, confirm the highlighted grade
 *   ← → / ↑ ↓       move the highlighted grade (starts on Good each card)
 *   1 – 4           grade directly (once flipped)
 *   Esc             end the session (progress is saved per card)
 */

import { isConfirmKey } from '../quizzes/keys'

export type ReviewKeyState = {
  flipped: boolean
  /** Highlighted grade, 0 (Again) – 3 (Easy). */
  highlight: number
  /** The grade button that holds DOM focus, if any. */
  focused?: number | null
  /** How many grades there are. */
  count: number
}

export type ReviewKeyAction =
  | { type: 'flip' }
  | { type: 'highlight'; index: number }
  | { type: 'grade'; index: number }
  | { type: 'leave' }

/** Good — the honest default for "I knew it". */
export const DEFAULT_GRADE_HIGHLIGHT = 2

export function reviewKeyAction(key: string, s: ReviewKeyState): ReviewKeyAction | null {
  if (key === 'Escape' || key === 'Esc') return { type: 'leave' }
  if (!s.flipped) {
    // Before the flip only the flip exists. Grading a card you haven't seen
    // the back of is a guess, not a recall.
    return isConfirmKey(key) ? { type: 'flip' } : null
  }
  const current = s.focused ?? s.highlight
  if (isConfirmKey(key)) return { type: 'grade', index: current }
  // An ordered scale, so the ends are ends: no wrapping from Easy to Again.
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return { type: 'highlight', index: Math.min(s.count - 1, current + 1) }
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return { type: 'highlight', index: Math.max(0, current - 1) }
  }
  if (key.length === 1 && key >= '1' && key <= '9') {
    const i = key.charCodeAt(0) - 49
    if (i < s.count) return { type: 'grade', index: i }
  }
  return null
}
