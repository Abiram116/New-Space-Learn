/**
 * What the session came to — four tallies on one rule, then where to go next.
 *
 * LEDGER, not a card: a session result is something you are measured against,
 * not something you own. `foil` is deliberately absent for the same reason —
 * per the design track's rules, foil is for collectibles and never for a
 * measurement.
 */

import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { Deck, Grade } from '../../api/types'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Ledger } from '../../components/ui/Surface'
import { AmbienceField, celebrate, useAmbienceField } from '../../components/celebrate'
import { cn } from '../../lib/cn'
import { useIsMobile } from '../../lib/useIsMobile'
import { StickyActionBar } from '../../components/ui/StickyActionBar'
import { GRADES } from './model'

/** Sessions already celebrated, by identity — a remount mustn't replay it. */
const celebrated = new WeakSet<Grade[]>()

export function Summary({
  grades,
  deckName,
  onDone,
  nextDeck,
  onReviewNext,
  quizHref,
  keepGoing,
}: {
  grades: Grade[]
  deckName: string
  onDone: () => void
  nextDeck: Deck | null
  onReviewNext: (deckId: string) => void
  quizHref: string
  /** A capped session left due cards behind: offer the next batch, not the lot. */
  keepGoing?: { count: number; onGo: () => void } | null
}) {
  const tally = useMemo(() => {
    const counts: Record<Grade, number> = { again: 0, hard: 0, good: 0, easy: 0 }
    for (const g of grades) counts[g] += 1
    return counts
  }, [grades])
  const isMobile = useIsMobile()
  const solid = tally.good + tally.easy
  const pct = grades.length ? Math.round((solid / grades.length) * 100) : 0

  // The deck is clear — that's the moment, whatever the percentage. Every
  // card's LAST grade cleared Again, so the cards themselves are the grades
  // that weren't an Again.
  const pctRef = useRef<HTMLDivElement>(null)
  const ambience = useAmbienceField()
  useEffect(() => {
    if (celebrated.has(grades)) return // StrictMode's second mount
    celebrated.add(grades)
    ambience.api.progress(1)
    ambience.api.pulse('bright')
    const cards = grades.length - tally.again
    if (cards > 0) celebrate('deck', { anchor: pctRef, facts: { count: cards, deck: deckName } })
  }, [grades, tally.again, deckName, ambience.api])

  const actions = (
    <>
      <Button variant="secondary" onClick={onDone} className={isMobile ? 'min-h-14 flex-1' : 'flex-1'}>
        Done
      </Button>
      {keepGoing ? (
        <Button onClick={keepGoing.onGo} className={cn('min-w-0 flex-1', isMobile && 'min-h-14 flex-[1.6]')}>
          <span className="truncate">Keep going: {keepGoing.count} more</span>
        </Button>
      ) : nextDeck ? (
        <Button onClick={() => onReviewNext(nextDeck.id)} className={cn('min-w-0 flex-1', isMobile && 'min-h-14 flex-[1.6]')}>
          <span className="truncate">
            Review {nextDeck.due} more in {nextDeck.name}
          </span>
        </Button>
      ) : (
        <Link to={quizHref} className={cn('min-w-0 flex-1', isMobile && 'flex-[1.6]')}>
          <Button className={cn('w-full', isMobile && 'min-h-14')}>Take a quiz on this</Button>
        </Link>
      )}
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!isMobile && <SubspaceHeader title="Session complete" />}
      <div
        className={cn(
          'relative isolate flex min-h-0 flex-1 items-center justify-center overflow-y-auto',
          isMobile ? 'p-4' : 'p-6',
        )}
      >
        <AmbienceField field={ambience} compact={isMobile} />
        {/* LEDGER — the session verdict, not a trophy. `foil` in particular
            had to go: foil is this system's cue for a collectible, and putting
            it on a score turned "you got 60%" into something that looked like
            a reward for getting 60%. The card faces you just reviewed stay
            Cards, because those genuinely are objects you own. */}
        <Ledger className="flex w-full max-w-md flex-col gap-5 p-7 pt-4 text-center max-sm:p-5 max-sm:pt-3">
          <div ref={pctRef}>
            <div className="nameplate text-[64px] leading-none text-brand tabular-nums">{pct}%</div>
            <p className={cn('mt-1', isMobile ? 'text-[13px] text-muted' : 'setcode')}>solid on {deckName}</p>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {GRADES.map((g) => (
              <div key={g.key} className="flex flex-col gap-0.5 rounded-[10px] bg-well py-2">
                <span className={cn('nameplate text-[22px] tabular-nums', g.text)}>
                  {tally[g.key]}
                </span>
                <span className={isMobile ? 'text-[12.5px] text-muted' : 'setcode'}>{g.label}</span>
              </div>
            ))}
          </div>

          <p className={cn('leading-relaxed text-muted', isMobile ? 'text-[15px]' : 'text-[13px]')}>
            {tally.again > 0
              ? `${tally.again} card${tally.again === 1 ? '' : 's'} came back short — those return sooner.`
              : 'Nothing missed. The whole deck moves further out.'}
          </p>

          {!isMobile && <div className="flex gap-2">{actions}</div>}
        </Ledger>
      </div>
      {isMobile && <StickyActionBar>{actions}</StickyActionBar>}
    </div>
  )
}
