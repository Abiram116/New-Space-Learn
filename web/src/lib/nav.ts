import { useParams } from 'react-router-dom'
import type { Space, Subspace } from '../api/types'
import { useSpaces } from '../features/spaces/SpacesProvider'

/**
 * Subspace routing. Ids only.
 *
 * Slug-based URLs were attempted and removed. The remains are worth a line so
 * nobody re-adds them casually: the migration put a NOT NULL `slug` column on
 * `subjects` and `subspaces`, which broke every insert until the API supplied
 * one, and the matching route change dropped the `/s/` prefix while every link
 * still emitted it — so nothing matched and the whole app 404'd. Two moving
 * parts, both able to break the product on their own.
 *
 * If readable URLs are wanted later, they need doing as one deliberate piece
 * of work: column + backfill + insert path + route + link builder, together.
 * `subspacePath` below is the single place URLs are built, which is where that
 * change belongs.
 */

/** The canonical route for a subspace. MUST stay in step with the `/s/`
 *  route pattern in `App.tsx`. */
export function subspacePath(space: Space, subspace: Subspace): string {
  return `/s/${space.id}/${subspace.id}`
}

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
  const base = space && subspace ? subspacePath(space, subspace) : '/'
  return { space, subspace, base }
}

/** Picks a target subspace for global nav items (sidebar's Notes / Cards). */
export function useFallbackSubspace(): { base: string; hasAny: boolean } {
  const { space, subspace } = useActiveSubspace()
  const { spaces } = useSpaces()

  if (space && subspace) return { base: subspacePath(space, subspace), hasAny: true }

  for (const s of spaces) {
    if (s.subspaces.length > 0) {
      return { base: subspacePath(s, s.subspaces[0]), hasAny: true }
    }
  }
  return { base: '', hasAny: false }
}
