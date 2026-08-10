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

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { generateCards, gradeCard, listCards, listDecks } from '../../../api/flashcards'
import type { Deck, Flashcard, Grade } from '../../../api/types'
import { Icon } from '../../../components/ui/Icon'
import { Skeleton } from '../../../components/ui/Skeleton'
import { useToast } from '../../../components/ui/Toast'
import { Rise, Stagger } from '../../../components/ui/motion'
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
  const decks = useAsync(() => listDecks(subspaceId), [subspaceId])
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
    <Rise distance={6} className="flex min-h-0 flex-1 flex-col gap-3">
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
        ) : list.length === 0 ? (
          <p className="text-[12px] text-muted">No decks yet.</p>
        ) : (
          <Stagger step={18} max={140}>
            {list.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 rounded-[10px] border border-line bg-raised px-2.5 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{d.name}</span>
                {d.due > 0 ? (
                  <button
                    type="button"
                    onClick={() => setReviewing(d)}
                    className="shrink-0 rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold text-[#1a120f] transition-all cursor-pointer hover:brightness-110 active:scale-95"
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
    </Rise>
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
      .catch((err) => showError(err))
  }, [deck.id, showError])

  const card = cards?.[index] ?? null

  const grade = useCallback(
    async (g: Grade) => {
      if (!card) return
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
      <Rise distance={5} className="flex min-h-0 flex-1 flex-col justify-center gap-3">
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
      </Rise>
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

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-raised px-3 py-3">
        <span className="setcode">{flipped ? 'Answer' : 'Question'}</span>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink">
          {flipped ? card.back : card.front}
        </p>
        {flipped && card.source && (
          <span className="setcode mt-2 block truncate">{card.source}</span>
        )}
      </div>

      {!flipped ? (
        <button
          type="button"
          onClick={() => setFlipped(true)}
          className="rounded-[10px] bg-brand px-3 py-2 text-[12.5px] font-bold text-[#1a120f] transition-all cursor-pointer hover:brightness-110 active:scale-[0.98]"
        >
          Show answer
        </button>
      ) : (
        // Four figures on a rule, per the design track — grading is one
        // ordered scale, not four categories, and the intervals say so in
        // real numbers.
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
      )}
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
        'text-[12.5px] font-semibold transition-all duration-200 cursor-pointer',
        busy
          ? 'cursor-default bg-line-soft text-muted'
          : 'bg-brand text-[#1a120f] hover:brightness-110 active:scale-[0.98]',
      )}
    >
      <Icon name="sparkle" size={12} />
      {busy ? 'Writing cards…' : 'Make cards from this chat'}
    </button>
  )
}
