/**
 * The deck library on a phone: rows, not tiles.
 *
 * Edge-to-edge ~64px rows you can hit with a thumb, one primary action pinned
 * at the bottom ("Review 12 due"), and everything else — open, rename-style
 * housekeeping, delete — behind each row's ⋯ sheet. Nothing here depends on
 * hover.
 */

import { useNavigate } from 'react-router-dom'
import type { Deck, Tone } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { SlowBot } from '../../components/mascot/SlowBot'
import { cn } from '../../lib/cn'
import { toneBar } from '../../lib/tone'
import { StickyActionBar } from '../../components/ui/StickyActionBar'
import { ActionSheet, ChipRow, ListRow, PhoneTitle, useRowSheet } from '../quizzes/phoneKit'

export function PhoneDecks({
  decks,
  loading,
  error,
  onRetry,
  subjects,
  subjectFilter,
  onSubjectFilter,
  toneOf,
  totalDue,
  subspaceName,
  addMaterialHref,
  onOpen,
  onReview,
  onDelete,
  onNew,
  onGenerate,
}: {
  decks: Deck[]
  loading: boolean
  error: string | null
  onRetry: () => void
  subjects: { id: string; name: string }[]
  subjectFilter: string
  onSubjectFilter: (id: string) => void
  toneOf: (deck: Deck) => Tone | undefined
  totalDue: number
  subspaceName: string
  /** Set when the topic has no sources yet: where "Add material" goes. */
  addMaterialHref: string | null
  onOpen: (id: string) => void
  onReview: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
  onGenerate: () => void
}) {
  const navigate = useNavigate()
  const sheet = useRowSheet<Deck>()
  const firstDue = decks.find((d) => d.due > 0)
  const manyDue = decks.filter((d) => d.due > 0).length > 1
  const empty = !loading && !error && decks.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PhoneTitle
          title="Cards"
          hideTitle
          sub={
            totalDue > 0
              ? `${totalDue} card${totalDue === 1 ? '' : 's'} ready across your decks`
              : decks.length > 0
                ? 'Nothing due right now'
                : undefined
          }
        />

        {subjects.length > 1 && (
          <ChipRow
            label="Filter by subject"
            value={subjectFilter}
            onChange={onSubjectFilter}
            options={[
              { value: 'all', label: 'All' },
              ...subjects.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        )}

        {loading && (
          <div className="flex flex-col gap-px" aria-busy>
            <SlowBot pending agent="cards" className="px-4 pb-3" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-none" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="mx-4 flex flex-col items-start gap-2 rounded-xl bg-coral-soft px-4 py-3 text-[15px] text-coral-deep">
            <p>{error}</p>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}

        {empty && (
          <div className="px-4 py-4">
            <EmptyState
              icon="deck"
              title="No decks yet"
              bot={{ agent: 'cards', say: 'emptyCards', surface: 'phone' }}
              description={
                addMaterialHref
                  ? `${subspaceName} has no material yet. Add some and I'll draft cards from it, or write your own.`
                  : `Write cards yourself, or have them drafted from what you've indexed under ${subspaceName}.`
              }
              action={
                <div className="flex w-full flex-col gap-2">
                  {addMaterialHref ? (
                    <>
                      <Button size="xl" onClick={() => navigate(addMaterialHref)}>
                        <Icon name="plus" size={16} /> Add material
                      </Button>
                      <Button size="lg" variant="secondary" onClick={onNew}>
                        Start a deck
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="xl" onClick={onGenerate}>
                        <Icon name="sparkle" size={16} /> Generate a deck
                      </Button>
                      <Button size="lg" variant="secondary" onClick={onNew}>
                        Start a deck
                      </Button>
                    </>
                  )}
                </div>
              }
            />
          </div>
        )}

        {!loading && decks.length > 0 && (
          <>
            <div className="flex gap-2 px-4 pb-3">
              <Button size="md" variant="secondary" onClick={onNew} className="flex-1">
                <Icon name="plus" size={15} /> New deck
              </Button>
              <Button size="md" variant="secondary" onClick={onGenerate} className="flex-1">
                <Icon name="sparkle" size={15} /> Generate
              </Button>
            </div>
            <ul className="border-t border-line-soft">
              {decks.map((deck) => {
                const due = deck.due > 0
                return (
                  <ListRow
                    key={deck.id}
                    onOpen={() => onOpen(deck.id)}
                    onMore={() => sheet.open(deck)}
                    moreLabel={`More actions for ${deck.name}`}
                    trailing={
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums',
                          due ? 'bg-brand-soft text-brand-deep' : 'bg-line-soft text-faint',
                        )}
                      >
                        {due ? `${deck.due} due` : 'Clear'}
                      </span>
                    }
                  >
                    <span className="truncate text-[16px] font-bold text-ink">{deck.name}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
                      <span
                        aria-hidden
                        className={cn('h-3 w-[3px] shrink-0 rounded-full', toneBar[toneOf(deck) ?? 'brand'])}
                      />
                      <span className="truncate">
                        {deck.total} card{deck.total === 1 ? '' : 's'} · {deck.known_pct}% known
                        {deck.subject_name ? ` · ${deck.subject_name}` : ''}
                      </span>
                    </span>
                  </ListRow>
                )
              })}
            </ul>
          </>
        )}

        {!loading && decks.length > 0 && (
          <StickyActionBar>
            {firstDue ? (
              <Button size="xl" className="min-h-14 flex-1" onClick={() => onReview(firstDue.id)}>
                <span className="truncate">
                  Review {manyDue ? firstDue.due : totalDue} due{manyDue ? ` in ${firstDue.name}` : ''}
                </span>
              </Button>
            ) : (
              <Button size="xl" className="min-h-14 flex-1" variant="secondary" onClick={onNew}>
                <Icon name="plus" size={16} /> New deck
              </Button>
            )}
          </StickyActionBar>
        )}
      </div>

      <ActionSheet
        open={sheet.target !== null}
        title={sheet.target?.name}
        onClose={sheet.close}
        actions={
          sheet.target
            ? [
                ...(sheet.target.due > 0
                  ? [{ label: `Review ${sheet.target.due} due`, icon: 'target' as const, onSelect: () => onReview(sheet.target!.id) }]
                  : []),
                { label: 'Open deck', icon: 'deck', onSelect: () => onOpen(sheet.target!.id) },
                { label: 'Delete deck', icon: 'trash', danger: true, onSelect: () => onDelete(sheet.target!.id) },
              ]
            : []
        }
      />
    </div>
  )
}
