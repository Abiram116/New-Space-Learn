/**
 * How strictly a topic's tutor sticks to the student's files — per topic, on
 * this device.
 *
 *   'files'   answers only from this topic's (and its linked topics') files,
 *             and says so when they don't cover a question.
 *   'subject' the files first, then general knowledge that is clearly within
 *             this subject, marked as not from the files.
 *
 * Neither is a general assistant: off-topic questions are declined either way.
 * A topic with no choice of its own follows the account-wide "Answer only from
 * my docs" setting, so the request simply leaves the field out.
 */

import { useSyncExternalStore } from 'react'

export type TopicScope = 'files' | 'subject'

const key = (subspaceId: string) => `sl:scope:${subspaceId}`
const listeners = new Set<() => void>()

export function topicScopeNow(subspaceId: string): TopicScope | null {
  try {
    const v = window.localStorage.getItem(key(subspaceId))
    return v === 'files' || v === 'subject' ? v : null
  } catch {
    return null
  }
}

export function setTopicScope(subspaceId: string, scope: TopicScope | null): void {
  try {
    if (scope) window.localStorage.setItem(key(subspaceId), scope)
    else window.localStorage.removeItem(key(subspaceId))
  } catch {
    /* blocked storage: the choice lasts for this page only */
  }
  listeners.forEach((l) => l())
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith('sl:scope:')) onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function useTopicScopeChoice(subspaceId: string): TopicScope | null {
  return useSyncExternalStore(
    subscribe,
    () => topicScopeNow(subspaceId),
    () => null,
  )
}
