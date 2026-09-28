import type { Flashcard } from '../api/types'
import { retrievability } from './schedule'

/**
 * R(t, S) — the actual FSRS retrievability, the same quantity the scheduler
 * itself grades from, not a guessed proxy. `stability` and `last_review_at`
 * come from the server's FSRS state, so once a card has been graded at
 * least once this is a real read of the model, not an estimate standing in
 * for one. Returns null before that first grade, when there's no FSRS state
 * yet to read.
 */
export function estimateRetention(card: Flashcard): number | null {
  if (card.stability == null || !card.last_review_at) return null
  const daysElapsed = (Date.now() - new Date(card.last_review_at).getTime()) / 86_400_000
  const retention = retrievability(Math.max(0, daysElapsed), card.stability) * 100
  return Math.round(Math.min(100, Math.max(0, retention)))
}
