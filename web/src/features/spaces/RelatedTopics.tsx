/**
 * The topics this one draws on, and the control to change that.
 *
 * Extracted from `DocsView` so the chat dock can offer it too. Linking a
 * topic is something you decide *while asking a question* — "this also needs
 * my linear algebra notes" — and making that require a trip to another page
 * meant it was set once at setup time, if ever, which is the wrong moment.
 *
 * Links are additive and symmetric: a link only ever adds sources to a
 * retrieval, never replaces the topic's own material.
 */

import { useState } from 'react'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { useSubspaceLinks } from './useSubspaceLinks'

export function RelatedTopics({
  subspaceId,
  /** `row` for the Docs header, `stack` for the narrow chat dock. */
  layout = 'row',
}: {
  subspaceId: string
  layout?: 'row' | 'stack'
}) {
  const { links, candidates, add: link, remove } = useSubspaceLinks(subspaceId)
  const [picking, setPicking] = useState(false)
  const add = (linkedId: string) => {
    setPicking(false)
    void link(linkedId)
  }

  if (links === null) return null

  return (
    <div
      className={cn(
        'flex gap-2',
        layout === 'row' ? 'flex-wrap items-center' : 'flex-col items-start',
      )}
    >
      {layout === 'row' && (
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">
          Related topics
        </span>
      )}
      {links.map((l) => (
        <span
          key={l.id}
          className="flex min-h-9 max-w-full items-center gap-1 rounded-full border border-line bg-well py-1 pl-3.5 pr-1.5 text-[13.5px] text-ink-3"
        >
          <span className="truncate">{l.name}</span>
          <button
            onClick={() => remove(l.id)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-coral-soft hover:text-coral-deep cursor-pointer pointer-coarse:h-9 pointer-coarse:w-9"
            aria-label={`Unlink ${l.name}`}
          >
            <Icon name="close" size={13} />
          </button>
        </span>
      ))}
      <div className={cn('relative', layout === 'stack' && 'w-full')}>
        <button
          onClick={() => setPicking((v) => !v)}
          className={cn(
            'flex min-h-9 items-center gap-1.5 rounded-full border border-dashed border-line-dash px-3.5 py-1 pointer-coarse:min-h-11',
            'text-[13.5px] text-muted transition-colors cursor-pointer',
            'hover:border-brand hover:text-brand-deep',
            layout === 'stack' && 'w-full justify-center',
          )}
        >
          <Icon name="plus" size={13} /> Link a topic
        </button>
        {picking && (
          <div
            className={cn(
              'absolute z-20 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lg',
              // In the dock the picker would run off the right edge of the
              // window, so it opens leftward and matches the panel width.
              layout === 'stack'
                ? 'right-0 top-[calc(100%+6px)] w-full min-w-[13rem]'
                : 'left-0 top-[calc(100%+6px)] w-56',
            )}
          >
            {candidates.length === 0 && (
              <p className="px-3 py-2.5 text-[13.5px] text-faint">No other topics to link.</p>
            )}
            {candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => add(c.id)}
                className="block min-h-10 w-full truncate rounded-lg px-3 py-2 text-left text-[14px] text-ink-3 transition-colors hover:bg-line-soft hover:text-ink cursor-pointer"
              >
                {c.name} <span className="text-faint">· {c.spaceName}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
