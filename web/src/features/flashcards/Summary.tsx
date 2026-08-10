/**
 * What the session came to — four tallies on one rule, then where to go next.
 *
 * LEDGER, not a card: a session result is something you are measured against,
 * not something you own. `foil` is deliberately absent for the same reason —
 * per the design track's rules, foil is for collectibles and never for a
 * measurement.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Deck, Grade } from '../../api/types'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Ledger } from '../../components/ui/Surface'
import { cn } from '../../lib/cn'
import { GRADES } from './model'

export function Summary({
  grades,
  deckName,
  onDone,
  nextDeck,
  onReviewNext,
  quizHref,
}: {
  grades: Grade[]
  deckName: string
  onDone: () => void
  nextDeck: Deck | null
  onReviewNext: (deckId: string) => void
  quizHref: string
}) {
  const tally = useMemo(() => {
    const counts: Record<Grade, number> = { again: 0, hard: 0, good: 0, easy: 0 }
    for (const g of grades) counts[g] += 1
    return counts
  }, [grades])
  const solid = tally.good + tally.easy
  const pct = grades.length ? Math.round((solid / grades.length) * 100) : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader title="Session complete" />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        {/* LEDGER — the session verdict, not a trophy. `foil` in particular
            had to go: foil is this system's cue for a collectible, and putting
            it on a score turned "you got 60%" into something that looked like
            a reward for getting 60%. The card faces you just reviewed stay
            Cards, because those genuinely are objects you own. */}
        <Ledger className="flex w-full max-w-md flex-col gap-5 p-7 pt-4 text-center">
          <div>
            <div className="nameplate text-[64px] leading-none text-brand tabular-nums">{pct}%</div>
            <p className="setcode mt-1">solid on {deckName}</p>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {GRADES.map((g) => (
              <div key={g.key} className="flex flex-col gap-0.5 rounded-[10px] bg-well py-2">
                <span className={cn('nameplate text-[22px] tabular-nums', g.text)}>
                  {tally[g.key]}
                </span>
                <span className="setcode">{g.label}</span>
              </div>
            ))}
          </div>

          <p className="text-[13px] leading-relaxed text-muted">
            {tally.again > 0
              ? `${tally.again} card${tally.again === 1 ? '' : 's'} came back short — those return sooner.`
              : 'Nothing missed. The whole deck moves further out.'}
          </p>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onDone} className="flex-1">
              Done
            </Button>
            {nextDeck ? (
              <Button onClick={() => onReviewNext(nextDeck.id)} className="min-w-0 flex-1">
                <span className="truncate">
                  Review {nextDeck.due} more in {nextDeck.name}
                </span>
              </Button>
            ) : (
              <Link to={quizHref} className="min-w-0 flex-1">
                <Button className="w-full">Take a quiz on this</Button>
              </Link>
            )}
          </div>
        </Ledger>
      </div>
    </div>
  )
}
