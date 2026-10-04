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
import { DockAction, DockEmpty, DockLink, DockSectionHead } from '../dockParts'

export function CardsPanel({ subspaceId, base }: { subspaceId: string; base: string }) {
  const navigate = useNavigate()
  const decks = useAsync(() => listDecks(subspaceId), [subspaceId], `decks:${subspaceId}`)
  const list = decks.data ?? []
  const due = list.reduce((n, d) => n + d.due, 0)

  return (
    // See QuizzesPanel: `flex-1` rather than `min-h-full`, so filling the dock
    // doesn't depend on a percentage resolving through a scroll container.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {due > 0 && (
        <div className="flex items-baseline gap-2 rounded-[10px] border border-line bg-raised px-2.5 py-2">
          <span className="nameplate text-[20px] tabular-nums text-ink">{due}</span>
          <span className="text-[12px] text-ink-2">due now</span>
        </div>
      )}

      <DockSectionHead id="cards-panel-label">{list.length > 0 ? `Flashcards · ${list.length}` : 'Flashcards'}</DockSectionHead>

      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {decks.loading ? (
          <Skeleton className="h-12 rounded-[10px]" />
        ) : decks.error ? (
          // Same fix as QuizzesPanel's own list — a failed fetch used to
          // read as "you've never made a deck here".
          <p className="text-[12px] text-coral-deep">{decks.error}</p>
        ) : list.length === 0 ? (
          <DockEmpty icon="deck" title="No flashcards yet">
            Make some from your files and they show up here.
          </DockEmpty>
        ) : (
          <Stagger step={18} max={140}>
            {list.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 rounded-[10px] border border-line bg-raised px-2.5 py-2"
              >
                <button
                  type="button"
                  onClick={() => navigate(deckHref(base, d.id))}
                  className="min-w-0 flex-1 cursor-pointer truncate text-left text-[12.5px] leading-snug text-ink-3 transition-colors hover:text-ink"
                  title="Open this deck"
                >
                  {d.name}
                </button>
                {d.due > 0 ? (
                  <button
                    type="button"
                    onClick={() => navigate(reviewDeckHref(base, d.id))}
                    className="shrink-0 cursor-pointer rounded-full border border-ink-3/60 px-2.5 py-1 text-[11px] font-bold text-ink t-control duration-200 hover:border-ink hover:bg-line-soft"
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

      <DockLink to={`${base}/flashcards`}>Open all flashcards</DockLink>
      <MakeCards subspaceId={subspaceId} onMade={decks.refresh} />
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
