/**
 * What the dock knows about the topic's work, worked out from data it already
 * holds (the notes, quizzes and decks it loads for its counts, and the chat's
 * own messages). Nothing here calls the AI or needs a request of its own.
 */

import type { Deck, Note, Quiz } from '../../api/types'
import { prefersReducedMotion } from '../../components/mascot/runtime'

export type DockQuestion = { id: string; text: string }

export type DockLists = {
  decks: Deck[]
  quizzes: Quiz[]
  notes: Note[]
  /** What the student has asked in this chat, oldest first. */
  questions: DockQuestion[]
}

/** A quiz never taken, or best-scored under this, is worth another go. */
export const SOLID_AT = 80
/** The quiz that most deserves a go: the weakest score, or one never taken. */
export function worthAnotherGo(quizzes: Quiz[]): Quiz | null {
  const rank = (q: Quiz) => (typeof q.best_score === 'number' ? q.best_score : SOLID_AT - 0.5)
  return (
    quizzes
      .filter((q) => typeof q.best_score !== 'number' || q.best_score < SOLID_AT)
      .sort((a, b) => rank(a) - rank(b))[0] ?? null
  )
}

/** Scrolls the chat to a question, if it is still on the page. */
export function jumpToQuestion(id: string) {
  const el = document.getElementById(`msg-${id}`)
  el?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}
