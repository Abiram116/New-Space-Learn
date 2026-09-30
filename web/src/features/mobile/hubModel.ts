import type { Deck } from '../../api/types'

export type ReviewPlan = {
  /** Cards due across this topic's decks. */
  due: number
  /** How many of this topic's decks have something due. */
  decksDue: number
  /** Where "Review" should open: the one deck with cards due, when there is exactly one. */
  deckId: string | null
}

/** What's due in one topic, from the account-wide deck list. */
export function reviewPlan(decks: Deck[] | null | undefined, subspaceId: string): ReviewPlan {
  const mine = (decks ?? []).filter((d) => d.subspace_id === subspaceId && d.due > 0)
  const due = mine.reduce((n, d) => n + d.due, 0)
  return { due, decksDue: mine.length, deckId: mine.length === 1 ? mine[0].id : null }
}

/** "1 card" / "12 cards". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
