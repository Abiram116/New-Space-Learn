/**
 * The desktop first-run checklist, derived from what Home already loads.
 *
 * Three steps, in the order the product actually works: material in, then
 * something to be tested on, then a question to the tutor. Each is read off
 * counts Home has anyway (`/spaces` counts and `/me/stats`), so the checklist
 * costs no request of its own.
 */

import type { Stats } from '../../api/types'
import type { TopicEntry } from './today'

export type StepId = 'material' | 'practice' | 'tutor'

export type ChecklistStep = {
  id: StepId
  n: 1 | 2 | 3
  title: string
  done: boolean
}

export type Checklist = {
  steps: ChecklistStep[]
  /** The first step not yet done, or null when all three are. */
  next: ChecklistStep | null
  complete: boolean
}

export function deriveChecklist(
  topics: TopicEntry[],
  stats: Pick<Stats, 'docs_indexed' | 'composition'> | null | undefined,
): Checklist {
  const sum = (k: 'docs' | 'cards' | 'quizzes') =>
    topics.reduce((n, t) => n + (t.subspace.counts?.[k] ?? 0), 0)

  // "Ready" is what matters for step 1 — a document still processing can't be
  // asked about yet. `docs_indexed` is that number; the topic counts are the
  // fallback while stats are still loading, so the checklist does not flash
  // an unticked step at someone who has already uploaded.
  const material = stats ? (stats.docs_indexed ?? 0) > 0 : sum('docs') > 0
  const practice = sum('cards') + sum('quizzes') > 0
  const tutor = (stats?.composition?.chat_messages ?? 0) > 0

  const steps: ChecklistStep[] = [
    { id: 'material', n: 1, title: 'Add a file', done: material },
    { id: 'practice', n: 2, title: 'Make cards or a quiz', done: practice },
    { id: 'tutor', n: 3, title: 'Ask the tutor', done: tutor },
  ]
  const next = steps.find((s) => !s.done) ?? null
  return { steps, next, complete: next === null }
}

const HIDE_KEY = 'sl:checklist-hidden:v1'

/** Someone who has used the app for a while may never want step 3 — let them put it away. */
export function isChecklistHidden(accountKey: string | null | undefined): boolean {
  if (!accountKey) return false
  try {
    return localStorage.getItem(`${HIDE_KEY}:${accountKey}`) === '1'
  } catch {
    return false
  }
}

export function hideChecklist(accountKey: string | null | undefined): void {
  if (!accountKey) return
  try {
    localStorage.setItem(`${HIDE_KEY}:${accountKey}`, '1')
  } catch {
    /* nothing to do — it just shows again next time */
  }
}
