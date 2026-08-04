import { useParams } from 'react-router-dom'
import type { Space, Subspace } from '../api/types'
import { useSpaces } from '../features/spaces/SpacesProvider'

/**
 * Resolves the URL's `:spaceId/:subspaceId` against the live space list.
 *
 * Returns null when either doesn't exist so views can render "not found"
 * rather than crashing on undefined access. `base` is a convenience URL
 * segment for building tab links inside a subspace.
 */
export function useActiveSubspace(): {
  space: Space | null
  subspace: Subspace | null
  base: string
} {
  const { spaceId, subspaceId } = useParams()
  const { spaces } = useSpaces()
  const space = spaces.find((s) => s.id === spaceId) ?? null
  const subspace = space?.subspaces.find((s) => s.id === subspaceId) ?? null
  const base = space && subspace ? `/s/${space.id}/${subspace.id}` : '/'
  return { space, subspace, base }
}

/** Picks a target subspace for global nav items (sidebar's Notes / Cards). */
export function useFallbackSubspace(): { base: string; hasAny: boolean } {
  const { space, subspace } = useActiveSubspace()
  const { spaces } = useSpaces()

  if (space && subspace) return { base: `/s/${space.id}/${subspace.id}`, hasAny: true }

  for (const s of spaces) {
    if (s.subspaces.length > 0) {
      return { base: `/s/${s.id}/${s.subspaces[0].id}`, hasAny: true }
    }
  }
  return { base: '', hasAny: false }
}
