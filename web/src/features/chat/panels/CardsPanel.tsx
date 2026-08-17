/**
 * Cards, in the dock — including the review loop itself.
 *
 * The previous version listed decks and linked out to the full page, on the
 * reasoning that "a 320px column cannot host the flashcard review loop". That
 * was wrong about what the loop needs. A review is one question, one answer and
 * four grades — it is the *narrowest* thing in the app, not the widest, and
 * sending someone to another route to do it cost them the conversation that
 * prompted the review in the first place.
 *
 * What the full page still has that this doesn't: authoring cards, deck
 * management, the session summary. Those genuinely want room.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { generateCards, gradeCard, listCards, listDecks } from '../../../api/flashcards'
import type { Deck, Flashcard, Grade } from '../../../api/types'
import { Icon } from '../../../components/ui/Icon'
import { CardFace } from '../../flashcards/Review'
import { Skeleton } from '../../../components/ui/Skeleton'
import { useToast } from '../../../components/ui/Toast'
import { Stagger } from '../../../components/ui/motion'
import { clearStatsCache } from '../../../lib/briefCache'
import { cn } from '../../../lib/cn'
import { nextIntervalLabel } from '../../../lib/schedule'
import { useAssessmentLock } from '../../../lib/assessment'
import { useAsync } from '../../../lib/useAsync'

/** The grade ramp, cold → hot. Mirrors `flashcards/model.ts`. */
const GRADES: { key: Grade; label: string }[] = [
  { key: 'again', label: 'Again' },
  { key: 'hard', label: 'Hard' },
  { key: 'good', label: 'Good' },
  { key: 'easy', label: 'Easy' },
]

export function CardsPanel({ subspaceId, base }: { subspaceId: string; base: string }) {
  const decks = useAsync(() => listDecks(subspaceId), [subspaceId], `decks:${subspaceId}`)
  const [reviewing, setReviewing] = useState<Deck | null>(null)
  const list = decks.data ?? []
  const due = list.reduce((n, d) => n + d.due, 0)

  if (reviewing) {
    return (
      <ReviewLoop
        deck={reviewing}
        onExit={() => {
          setReviewing(null)
          void decks.refresh()
        }}
      />
    )
  }

  return (
    // See QuizzesPanel: `flex-1` rather than `min-h-full`, so filling the dock
    // doesn't depend on a percentage resolving through a scroll container.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {due > 0 && (
        <div className="flex items-baseline gap-2 rounded-[10px] border border-brand/25 bg-brand-tint px-2.5 py-2">
          <span className="nameplate text-[20px] tabular-nums text-brand">{due}</span>
          <span className="text-[12px] text-ink-2">due now</span>
        </div>
      )}

      <MakeCards subspaceId={subspaceId} onMade={decks.refresh} />

      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {decks.loading ? (
          <Skeleton className="h-12 rounded-[10px]" />
        ) : decks.error ? (
          // Same fix as QuizzesPanel's own list — a failed fetch used to
          // read as "you've never made a deck here".
          <p className="text-[12px] text-coral-deep">{decks.error}</p>
        ) : list.length === 0 ? (
          <p className="text-[12px] text-muted">No decks yet.</p>
        ) : (
          <Stagger step={18} max={140}>
            {list.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 rounded-[10px] border border-line bg-raised px-2.5 py-2"
              >
                <span className="min-w-0 flex-1 leading-snug text-[12.5px] text-ink-3">{d.name}</span>
                {d.due > 0 ? (
                  <button
                    type="button"
                    onClick={() => setReviewing(d)}
                    className="shrink-0 rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold text-[#1a120f] t-control duration-200 cursor-pointer hover:brightness-110 active:scale-95"
                  >
                    Review {d.due}
                  </button>
                ) : (
                  <span className="setcode shrink-0">done</span>
                )}
              </div>
            ))}
          </Stagger>
        )}
      </div>

      <Link
        to={`${base}/flashcards`}
        className="mt-auto flex items-center justify-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-[12px] text-muted transition-colors hover:border-brand/40 hover:text-brand-deep"
      >
        Manage decks <Icon name="arrowRight" size={12} />
      </Link>
    </div>
  )
}

/* ── The loop ─────────────────────────────────────────────────────────── */

function ReviewLoop({ deck, onExit }: { deck: Deck; onExit: () => void }) {
  // Same lock as the quiz: with the tutor one panel away, a card you look up
  // is a card you haven't recalled, and the whole schedule is built on the
  // grade meaning what it says.
  useAssessmentLock('review')

  const [cards, setCards] = useState<Flashcard[] | null>(null)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(0)
  const { showError } = useToast()

  useEffect(() => {
    listCards(deck.id, { dueOnly: true })
      .then(setCards)
      .catch((err) => {
        showError(err)
        // Without this, a failed fetch leaves `cards` at its initial `null`
        // forever — `!cards` below never becomes false, so the panel is
        // stuck on the loading skeleton for the rest of the session with no
        // escape but the outer dock chrome (not an obvious way out of what
        // looks like a stuck spinner). Falling to `[]` reaches the deck's
        // own "nothing due" state instead, which at least has a way out —
        // the toast above already said what actually went wrong.
        setCards([])
      })
  }, [deck.id, showError])

  const card = cards?.[index] ?? null
  // Blocks a second `grade()` for the same card — see the identical guard
  // and its full reasoning on `Review.tsx`'s own `gradedRef`. Same bug,
  // same fix, independently implemented here since this is a second,
  // separate review UI (the chat dock), not a shared component.
  const gradedRef = useRef<string | null>(null)

  const grade = useCallback(
    async (g: Grade) => {
      if (!card || gradedRef.current === card.id) return
      gradedRef.current = card.id
      // Optimistic: advance immediately and PATCH behind it. SM-2 runs
      // identically on the server, so the only cost is briefly stale interval
      // maths — and waiting on a round trip between cards is what makes a
      // review session feel like paperwork.
      setFlipped(false)
      setIndex((i) => i + 1)
      setDone((n) => n + 1)
      clearStatsCache()
      try {
        await gradeCard(card.id, g)
      } catch (err) {
        showError(err)
      }
    },
    [card, showError],
  )

  if (!cards) return <Skeleton className="min-h-0 flex-1 rounded-xl" />

  if (!card) {
    return (
      // Centred, not top-aligned. This state is two short elements; stretched
      // to the dock height and pinned to the top they sat under a column of
      // nothing. A finished state is the one place centring is right — there
      // is no next thing below it to stay close to.
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-3">
        <div className="rounded-xl border border-mint/35 bg-mint-soft/50 px-3 py-3 text-center">
          <Icon name="check" size={18} className="text-mint-deep" />
          <div className="mt-1 text-[13px] font-bold text-mint-deep">
            {done > 0 ? `${done} reviewed` : 'Nothing due'}
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-2">
            {done > 0 ? 'Back to it — the chat is unlocked.' : 'This deck is clear for now.'}
          </div>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="rounded-[10px] border border-line px-3 py-2 text-[12px] text-muted transition-colors cursor-pointer hover:border-brand/40 hover:text-brand-deep"
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] text-muted transition-colors cursor-pointer hover:text-ink"
        >
          <Icon name="arrowLeft" size={12} /> Leave
        </button>
        <span className="setcode ml-auto">{cards.length - index} left</span>
      </div>

      {/* The real card, and the real flip.
          This was a full-height bordered box with the text at the top — a
          panel, not a card, stretched down the whole column with nothing in
          the bottom two thirds of it. A flashcard is an *object you hold*, and
          the app already has one: `CardFace` plus a genuine `rotateY` on a
          preserved-3d parent. Reusing it means the dock and the full page flip
          the same way instead of the dock quietly being the neglected copy.
          Fixed height and centred, so it reads as a card sitting on the table
          rather than as the column's wallpaper.

          The card and the grade row are centred TOGETHER as one group, not
          separately — the card alone centred in a flex-1 area pushes the
          buttons all the way to the panel's bottom edge, leaving a dead gap
          between the answer and the grades on any dock taller than the card
          itself. Grouping them keeps the grades right under the card, with
          the leftover space split evenly above and below instead. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <div className="w-full [perspective:1400px]" style={{ height: 'min(52vh, 280px)' }}>
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? 'Show question' : 'Show answer'}
            className={cn(
              'relative h-full w-full cursor-pointer text-left',
              '[transform-style:preserve-3d] transition-transform duration-500',
              'motion-reduce:transition-none',
            )}
            style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
          >
            <CardFace side="front" text={card.front} compact hint="Tap to flip" />
            <CardFace side="back" text={card.back} source={card.source} compact />
          </button>
        </div>

        {!flipped ? (
          <button
            type="button"
            onClick={() => setFlipped(true)}
            className="w-full shrink-0 rounded-[10px] bg-brand px-3 py-2 text-[12.5px] font-bold text-[#1a120f] t-control duration-200 cursor-pointer hover:brightness-110 active:scale-[0.98]"
          >
            Show answer
          </button>
        ) : (
          <div className="flex w-full shrink-0 flex-col gap-2">
            {/* Four figures on a rule, per the design track — grading is one
                ordered scale, not four categories, and the intervals say so in
                real numbers. */}
            <div className="grid grid-cols-4 gap-1">
              {GRADES.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => grade(g.key)}
                  className={cn(
                    'flex flex-col items-center gap-0.5 rounded-[9px] border border-line px-1 py-1.5',
                    'text-[11px] font-semibold text-ink-2 transition-colors cursor-pointer',
                    'hover:border-brand/50 hover:text-ink',
                  )}
                >
                  {g.label}
                  <span className="setcode text-[9px]">{nextIntervalLabel(card, g.key)}</span>
                </button>
              ))}
            </div>
            {/* On a fresh card, Again/Hard/Good all preview the same "1d" —
                that's real SM-2 math (nothing to compare a first rep against
                yet), not a bug, but it reads as broken without this line. */}
            <p className="px-0.5 text-[10.5px] leading-snug text-faint">
              The number is when you'll see this card again — honest grading is
              what makes it accurate.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Generate ─────────────────────────────────────────────────────────── */

function MakeCards({ subspaceId, onMade }: { subspaceId: string; onMade: () => void }) {
  const [busy, setBusy] = useState(false)
  const { show, showError } = useToast()

  const make = useCallback(async () => {
    setBusy(true)
    try {
      const cards = await generateCards(subspaceId, { count: 8 })
      onMade()
      show(`Wrote ${cards.length} cards.`, 'success')
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }, [subspaceId, onMade, show, showError])

  return (
    <button
      type="button"
      onClick={make}
      disabled={busy}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2',
        'text-[12.5px] font-semibold t-control duration-200 cursor-pointer',
        // Busy stays the same live orange, not a greyed-out "disabled" look —
        // the AI actively writing should read as more alive, not less.
        busy
          ? 'cursor-default bg-brand text-[#1a120f] animate-pulse'
          : 'bg-brand text-[#1a120f] hover:brightness-110 active:scale-[0.98]',
      )}
    >
      <Icon name="sparkle" size={12} />
      {busy ? 'Writing cards…' : 'Make cards from this chat'}
    </button>
  )
}
