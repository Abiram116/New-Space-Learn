/**
 * Keeps a topic's address in its readable form.
 *
 * Wraps every `/:subject/:topic/...` route (and the old `/s/:subject/:topic/...`). Whatever the URL names a topic by
 * — an id from an old bookmark, a route the server built, a name the student
 * has since changed — this rewrites it to the current `/s/<subject>/<topic>`
 * and keeps the rest of the path, the query and the hash. It is a client-side
 * replace, so there is no request and no extra history entry.
 *
 * It renders its children untouched until the subject list has loaded and the
 * URL resolves, so a topic that really doesn't exist still reaches the page's
 * own "not found" state rather than being redirected somewhere surprising.
 */

import { useEffect, useRef } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { subspacePath, resolveTopicSegments } from '../lib/nav'
import { useSpaces } from '../features/spaces/SpacesProvider'

/** What the URL named, and which topic that turned out to be. */
type Seen = { spaceSegment: string; subspaceSegment: string; spaceId: string; subspaceId: string }

export function TopicCanonical() {
  const { spaceId: spaceSegment, subspaceId: subspaceSegment } = useParams()
  const { spaces } = useSpaces()
  const { pathname, search, hash } = useLocation()
  const seen = useRef<Seen | null>(null)

  let { space, subspace } = resolveTopicSegments(spaces, spaceSegment, subspaceSegment)

  // A rename. The URL still carries the OLD name, which no longer resolves,
  // but it is exactly what we last resolved to a topic that still exists — so
  // follow that topic to its new name. Matching on the previous URL (not just
  // "the last topic") is what keeps a mistyped address from being quietly
  // redirected to wherever you happened to be before.
  const prev = seen.current
  if ((!space || !subspace) && prev && prev.spaceSegment === spaceSegment && prev.subspaceSegment === subspaceSegment) {
    const s = spaces.find((x) => x.id === prev.spaceId)
    const sub = s?.subspaces.find((x) => x.id === prev.subspaceId)
    if (s && sub) {
      space = s
      subspace = sub
    }
  }

  const spaceIdNow = space?.id
  const subspaceIdNow = subspace?.id
  useEffect(() => {
    if (spaceIdNow && subspaceIdNow && spaceSegment && subspaceSegment) {
      seen.current = { spaceSegment, subspaceSegment, spaceId: spaceIdNow, subspaceId: subspaceIdNow }
    }
  }, [spaceIdNow, subspaceIdNow, spaceSegment, subspaceSegment])

  if (space && subspace) {
    const canonical = subspacePath(space, subspace)
    const onCanonical = pathname === canonical || pathname.startsWith(`${canonical}/`)
    if (!onCanonical) {
      // The rest of the path after the two topic segments, with or without the
      // old `/s/` prefix in front of them.
      const rest = /^(?:\/s)?\/[^/]+\/[^/]+(\/.*)?$/.exec(pathname)?.[1] ?? ''
      return <Navigate to={`${canonical}${rest}${search}${hash}`} replace />
    }
  }

  return <Outlet />
}
