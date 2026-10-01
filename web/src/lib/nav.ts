import { useParams } from 'react-router-dom'
import type { Space, Subspace } from '../api/types'
import { useSpaces } from '../features/spaces/SpacesProvider'

/**
 * Subspace routing.
 *
 * URLs read `/<subject>/<topic>/notes`. Each segment is a slug derived from
 * the name (`lib/slug.ts`) and an id is accepted anywhere a slug is, so
 * bookmarks from before slugs existed and routes the server builds
 * (`BriefSuggestion.route`, which still says `/s/<id>/<id>`) still land —
 * `routes/TopicCanonical` then rewrites them to the readable form. The old
 * `/s/` prefix is only kept as an address that forwards.
 *
 * Slugs live only in the browser. An earlier attempt stored them in the
 * database and broke every insert until the API supplied one, and dropped the
 * `/s/` prefix from the route while links still emitted it, so the whole app
 * 404'd. `subspacePath` below is the single place URLs are built.
 */

/** The canonical route for a subspace. MUST stay in step with the
 *  `/:spaceId/:subspaceId` route pattern in `App.tsx`; the first segment can't
 *  be a word in `RESERVED_ROOTS` (see `lib/slug.ts`). */
export function subspacePath(space: Space, subspace: Subspace): string {
  return `/${space.slug ?? space.id}/${subspace.slug ?? subspace.id}`
}

/**
 * Finds the subject and topic a URL's two segments name. Each segment may be a
 * slug or an id; ids win, so a name that happens to look like an id can never
 * shadow the real one. The topic is only looked for inside the subject it was
 * written under, because topic slugs are only unique within their subject.
 */
export function resolveTopicSegments(
  spaces: Space[],
  spaceSegment: string | undefined,
  subspaceSegment: string | undefined,
): { space: Space | null; subspace: Subspace | null } {
  if (!spaceSegment) return { space: null, subspace: null }
  const space =
    spaces.find((s) => s.id === spaceSegment) ??
    spaces.find((s) => s.slug === spaceSegment) ??
    null
  if (!space || !subspaceSegment) return { space, subspace: null }
  const subspace =
    space.subspaces.find((s) => s.id === subspaceSegment) ??
    space.subspaces.find((s) => s.slug === subspaceSegment) ??
    null
  return { space, subspace }
}

/**
 * Resolves the URL's `:spaceId/:subspaceId` (slugs or ids) against the live
 * space list.
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
  const { space, subspace } = resolveTopicSegments(spaces, spaceId, subspaceId)
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
