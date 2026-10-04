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
      title={citation ? `${citation.document_name} · ${citation.locator}` : undefined}
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
        )}
      </p>
    )
  }

  return (
    <div className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto pr-1 text-[14px] leading-[1.7] text-ink-2">
      {passage.data.chunks.map((c) =>
        c.cited ? (
          <p
            key={c.index}
            ref={cited as React.RefObject<HTMLParagraphElement>}
            data-cited=""
            className="whitespace-pre-wrap rounded-lg border-l-[3px] border-brand bg-brand-soft px-3 py-2 text-ink [overflow-wrap:anywhere]"
          >
            {c.content}
          </p>
        ) : (
          <p key={c.index} className="whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">
            {c.content}
          </p>
        ),
      )}
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
