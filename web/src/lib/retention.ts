import type { Flashcard } from '../api/types'

/**
 * A forgetting-curve estimate (R = e^(-t/S)), not an invented number — t is
 * real days elapsed since the card was last reviewed, S is a stability
 * proxy from the card's own SM-2 state (interval × ease, both already
 * stored). Returns null when there's no review history yet to base an
 * estimate on, rather than showing a number that would just be a guess.
 *
 * This is explicitly an estimate, never presented as measured fact — see
 * the fullness()-metric mistake in docs/retrospective.md for why that
 * distinction matters.
 */
export function estimateRetention(card: Flashcard): number | null {
  if (card.reps < 1) return null
  const dueAt = new Date(card.due_at).getTime()
  const lastReviewedAt = dueAt - card.interval_days * 86_400_000
  const daysElapsed = (Date.now() - lastReviewedAt) / 86_400_000
  const stability = Math.max(card.interval_days, 1) * Math.max(card.ease, 1)
  const retention = Math.exp(-daysElapsed / stability) * 100
  return Math.round(Math.min(100, Math.max(0, retention)))
}
