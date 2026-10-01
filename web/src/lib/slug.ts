/**
 * Readable URL segments for subjects and topics.
 *
 * Derived in the browser from the names the student already typed — nothing is
 * stored. An earlier attempt kept slugs in the database and broke every insert
 * until the API supplied one (see `lib/nav.ts`), and these URLs only ever work
 * for the signed-in owner, so a stable server-side slug buys very little.
 * Computing them here costs no request, no migration and no new field to keep
 * in step with a rename.
 *
 * Ids still resolve everywhere a slug does (see `resolveTopicSegments` in
 * `lib/nav.ts`), so old bookmarks and server-built routes keep working.
 */

import type { Space, Subspace } from '../api/types'

const MAX_LENGTH = 60

/** Slugs are rebuilt for every item whenever a list changes (every note save, every
 *  rename), almost always from names that have not changed. Remembering the
 *  last few thousand makes that a map lookup instead of a normalise-and-regex. */
const slugCache = new Map<string, string>()
const SLUG_CACHE_LIMIT = 2000

/**
 * First URL segments that already mean something. A topic's address is
 * `/<subject>/<topic>` with no fixed prefix, so a subject whose name slugified
 * to one of these (a subject called "Notes", "Home" or "Settings") would sit
 * next to — and be shadowed by — the page of that name. Such a subject gets an
 * id tail like any other collision. Includes the pages we know are coming.
 */
export const RESERVED_ROOTS: ReadonlySet<string> = new Set([
  'home', 'profile', 'settings', 'notes', 'flashcards', 'quizzes', 'skills',
  'welcome', 'welcome-aboard', 'signin', 'signup', 'auth', 's', 'api', 'assets',
  'about', 'contact', 'terms', 'privacy', 'feedback', 'help', 'sitemap.xml',
  'robots.txt', 'favicon.svg', 'icons.svg',
])

/** `"Markov Decision Processes!"` → `"markov-decision-processes"`. Empty when
 *  the name has no Latin letters or digits (a Telugu or Hindi title, say). */
export function slugify(name: string): string {
  const hit = slugCache.get(name)
  if (hit !== undefined) return hit
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining accents left by NFKD
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, '')
  // Bounded: a note title is retyped as you edit it, so the keys keep changing.
  if (slugCache.size >= SLUG_CACHE_LIMIT) slugCache.clear()
  slugCache.set(name, slug)
  return slug
}

function idTail(id: string, length: number): string {
  return id.replace(/-/g, '').slice(0, length)
}

/**
 * One slug per item, unique within `items`.
 *
 * A name with no usable characters becomes `<fallback>-<id>`. Items that share
 * a slug ALL get an id tail (`notes-a234`), rather than only the later ones:
 * which of two same-named topics is "first" can change when a subject is
 * pinned or reordered, and a URL must not change with that.
 *
 * Exported for things named by a query parameter (a quiz, a note, a deck) —
 * see `useSlugParam`. `nameOf` is read once per item per call. Slugs in
 * `reserved` are treated as taken, so an item that would land on one gets an id
 * tail instead.
 */
export function slugsFor<T extends { id: string }>(
  items: readonly T[],
  nameOf: (item: T) => string | null | undefined,
  fallback: string,
  reserved?: ReadonlySet<string>,
): Map<string, string> {
  const base = new Map<string, string>()
  const count = new Map<string, number>()
  for (const item of items) {
    const slug = slugify(nameOf(item) ?? '') || `${fallback}-${idTail(item.id, 6)}`
    base.set(item.id, slug)
    count.set(slug, (count.get(slug) ?? 0) + 1)
  }

  const out = new Map<string, string>()
  const taken = new Set<string>()
  for (const item of items) {
    const slug = base.get(item.id)!
    const needsTail = (count.get(slug) ?? 0) > 1 || reserved?.has(slug)
    let next = needsTail ? `${slug}-${idTail(item.id, 4)}` : slug
    // A longer tail only if even the suffixed form collides — vanishingly rare,
    // but a duplicate slug would make two items unreachable by name.
    for (let n = 5; taken.has(next); n++) next = `${slug}-${idTail(item.id, n)}`
    taken.add(next)
    out.set(item.id, next)
  }
  return out
}

/** The same list with a `slug` on every subject and, within each, every topic.
 *  Topic slugs only need to be unique inside their subject. */
export function withSlugs(spaces: Space[]): Space[] {
  const spaceSlugs = slugsFor(spaces, (s) => s.name, 'subject', RESERVED_ROOTS)
  return spaces.map((space) => {
    const topicSlugs = slugsFor(space.subspaces, (s) => s.name, 'topic')
    return {
      ...space,
      slug: spaceSlugs.get(space.id),
      subspaces: space.subspaces.map(
        (sub): Subspace => ({ ...sub, slug: topicSlugs.get(sub.id) }),
      ),
    }
  })
}
