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

import { useCallback, useEffect, useState } from 'react'
import { createSubspaceLink, deleteSubspaceLink, listSubspaceLinks } from '../../api/spaces'
import type { Subspace } from '../../api/types'
import { Icon } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { useSpaces } from './SpacesProvider'

export function RelatedTopics({
  subspaceId,
  /** `row` for the Docs header, `stack` for the narrow chat dock. */
  layout = 'row',
}: {
  subspaceId: string
  layout?: 'row' | 'stack'
}) {
  const { spaces } = useSpaces()
  const { showError, show } = useToast()
  const [links, setLinks] = useState<Subspace[] | null>(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    setLinks(null)
    listSubspaceLinks(subspaceId)
      .then(setLinks)
      .catch((err) => showError(err))
  }, [subspaceId, showError])

  const candidates = spaces
    .flatMap((sp) => sp.subspaces.map((sub) => ({ ...sub, spaceName: sp.name })))
    .filter((sub) => sub.id !== subspaceId && !links?.some((l) => l.id === sub.id))

  const add = useCallback(
    async (linkedId: string) => {
      setPicking(false)
      try {
        await createSubspaceLink(subspaceId, linkedId)
        setLinks(await listSubspaceLinks(subspaceId))
      } catch (err) {
        showError(err)
      }
    },
    [subspaceId, showError],
  )

  const remove = useCallback(
    async (linkedId: string) => {
      try {
        await deleteSubspaceLink(subspaceId, linkedId)
        setLinks((prev) => (prev ? prev.filter((l) => l.id !== linkedId) : prev))
        show('Link removed.', 'success')
      } catch (err) {
        showError(err)
      }
    },
    [subspaceId, show, showError],
  )

  if (links === null) return null

  return (
    <div
      className={cn(
        'flex gap-2',
        layout === 'row' ? 'flex-wrap items-center' : 'flex-col items-start',
      )}
    >
      {layout === 'row' && (
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          Related topics
        </span>
      )}
      {links.map((l) => (
        <span
          key={l.id}
          className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-well px-2.5 py-1 text-[12.5px] text-ink-3"
        >
          <span className="truncate">{l.name}</span>
          <button
            onClick={() => remove(l.id)}
            className="shrink-0 text-faint transition-colors hover:text-coral-deep cursor-pointer"
            aria-label={`Unlink ${l.name}`}
          >
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}
      <div className={cn('relative', layout === 'stack' && 'w-full')}>
        <button
          onClick={() => setPicking((v) => !v)}
          className={cn(
            'flex items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1',
            'text-[12.5px] text-faint transition-colors cursor-pointer',
            'hover:border-brand hover:text-brand-deep',
            layout === 'stack' && 'w-full justify-center',
          )}
        >
          <Icon name="plus" size={11} /> Link a topic
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
              <p className="px-2.5 py-2 text-[12.5px] text-faint">No other topics to link.</p>
            )}
            {candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => add(c.id)}
                className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-3 transition-colors hover:bg-line-soft hover:text-ink cursor-pointer"
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
