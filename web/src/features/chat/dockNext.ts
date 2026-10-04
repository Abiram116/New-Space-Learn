/**
 * Where a person is in Space Learn, and what to do next.
 *
 * The dock is a three-step checklist — add a file, ask a question, practise —
 * with one orange button pinned at the foot that always says the next step.
 * This file is the whole of that logic, with no screen in it, so the rules are
 * written down once and can be read (and tested) without rendering anything.
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

export type StepStatus = 'done' | 'current' | 'todo' | 'problem'

export type Steps = {
  files: StepStatus
  ask: StepStatus
  practice: StepStatus
  /** How many of the three are done. */
  done: number
}

export function steps(p: Progress): Steps {
  const filesReady = p.files.ready > 0
  const made = p.notes + p.quizzes + p.decks > 0

  const files: StepStatus = filesReady
    ? 'done'
    : p.files.kind === 'failed'
      ? 'problem'
      : p.files.kind === 'loading'
        ? 'todo'
        : 'current'
  const ask: StepStatus = p.asked > 0 ? 'done' : filesReady ? 'current' : 'todo'
  const practice: StepStatus = made ? 'done' : filesReady && p.asked > 0 ? 'current' : 'todo'

  return { files, ask, practice, done: [files, ask, practice].filter((s) => s === 'done').length }
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

const MAKES: AgentKey[] = ['notes', 'flashcards', 'quiz']

/** The things to make that the main button isn't offering. */
export function otherMakes(next: Next): AgentKey[] {
  return MAKES.filter((m) => m !== next.kind)
}

/** What Nova says at the top of a new topic's dock, and the mood she says it in. */
export type NovaLine = { mood: 'wave' | 'working' | 'curious' | 'happy' | 'proud' | 'celebrate' | 'idle'; line: string }

/**
 * Nova is the one who talks. Her line is the headline of the dock — short,
 * warm, and always about the next thing — and her face shows the state before
 * the words are read: waving at a new topic, working while a file is read,
 * curious when one fails, proud once there are questions to turn into practice.
 */
export function novaSays(p: Progress): NovaLine {
  const s = steps(p)
  if (p.files.kind === 'loading') return { mood: 'idle', line: 'One moment…' }
  if (s.done === 3) return { mood: 'celebrate', line: 'You’re all set. Nice work!' }
  if (s.files === 'problem') return { mood: 'curious', line: `I couldn’t read ${p.files.failedName ?? 'that one'}. Try again?` }
  if (p.files.kind === 'none') return { mood: 'wave', line: 'Hi, I’m Nova! Add your notes and I’ll answer from them, with page numbers.' }
  if (p.files.ready === 0) return { mood: 'working', line: 'Reading your file… one moment.' }
  if (p.asked === 0) return { mood: 'happy', line: 'Got it! Ask me anything about it.' }
  return { mood: 'proud', line: 'Good questions. Want to turn them into practice?' }
}
