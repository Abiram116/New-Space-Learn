/**
 * What a citation points at: the passage the answer leaned on, read in place.
 *
 * The cited text is highlighted and scrolled into view, with a little of what
 * comes before and after so it reads as part of the document rather than a
 * stray quote. This is the text that was extracted and indexed, which is also
 * exactly what the model was shown, so the highlight is what it read (a scanned
 * page appears as its recognised text, not as the picture of it).
 */

import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getPassage } from '../../api/documents'
import type { Citation } from '../../api/types'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { Skeleton } from '../../components/ui/Skeleton'
import { useAsync } from '../../lib/useAsync'
import { reflow } from './reflow'

export function PassagePreview({
  citation,
  base,
  onClose,
}: {
  citation: Citation | null
  base?: string
  onClose: () => void
}) {
  return (
    <Modal
      open={citation !== null}
      onClose={onClose}
      // The page and section are the title: short, and what the student came to see.
      // The file name is a quiet line in the body, not a shouting heading.
      title={citation ? citation.locator : undefined}
      width="lg"
    >
      {citation && <Body citation={citation} base={base} />}
    </Modal>
  )
}

function Body({ citation, base }: { citation: Citation; base?: string }) {
  const passage = useAsync(
    () => getPassage(citation.document_id, citation.locator, citation.snippet),
    [citation.document_id, citation.locator, citation.snippet],
  )
  const cited = useRef<HTMLElement>(null)
  useEffect(() => {
    cited.current?.scrollIntoView?.({ block: 'center' })
  }, [passage.data])

  if (passage.loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <Skeleton className="h-4 w-3/4 rounded" />
        <Skeleton className="h-24 rounded-[10px]" />
        <Skeleton className="h-4 w-2/3 rounded" />
      </div>
    )
  }
  if (passage.error || !passage.data) {
    return (
      <p className="text-[13px] leading-relaxed text-muted">
        Couldn’t load this passage. The file may have been removed or re-read since this answer.
        {base && (
          <>
            {' '}
            <Link to={`${base}/docs?d=${citation.document_id}`} className="font-bold text-brand-deep">
              Open the file
            </Link>
          </>
        )}{' '}
        <button type="button" onClick={passage.refresh} className="cursor-pointer font-bold text-ink-2 hover:text-ink">
          Try again
        </button>
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted" title={citation.document_name}>
        <Icon name="doc" size={13} className="shrink-0" />
        <span className="truncate">{citation.document_name}</span>
      </p>
      <div className="flex max-h-[58dvh] flex-col gap-4 overflow-y-auto pr-2 text-[15px] leading-[1.75] text-ink-2">
        {passage.data.chunks.map((c) => {
          const blocks = reflow(c.content)
          if (!c.cited) {
            return (
              <div key={c.index} className="flex flex-col gap-2 text-muted [overflow-wrap:anywhere]">
                {blocks.map((b, i) =>
                  b.kind === 'heading' ? (
                    <p key={i} className="font-semibold text-ink-3">
                      {b.text}
                    </p>
                  ) : (
                    <p key={i}>{b.text}</p>
                  ),
                )}
              </div>
            )
          }
          return (
            <div
              key={c.index}
              ref={cited as React.RefObject<HTMLDivElement>}
              data-cited=""
              className="flex flex-col gap-2 rounded-xl border-l-[3px] border-brand bg-brand-soft px-4 py-3 text-ink [overflow-wrap:anywhere]"
            >
              <span className="setcode text-brand-deep">What the answer used</span>
              {blocks.map((b, i) =>
                b.kind === 'heading' ? (
                  <p key={i} className="font-bold">
                    {b.text}
                  </p>
                ) : (
                  <p key={i}>{b.text}</p>
                ),
              )}
            </div>
          )
        })}
      </div>
      {base && (
        <Link
          to={`${base}/docs?d=${citation.document_id}`}
          className="flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-muted transition-colors hover:text-ink"
        >
          <Icon name="doc" size={13} /> Open the file
        </Link>
      )}
    </div>
  )
}
