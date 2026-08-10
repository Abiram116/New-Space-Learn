/**
 * The review state machine and the grade ramp — the two things every
 * flashcards module needs and none of them should own.
 *
 * `Mode` lives here rather than in `FlashcardsView` because `Review` both
 * reads it and writes it back through `setMode`; with the type defined in the
 * parent, extracting `Review` at all would have meant a circular import.
 */

import type { Flashcard, Grade } from '../../api/types'

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

/** The four states: the binder, one deck's contents, review, the summary. */
export type Mode =
  | { kind: 'decks' }
  | { kind: 'deck'; deckId: string }
  | { kind: 'review'; deckId: string; cards: Flashcard[]; index: number; flipped: boolean; grades: Grade[] }
  | { kind: 'summary'; deckId: string; grades: Grade[] }
