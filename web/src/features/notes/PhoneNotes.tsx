/**
 * The notes library on a phone: a reading list.
 *
 * Rows ~70px edge to edge, "New note" pinned in the thumb zone (with the AI
 * option beside it), filters as a scrolling chip row, search folded behind an
 * icon until you want it. Delete and the rest live in each row's ⋯ sheet.
 */

import { useEffect, useRef, useState } from 'react'
import type { Note, Tone } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { toneBar } from '../../lib/tone'
import { StickyActionBar } from '../../components/ui/StickyActionBar'
import { ActionSheet, ChipRow, ListRow, PhoneTitle, useRowSheet } from '../quizzes/phoneKit'
import { labelFor, notePreview, provenanceLabel, relativeTime, type Filter } from './format'

export function PhoneNotes({
  notes,
  visible,
  loading,
  error,
  onRetry,
  filter,
  onFilter,
  showOriginFilter,
  subjects,
  subjectFilter,
  onSubjectFilter,
  search,
  onSearch,
  toneOf,
  onOpen,
  onDelete,
  onNew,
  onAi,
}: {
  /** Everything, for the chip counts. */
  notes: Note[] | null
  /** After filters and search. */
  visible: Note[]
  loading: boolean
  error: string | null
  onRetry: () => void
  filter: Filter
  onFilter: (f: Filter) => void
  showOriginFilter: boolean
  subjects: { id: string; name: string }[]
  subjectFilter: string
  onSubjectFilter: (id: string) => void
  search: string
  onSearch: (s: string) => void
  toneOf: (n: Note) => Tone | undefined
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
  onAi: () => void
}) {
  const sheet = useRowSheet<Note>()
  const total = notes?.length ?? 0
  const [searching, setSearching] = useState(search !== '')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (searching) searchRef.current?.focus()
  }, [searching])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PhoneTitle
          title="Notes"
          hideTitle
          sub={total > 0 ? `${total} note${total === 1 ? '' : 's'}` : undefined}
          right={
            total > 0 ? (
              <button
                type="button"
                onClick={() => {
                  if (searching) onSearch('')
                  setSearching((v) => !v)
                }}
                aria-label={searching ? 'Close search' : 'Search notes'}
                aria-expanded={searching}
                className="phone-tap grid size-11 shrink-0 place-items-center rounded-full text-ink-3 active:bg-line-soft"
              >
                <Icon name={searching ? 'close' : 'search'} size={19} />
              </button>
            ) : undefined
          }
        />

        {searching && (
          <div className="px-4 pb-3">
            <input
              ref={searchRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              placeholder="Search notes"
              aria-label="Search notes"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              className="h-12 w-full rounded-xl border border-line bg-well px-4 text-[16px] text-ink outline-none placeholder:text-faint focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
            />
          </div>
        )}

        {(showOriginFilter || subjects.length > 1) && (
          <ChipRow
            label="Filter notes"
            value={filter === 'all' && subjectFilter !== 'all' ? (`s:${subjectFilter}` as string) : filter}
            onChange={(v) => {
              if (v.startsWith('s:')) {
                onFilter('all')
                onSubjectFilter(v.slice(2))
              } else {
                onSubjectFilter('all')
                onFilter(v as Filter)
              }
            }}
            options={[
              ...(showOriginFilter
                ? (['all', 'ai', 'mine'] as Filter[]).map((f) => ({ value: f as string, label: labelFor(f, notes) }))
                : [{ value: 'all', label: 'All' }]),
              ...(subjects.length > 1 ? subjects.map((s) => ({ value: `s:${s.id}`, label: s.name })) : []),
            ]}
          />
        )}

        {loading && (
          <div className="flex flex-col gap-px" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[76px] rounded-none" />
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

        {!loading && !error && total === 0 && (
          <div className="px-4 py-4">
            <EmptyState
              icon="note"
              title="No notes yet"
              description="Start a blank one, or have the AI write one from what's indexed here."
              action={
                <div className="flex w-full flex-col gap-2">
                  <Button size="xl" onClick={onNew}>
                    New note
                  </Button>
                  <Button size="lg" variant="secondary" onClick={onAi}>
                    <Icon name="sparkle" size={15} /> Write with AI
                  </Button>
                </div>
              }
            />
          </div>
        )}

        {!loading && total > 0 && visible.length === 0 && (
          <p className="px-4 py-8 text-center text-[15px] text-muted">
            {search ? `Nothing matches “${search}”.` : 'No notes in this view.'}
          </p>
        )}

        {!loading && visible.length > 0 && (
          <ul className="border-t border-line-soft">
            {visible.map((item) => {
              const preview = notePreview(item.body_md, 120)
              return (
                <ListRow
                  key={item.id}
                  onOpen={() => onOpen(item.id)}
                  onMore={() => sheet.open(item)}
                  moreLabel={`More actions for ${item.title || 'Untitled note'}`}
                  className="min-h-[76px]"
                >
                  <span className="truncate text-[16px] font-bold text-ink">
                    {item.title || 'Untitled note'}
                  </span>
                  {preview && (
                    <span className="line-clamp-2 text-[14px] leading-snug text-muted">{preview}</span>
                  )}
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-faint">
                    {item.touched_by_agent && (
                      <span className="flex shrink-0 items-center gap-1" title={provenanceLabel(item)}>
                        <Icon name="sparkle" size={11} className="text-sky-deep" />
                        <span className="sr-only">{provenanceLabel(item)}</span>
                      </span>
                    )}
                    <span
                      aria-hidden
                      className={cn(
                        'h-3 w-[3px] shrink-0 rounded-full',
                        toneOf(item) ? toneBar[toneOf(item)!] : 'bg-line',
                      )}
                    />
                    <span className="truncate">
                      {relativeTime(item.updated_at)}
                      {item.subspace_name ? ` · ${item.subspace_name}` : ''}
                    </span>
                  </span>
                </ListRow>
              )
            })}
          </ul>
        )}

        {!loading && !error && total > 0 && (
          <StickyActionBar>
            <Button
              variant="secondary"
              size="xl"
              className="min-h-14 shrink-0"
              onClick={onAi}
              aria-label="Write a note with AI"
            >
              <Icon name="sparkle" size={17} /> AI
            </Button>
            <Button size="xl" className="min-h-14 flex-1" onClick={onNew}>
              <Icon name="plus" size={17} /> New note
            </Button>
          </StickyActionBar>
        )}
      </div>

      <ActionSheet
        open={sheet.target !== null}
        title={sheet.target?.title || 'Untitled note'}
        onClose={sheet.close}
        actions={
          sheet.target
            ? [
                { label: 'Open', icon: 'note', onSelect: () => onOpen(sheet.target!.id) },
                { label: 'Delete note', icon: 'trash', danger: true, onSelect: () => onDelete(sheet.target!.id) },
              ]
            : []
        }
      />
    </div>
  )
}
