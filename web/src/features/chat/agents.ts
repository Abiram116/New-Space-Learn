import type { IconName } from '../../components/ui/Icon'

/**
 * Agents are one-shot ACTIONS: they read the conversation, make you something,
 * and they're done. They are not Skills.
 *
 * Skills are persistent AI personalities that change how every answer in a
 * topic is written. They live in their own screen and are switched on, not run.
 * "skills" used to be listed here as a fourth agent, which is precisely why
 * nobody could tell the two apart.
 */
export type AgentKey = 'notes' | 'quiz' | 'flashcards'

export const AGENT_LABELS: Record<AgentKey, string> = {
  notes: 'Save a note',
  quiz: 'Make a quiz',
  flashcards: 'Make cards',
}

/** What each one produces — the promise, in the product's own words. */
export const AGENT_RESULT: Record<AgentKey, string> = {
  notes: 'Turns the last answer into a note you can edit.',
  quiz: 'Writes multiple-choice questions from this topic.',
  flashcards: 'Drafts a deck of question-and-answer cards.',
}

export const AGENT_ICON: Record<AgentKey, IconName> = {
  notes: 'note',
  quiz: 'quiz',
  flashcards: 'deck',
}

export const AGENT_TONE: Record<AgentKey, 'brand' | 'sky' | 'sun'> = {
  notes: 'brand',
  quiz: 'sky',
  flashcards: 'sun',
}
