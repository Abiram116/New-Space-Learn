import { cn } from '../../lib/cn'
import type { DocStatus, Document } from '../../api/types'
import { Icon, type IconName } from '../../components/ui/Icon'
import { toneSoft, toneText } from '../../lib/tone'
import type { Tone } from '../../api/types'

export const statusMeta: Record<
  DocStatus,
  { note: string; icon: IconName; tone: Tone; barClass: string }
> = {
  uploading: { note: 'Uploading', icon: 'upload', tone: 'sky', barClass: 'bg-sky' },
  processing: { note: 'Embedding chunks', icon: 'clock', tone: 'sun', barClass: 'bg-sun' },
  ready: { note: 'Indexed for citations', icon: 'check', tone: 'mint', barClass: 'bg-mint' },
  failed: { note: 'Failed', icon: 'alert', tone: 'coral', barClass: 'bg-coral' },
}

export function SourceItem({
  doc,
  detailed,
  progress,
  highlighted,
  onReprocess,
  onDelete,
}: {
  doc: Document
  detailed?: boolean
  progress?: number
  /** True when this is the document a citation link (`/docs?d=<id>`) pointed
   *  at — see `notes/format.ts`'s `sourceLine`. `id={doc.id}` below is what
   *  the deep link's `scrollIntoView` target actually is. */
  highlighted?: boolean
  onReprocess?: () => void
  onDelete?: () => void
}) {
  const meta = statusMeta[doc.status]
  const pending = doc.status === 'uploading' || doc.status === 'processing'
  // Real progress from the ingestion job when there is one; 40 is only the
  // "somewhere in the middle" placeholder for a doc with no live job.
  const live = doc.status === 'processing' && typeof doc.progress === 'number' ? doc.progress : null
  const value =
    typeof progress === 'number'
      ? progress
      : doc.status === 'ready'
        ? 100
        : live !== null
          ? Math.max(4, Math.round(live * 100))
          : 40
  const note = live !== null ? `${meta.note} · ${Math.round(live * 100)}%` : meta.note

  return (
    <div
      id={doc.id}
      className={cn(
        'cardstock group relative flex flex-col gap-2.5 rounded-xl p-3.5 scroll-mt-4',
        doc.status === 'failed' && 'ring-1 ring-coral/25',
        highlighted && 'ring-2 ring-brand',
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-line-soft text-ink-3">
          <Icon name={fileIcon(doc.mime_type)} size={15} />
        </span>
        <span
          className={cn('min-w-0 flex-1 truncate text-[14px] font-bold', pending ? 'text-ink-3' : 'text-ink')}
          title={doc.name}
        >
          {doc.name}
        </span>
        <span
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-md',
            toneSoft[meta.tone],
            toneText[meta.tone],
          )}
          title={doc.error || meta.note}
        >
          <Icon name={meta.icon} size={12} filled={doc.status === 'ready'} />
        </span>
      </div>

      {(pending || detailed) && (
        <div className="flex flex-col gap-1.5">
          <div className={cn('setcode', doc.status === 'failed' && 'text-coral-deep')}>
            {doc.error || note}
          </div>
          {pending && (
            <div className="h-1 overflow-hidden rounded-full bg-line-soft">
              {/* See DocsView: the track clips and rounds, the fill scales. */}
              <div
                className={cn('h-1 w-full origin-left t-meter duration-300', meta.barClass)}
                style={{ transform: `scaleX(${value / 100})` }}
              />
            </div>
          )}
        </div>
      )}

      {detailed && (onReprocess || onDelete) && (
        <div className="mt-auto flex items-center gap-1.5 border-t border-line pt-2.5 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
          {onReprocess && (doc.status === 'processing' || doc.status === 'failed') && (
            <button
              type="button"
              onClick={onReprocess}
              className="flex min-h-10 items-center gap-1.5 rounded-[10px] bg-brand-soft px-3 text-[13px] font-bold text-brand-deep cursor-pointer"
            >
              <Icon name="refresh" size={13} /> Reprocess
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${doc.name}`}
              className="ml-auto grid h-10 w-10 place-items-center rounded-[10px] text-muted transition-colors hover:bg-coral-soft hover:text-coral-deep cursor-pointer"
            >
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function fileIcon(mime: string | null): IconName {
  if (!mime) return 'doc'
  if (mime.includes('markdown') || mime.includes('text')) return 'note'
  return 'doc'
}
