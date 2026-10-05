/**
 * A topic's links to other topics, and the two ways to change them.
 *
 * Shared by `RelatedTopics` (the plain list on the Docs page and the Files
 * panel) and `LinkedTopicsMap` (the little constellation in the chat dock), so
 * both call the same three endpoints the same way and can't drift apart.
 *
 * Links are additive and symmetric: a link only ever adds sources to a
 * retrieval, never replaces the topic's own material.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSubspaceLink, deleteSubspaceLink, listSubspaceLinks } from '../../api/spaces'
import type { Space, Subspace, Tone } from '../../api/types'
import { useToast } from '../../components/ui/Toast'
import { useSpaces } from './SpacesProvider'

/** A topic you could link, with the subject it sits in. */
export type LinkCandidate = Subspace & { spaceName: string }

/** A linked topic, with what it takes to draw and open it. */
export type LinkedTopic = Subspace & { space: Space | null; tone: Tone }

export function useSubspaceLinks(subspaceId: string) {
  const { spaces } = useSpaces()
  const { showError, show } = useToast()
  const [links, setLinks] = useState<Subspace[] | null>(null)

  useEffect(() => {
    setLinks(null)
    listSubspaceLinks(subspaceId)
      .then(setLinks)
      .catch((err) => showError(err))
  }, [subspaceId, showError])

  const candidates: LinkCandidate[] = useMemo(
    () =>
      spaces
        .flatMap((sp) => sp.subspaces.map((sub) => ({ ...sub, spaceName: sp.name })))
        .filter((sub) => sub.id !== subspaceId && !links?.some((l) => l.id === sub.id)),
    [spaces, subspaceId, links],
  )

  /** The links, each with its subject (for its colour and its address). */
  const linked: LinkedTopic[] | null = useMemo(() => {
    if (!links) return null
    return links.map((l) => {
      const space =
        spaces.find((sp) => sp.id === l.subject_id) ??
        spaces.find((sp) => sp.subspaces.some((s) => s.id === l.id)) ??
        null
      return { ...l, space, tone: space?.tone ?? 'sky' }
    })
  }, [links, spaces])

  const add = useCallback(
    async (linkedId: string) => {
      try {
        await createSubspaceLink(subspaceId, linkedId)
        setLinks(await listSubspaceLinks(subspaceId))
      } catch (err) {
        showError(err)
      }
    },
    [subspaceId, showError],
  )

  const remove = useCallback(
    async (linkedId: string) => {
      try {
        await deleteSubspaceLink(subspaceId, linkedId)
        setLinks((prev) => (prev ? prev.filter((l) => l.id !== linkedId) : prev))
        show('Link removed.', 'success')
      } catch (err) {
        showError(err)
      }
    },
    [subspaceId, show, showError],
  )

  return { links, linked, candidates, add, remove, spaces }
}
