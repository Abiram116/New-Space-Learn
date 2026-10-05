/**
 * The topic hub — what `/s/:space/:sub` is on a phone.
 *
 * On desktop that URL is the topic's chat. Phones don't have chat, so the
 * same address opens a small launchpad for revising the topic instead: what's
 * due first (the one thing worth doing right now), then the topic's cards,
 * quizzes, notes and sources, then a way to add more material.
 *
 * Reads only what the app already has: counts come with the subject list
 * (SpacesProvider), and "due" comes from the account-wide deck list the Cards
 * screen shares under the same cache key — opening Cards after this is instant.
 */

import { Link } from 'react-router-dom'
import { listAllDecks } from '../../api/flashcards'
import type { Space, Subspace } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { toneDot } from '../../lib/tone'
import { useAsync } from '../../lib/useAsync'
import { SubspaceMissing } from '../spaces/SubspaceMissing'
import { plural, reviewPlan, type ReviewPlan } from './hubModel'
import { MobileRow, RowGroup } from './MobileRow'

export function TopicHub() {
  const { space, subspace, base } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return <Hub key={subspace.id} space={space} subspace={subspace} base={base} />
}

function Hub({ space, subspace, base }: { space: Space; subspace: Subspace; base: string }) {
  const decks = useAsync(() => listAllDecks(), [], 'decks:all')
  const plan = reviewPlan(decks.data, subspace.id)
  const counts = subspace.counts ?? {}

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-xl flex-col px-4 pb-10 pt-6">
        <header className="px-1">
          <p className="flex min-w-0 items-center gap-2">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', toneDot[space.tone])} aria-hidden />
            <span className="setcode-strong truncate">{space.name}</span>
          </p>
          <h2 className="nameplate mt-3 text-[clamp(22px,7.4vw,32px)] leading-[0.95] text-ink [hyphens:none] [overflow-wrap:normal] [text-wrap:balance]">
            {subspace.name}
          </h2>
        </header>

        <div className="mt-6">
          <ReviewCard
            base={base}
            plan={plan}
            loading={decks.loading && !decks.data}
            failed={Boolean(decks.error) && !decks.data}
            onRetry={decks.refresh}
            cards={counts.cards ?? 0}
            quizzes={counts.quizzes ?? 0}
            docs={counts.docs ?? 0}
          />
        </div>

        <h3 className="setcode-strong mt-8 px-1 pb-2.5">In this topic</h3>
        <RowGroup label={`${subspace.name} sections`}>
          <MobileRow
            to={`${base}/flashcards`}
            icon="deck"
            role="recall"
            label="Cards"
            detail={plan.due > 0 ? `${plan.due} due now` : undefined}
            count={counts.cards ?? 0}
          />
          <MobileRow to={`${base}/quizzes`} icon="quiz" role="test" label="Quizzes" count={counts.quizzes ?? 0} />
          <MobileRow to={`${base}/notes`} icon="note" role="read" label="Notes" count={counts.notes ?? 0} />
          <MobileRow to={`${base}/docs`} icon="doc" role="source" label="Files" count={counts.docs ?? 0} />
        </RowGroup>

        <Link
          to={`${base}/docs`}
          className="t-control mt-3 flex min-h-[64px] items-center gap-3.5 rounded-2xl border border-dashed border-line-dash px-4 py-3 active:bg-line-soft"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-line bg-raised text-sky" aria-hidden>
            <Icon name="upload" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold text-ink">Add a file</span>
            <span className="mt-0.5 block text-[13px] text-faint">A PDF, slides or text to study from</span>
          </span>
          <Icon name="chevronRight" size={17} className="shrink-0 text-faint" />
        </Link>
      </div>
    </div>
  )
}

/**
 * The one thing to do here right now. Due cards win; with nothing due it
 * says so plainly and offers the next useful thing rather than a dead end.
 */
function ReviewCard({
  base,
  plan,
  loading,
  failed,
  onRetry,
  cards,
  quizzes,
  docs,
}: {
  base: string
  plan: ReviewPlan
  loading: boolean
  failed: boolean
  onRetry: () => void
  cards: number
  quizzes: number
  docs: number
}) {
  if (loading) {
    return (
      <div className="cardstock rounded-2xl p-4" aria-busy="true" aria-label="Checking what's due">
        <div className="flex items-center gap-3.5">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <Skeleton className="mt-4 h-12 rounded-[13px]" />
      </div>
    )
  }

  if (failed) {
    return (
      <div className="cardstock rounded-2xl p-4">
        <p className="text-[16px] font-semibold text-ink">We couldn't check what's due</p>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">Your cards are fine. The list just didn't load.</p>
        <Button variant="secondary" className="mt-3 w-full" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }

  if (plan.due > 0) {
    const to = `${base}/flashcards${plan.deckId ? `?deck=${encodeURIComponent(plan.deckId)}` : ''}`
    return (
      <Link to={to} className="cardstock group block rounded-2xl p-4 active:translate-y-px" data-testid="review-due">
        <div className="flex items-center gap-3.5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-sun-soft text-sun" aria-hidden>
            <Icon name="deck" size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="nameplate text-[21px] leading-[1.02] text-ink">
              Review {plan.due} due {plan.due === 1 ? 'card' : 'cards'}
            </p>
            <p className="mt-1.5 text-[14px] text-muted">
              {plan.decksDue === 1 ? 'All in one deck' : `Across ${plan.decksDue} decks`}
            </p>
          </div>
        </div>
        <span className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-[13px] bg-brand text-[16px] font-bold text-[#1a120f] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_2px_0_#a8331d] group-active:translate-y-[2px] group-active:shadow-none">
          Start review <Icon name="arrowRight" size={18} strokeWidth={2.2} />
        </span>
      </Link>
    )
  }

  // Nothing due. Say which "nothing" it is, and hand over the next move.
  const next =
    cards > 0
      ? quizzes > 0
        ? { title: "You're caught up", body: `Nothing due in ${plural(cards, 'card')}. They'll come back when it's time.`, to: `${base}/quizzes`, cta: 'Try a quiz instead' }
        : { title: "You're caught up", body: `Nothing due in ${plural(cards, 'card')}. They'll come back when it's time.`, to: `${base}/flashcards`, cta: 'Browse your cards' }
      : docs > 0
        ? { title: 'No cards yet', body: 'Make a deck from your files. Cards will show up here when they are due.', to: `${base}/flashcards`, cta: 'Make cards' }
        : { title: 'Nothing to revise yet', body: "Add a PDF, slides or text first. We'll make cards and quizzes from it.", to: `${base}/docs`, cta: 'Add a file' }

  return (
    <div className="cardstock rounded-2xl p-4">
      <div className="flex items-center gap-3.5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-line bg-well text-jade" aria-hidden>
          <Icon name={cards > 0 ? 'check' : 'deck'} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="nameplate text-[21px] leading-[1.02] text-ink">{next.title}</p>
          <p className="mt-1.5 text-[14px] leading-snug text-muted">{next.body}</p>
        </div>
      </div>
      <Link
        to={next.to}
        className="t-control mt-4 flex min-h-12 items-center justify-center gap-2 rounded-[13px] border border-line bg-raised text-[16px] font-bold text-ink active:translate-y-px active:bg-surface"
      >
        {next.cta} <Icon name="arrowRight" size={18} />
      </Link>
    </div>
  )
}
