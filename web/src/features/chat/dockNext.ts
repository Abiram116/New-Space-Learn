/**
 * Where a person is in Space Learn, and what to do next.
 *
 * The dock has one orange button at a time, and it is always the one that does
 * the next useful thing: add files, review what's due, or make something. This
 * file is the whole of that rule, with no screen in it, so it is written down
 * once and can be read (and tested) without rendering anything.
 */

import type { AgentKey } from './agents'
import type { SourcesState } from './DockSources'

export type Progress = {
  files: SourcesState
  /** How many questions the person has sent in this topic's chat. */
  asked: number
  notes: number
  quizzes: number
  decks: number
  /** Cards due for review now, across the topic's decks. */
  due: number
}

export type NextKind = 'add' | 'waiting' | 'retry' | 'ask' | 'review' | AgentKey

export type Next = { kind: NextKind; label: string; disabled?: boolean }

/** The one thing to do now. */
export function nextStep(p: Progress): Next {
  // The order is fixed, so the button is never a surprise:
  //   1. a file that failed          → try it again
  //   2. a file being read           → wait (the button says so)
  //   3. cards that are due          → review them — even in a topic with no file
  //   4. no file yet                 → add one
  //   5. nothing asked yet           → ask
  //   6. otherwise                   → make the next thing: cards, then a quiz, then a note
  const noFile = p.files.ready === 0
  if (noFile && p.files.kind === 'loading') return { kind: 'waiting', label: 'One moment…', disabled: true }
  if (noFile && p.files.kind === 'failed') return { kind: 'retry', label: 'Try reading the file again' }
  if (noFile && p.files.kind === 'reading') return { kind: 'waiting', label: 'Waiting for your file', disabled: true }
  // Cards you owe a review come first: that is the habit the app is for.
  if (p.due > 0) return { kind: 'review', label: `Review ${p.due} ${p.due === 1 ? 'card' : 'cards'}` }
  if (noFile) return { kind: 'add', label: 'Add a file' }
  if (p.asked === 0) return { kind: 'ask', label: 'Ask a question' }
  if (p.decks === 0) return { kind: 'flashcards', label: 'Make flashcards' }
  if (p.quizzes === 0) return { kind: 'quiz', label: 'Make a quiz' }
  return { kind: 'notes', label: 'Save last answer as a note' }
}
