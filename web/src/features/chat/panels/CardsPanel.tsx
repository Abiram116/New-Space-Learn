/**
 * Cards, in the sidebar: your decks, what is due, and the way to review.
 *
 * Reviewing opens as a full page, not inside this narrow column: a card is the
 * thing you are there to look at, and a review is a sitting, not a glance. The
 * page's Back button returns here, to this panel (see `lib/fromChat`). Authoring
 * cards and managing decks are on that page too.
 */

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateCards, listDecks } from '../../../api/flashcards'
import { Skeleton } from '../../../components/ui/Skeleton'
import { useToast } from '../../../components/ui/Toast'
import { Stagger } from '../../../components/ui/motion'
import { deckHref, reviewDeckHref } from '../../../lib/fromChat'
import { useAsync } from '../../../lib/useAsync'
import { Icon } from '../../../components/ui/Icon'
import { cn } from '../../../lib/cn'
import { DockAction, DockEmpty, DockFooter, DockLink, DockMeter, DockSectionHead } from '../dockParts'

export function CardsPanel({ subspaceId, base }: { subspaceId: string; base: string }) {
  const navigate = useNavigate()
  const decks = useAsync(() => listDecks(subspaceId), [subspaceId], `decks:${subspaceId}`)
  const list = decks.data ?? []
  const due = list.reduce((n, d) => n + d.due, 0)

  const cards = list.reduce((n, d) => n + d.total, 0)
  const summary =
    list.length === 0
      ? undefined
      : `${cards === 1 ? '1 card' : `${cards} cards`} · ${due > 0 ? `${due} due now` : 'all caught up'}`

  return (
    // Sized by its content (see QuizzesPanel): the main button follows the list.
    <div className="flex flex-col gap-3">
      <DockSectionHead id="cards-panel-label" hint={summary}>
        {list.length > 0 ? `Flashcards · ${list.length}` : 'Flashcards'}
      </DockSectionHead>

      <div className="flex flex-col gap-2">
        {decks.loading ? (
          <Skeleton className="h-[4.5rem] rounded-[12px]" />
        ) : decks.error ? (
          // Same fix as QuizzesPanel's own list — a failed fetch used to
          // read as "you've never made a deck here".
          <p className="text-[13.5px] text-coral-deep">{decks.error}</p>
        ) : list.length === 0 ? (
          <DockEmpty icon="deck" title="No flashcards yet">
            Make some from your files and they show up here.
          </DockEmpty>
        ) : (
          <Stagger step={18} max={140}>
            {list.map((d) => {
              const known = Math.round(d.known_pct ?? 0)
              return (
                <div
                  key={d.id}
                  className={cn(
                    'flex items-center gap-3 rounded-[12px] border bg-raised px-3 py-3',
                    d.due > 0 ? 'border-sun/30' : 'border-line',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => navigate(deckHref(base, d.id))}
                    className="group flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                    title="Open this deck"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-sun-soft text-sun-deep">
                      <Icon name="deck" size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold leading-snug text-ink transition-colors group-hover:text-sun-deep">
                        {d.name}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-muted">
                        {d.total === 1 ? '1 card' : `${d.total} cards`} · {known}% known
                      </span>
                      <span className="mt-1.5 block">
                        <DockMeter value={known} tone={known >= 80 ? 'mint' : 'sun'} />
                      </span>
                    </span>
                  </button>
                  {d.due > 0 ? (
                    <button
                      type="button"
                      onClick={() => navigate(reviewDeckHref(base, d.id))}
                      className="inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-full bg-sun-soft px-3.5 text-[13px] font-bold text-sun-deep t-control duration-200 hover:brightness-125"
                    >
                      Review {d.due}
                    </button>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-mint-deep">
                      <Icon name="check" size={14} /> Done
                    </span>
                  )}
                </div>
              )
            })}
          </Stagger>
        )}
      </div>

      <DockFooter>
        <DockLink to={`${base}/flashcards`}>Open all flashcards</DockLink>
        <MakeCards subspaceId={subspaceId} onMade={decks.refresh} />
      </DockFooter>
    </div>
  )
}

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
    <DockAction busy={busy} busyLabel="Writing cards…" onClick={make}>
      Make flashcards
    </DockAction>
  )
}
