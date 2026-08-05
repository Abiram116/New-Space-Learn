import { cn } from '../../lib/cn'
import type { DocStatus, Document } from '../../api/types'
import { Icon, type IconName } from '../../components/ui/Icon'
import { toneSoft, toneText } from '../../lib/tone'
import type { Tone } from '../../api/types'

const statusMeta: Record<
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
  onReprocess,
  onDelete,
}: {
  doc: Document
  detailed?: boolean
  progress?: number
  onReprocess?: () => void
  onDelete?: () => void
}) {
  const meta = statusMeta[doc.status]
  const pending = doc.status === 'uploading' || doc.status === 'processing'
  const value = typeof progress === 'number' ? progress : doc.status === 'ready' ? 100 : 40

  return (
    <div
      className={cn(
        'cardstock group relative flex flex-col gap-2.5 rounded-xl p-3.5',
        doc.status === 'failed' && 'ring-1 ring-coral/25',
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
            {doc.error || meta.note}
          </div>
          {pending && (
            <div className="h-1 overflow-hidden rounded-full bg-line-soft">
              <div
                className={cn('h-1 rounded-full transition-all duration-300', meta.barClass)}
                style={{ width: `${value}%` }}
              />
            </div>
          )}
        </div>
      )}

      {detailed && (onReprocess || onDelete) && (
        <div className="mt-auto flex items-center gap-1.5 border-t border-line pt-2.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {onReprocess && (doc.status === 'processing' || doc.status === 'failed') && (
            <button
              type="button"
              onClick={onReprocess}
              className="flex items-center gap-1 rounded-md bg-brand-soft px-2 py-1 text-[11.5px] font-bold text-brand-deep cursor-pointer"
            >
              <Icon name="refresh" size={11} /> Reprocess
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${doc.name}`}
              className="ml-auto rounded-md p-1.5 text-faint transition-colors hover:text-coral cursor-pointer"
            >
              <Icon name="trash" size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function fileIcon(mime: string | null): IconName {
  if (!mime) return 'doc'
  if (mime.includes('markdown') || mime.includes('text')) return 'note'
  return 'doc'
}
