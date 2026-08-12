/**
 * Whether a subject in the rail is showing its topics.
 *
 * Pulled out of the component because the bug it encodes against was not a
 * rendering mistake — it was two functions disagreeing about a default.
 *
 * The collapse map only stores subjects the student has *touched*. Everything
 * else falls back to a rule, and that rule is not "open": an untouched subject
 * with topics starts closed, so the rail is a list of subjects rather than a
 * wall of every topic at once. The toggle, however, was written as
 * `!(prev[id] ?? false)` — "absent means not collapsed", i.e. open.
 *
 * So the first click on an untouched subject wrote `collapsed = true`, which is
 * what it already effectively was. Nothing moved. Only the second click opened
 * it. The rail needing two clicks was that single disagreement, and the fix is
 * that both the reader and the writer now call this.
 */

export type CollapseMap = Record<string, boolean>

/** Only what the decision needs — keeps this testable without the API types. */
export type TreeSpace = { id: string; subspaces: readonly unknown[] }

export function isOpenIn(
  map: CollapseMap,
  id: string,
  spaces: readonly TreeSpace[],
  activeSpaceId: string | null | undefined,
): boolean {
  const explicit = map[id]
  if (explicit !== undefined) return !explicit
  const space = spaces.find((s) => s.id === id)
  // Defaults open when there's nothing to collapse — an empty subject's only
  // useful state is "show me how to add a topic", not a closed row that gives
  // no hint anything is missing. The subject you are inside is open too.
  return id === activeSpaceId || space?.subspaces.length === 0
}

/**
 * The next collapse map after clicking a subject.
 *
 * Written in terms of `isOpenIn` so it inverts what is actually on screen
 * rather than what a default was assumed to be.
 */
export function toggleIn(
  map: CollapseMap,
  id: string,
  spaces: readonly TreeSpace[],
  activeSpaceId: string | null | undefined,
): CollapseMap {
  return { ...map, [id]: isOpenIn(map, id, spaces, activeSpaceId) }
}
