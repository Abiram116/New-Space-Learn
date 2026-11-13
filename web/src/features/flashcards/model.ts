/**
 * The review state machine and the grade ramp — the two things every
 * flashcards module needs and none of them should own.
 *
 * `Mode` lives here rather than in `FlashcardsView` because `Review` both
 * reads it and writes it back through `setMode`; with the type defined in the
 * parent, extracting `Review` at all would have meant a circular import.
 */

import type { Flashcard, Grade } from '../../api/types'
import type { Pulse } from '../../components/celebrate'

/**
 * Grades read as a difficulty ramp, cold → hot.
 *
 * `text` is the `-deep` ink — the pure hue on the dark ground doesn't clear
 * contrast (see lib/tone). It tints the session tallies, where four figures
 * do need telling apart at a glance. The grade row itself no longer uses it:
 * see the note there.
 */
export const GRADES: {
  key: Grade
  label: string
  hotkey: string
  text: string
}[] = [
  { key: 'again', label: 'Again', hotkey: '1', text: 'text-coral-deep' },
  { key: 'hard', label: 'Hard', hotkey: '2', text: 'text-sun-deep' },
  { key: 'good', label: 'Good', hotkey: '3', text: 'text-sky-deep' },
  { key: 'easy', label: 'Easy', hotkey: '4', text: 'text-mint-deep' },
]

/**
 * The states: the binder, one deck's contents, review, the summary — and
 * practice, a flip-through of a deck with nothing due that records no grades.
 */
export type Mode =
  | { kind: 'decks' }
  | { kind: 'deck'; deckId: string }
  | { kind: 'practice'; deckId: string; cards: Flashcard[]; index: number; flipped: boolean }
  | ({ kind: 'review'; deckId: string; cards: Flashcard[]; index: number; flipped: boolean; grades: Grade[] } & SessionMeta)
  | ({ kind: 'summary'; deckId: string; grades: Grade[] } & SessionMeta)

/**
 * Set only on a capped "due across my decks" session (`?review=due&limit=N`):
 * how big each batch is, how many due cards are still waiting behind it, and
 * whether it drew from more than one deck (so the summary can't name just one).
 */
export type SessionMeta = { limit?: number; pending?: number; mixed?: boolean }

/** How the room answers each grade. Again dims it for a breath — never red,
 *  never dark; a miss is information. */
export const GRADE_PULSE: Record<Grade, Pulse> = {
  again: 'miss',
  hard: 'soft',
  good: 'good',
  easy: 'bright',
}

/** Cards in one "review what's due" session; the rest are offered as "Keep going". */
export const REVIEW_BATCH = 20


/** Said wherever "Review again" is offered or running: it sends no grades. */
export const PRACTICE_NOTE = 'Practice only. This does not change when your cards are due.'
