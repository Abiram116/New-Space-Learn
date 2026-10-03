import { useParams } from 'react-router-dom'
import type { Space, Subspace } from '../api/types'
import { useCurrentTopic } from '../features/mobile/currentTopic'
import { useActiveSubspace } from './nav'

export type TopicScope = {
  space: Space | null
  subspace: Subspace | null
  /** `/s/<subject>/<topic>` — where in-topic links (Docs, "add material") point. */
  base: string
  /** True on `/notes`, `/flashcards` and `/quizzes`, which have no topic in
   *  their address; the topic is then only where NEW things get created. */
  isGlobal: boolean
}

/**
 * Which topic a Notes / Cards / Quizzes screen works in.
 *
 * Those three screens list everything the student has, across every subject —
 * the topic only decides where something NEW is created and which material it
 * draws on. So they live at `/notes`, `/flashcards` and `/quizzes`, and borrow
 * the current topic (`useCurrentTopic`: the one in the URL, else the last one
 * opened, else the most recently active) instead of putting an arbitrary topic
 * in the address bar. The same screens are still reachable under a topic's own
 * URL, where that topic is used as-is.
 */
export function useTopicScope(): TopicScope {
  const { spaceId } = useParams()
  const inTopic = useActiveSubspace()
  const current = useCurrentTopic()

  if (spaceId) return { ...inTopic, isGlobal: false }
  return {
    space: current.space,
    subspace: current.subspace,
    base: current.base ?? '/',
    isGlobal: true,
  }
}
