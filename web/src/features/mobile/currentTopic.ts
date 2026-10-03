/**
 * "The topic you're in" on a phone, even on pages whose URL has no topic.
 *
 * Desktop always shows every topic in the rail, so it never needed this. The
 * phone replaces the rail with one switcher button, and Today / You have no
 * topic in their URL — so the shell remembers the last one you opened and
 * keeps pointing the Cards / Quizzes / Notes tabs at it. With nothing
 * remembered (first visit, or it was deleted) it picks the topic you touched
 * most recently, which is the honest answer to "where was I?".
 */

import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import type { Space, Subspace } from '../../api/types'
import { resolveTopicSegments, subspacePath } from '../../lib/nav'
import { useSpaces } from '../spaces/SpacesProvider'
import { resolveTopic, topicFromPath } from './phoneNav'

const KEY = 'sl:phone-topic'

function readRemembered(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function remember(subspaceId: string): void {
  try {
    localStorage.setItem(KEY, subspaceId)
  } catch {
    /* private mode — falls back to "most recent" next time */
  }
}

export type CurrentTopic = {
  space: Space | null
  subspace: Subspace | null
  /** `/s/:space/:sub`, or null when there is no topic anywhere yet. */
  base: string | null
  /** True while the subject list is still loading. */
  loading: boolean
}

export function useCurrentTopic(): CurrentTopic {
  const { pathname } = useLocation()
  const { spaces, loading } = useSpaces()
  // The URL names the topic by slug (or an old id); `resolveTopic` works in ids.
  const urlTopic = topicFromPath(pathname)
  const urlId = urlTopic
    ? (resolveTopicSegments(spaces, urlTopic.spaceId, urlTopic.subspaceId).subspace?.id ?? null)
    : null

  const resolved = useMemo(() => resolveTopic(spaces, urlId, readRemembered()), [spaces, urlId])

  // Only a topic the URL actually names becomes the remembered one — falling
  // back to "most recent" must not overwrite a choice the student made.
  const urlResolved = resolved && resolved.subspace.id === urlId ? urlId : null
  useEffect(() => {
    if (urlResolved) remember(urlResolved)
  }, [urlResolved])

  return {
    space: resolved?.space ?? null,
    subspace: resolved?.subspace ?? null,
    base: resolved ? subspacePath(resolved.space, resolved.subspace) : null,
    loading,
  }
}
