import { cn } from '../../lib/cn'
import type { DocStatus, Document } from '../../api/types'

const statusMeta: Record<
  DocStatus,
  { note: string; badge: string; badgeClass: string; barClass: string }
> = {
  uploading: { note: 'Uploading', badge: '↑', badgeClass: 'text-sky', barClass: 'bg-sky' },
  processing: { note: 'Embedding chunks', badge: '…', badgeClass: 'text-sun-deep', barClass: 'bg-sun' },
  ready: { note: 'Indexed for citations', badge: '✓', badgeClass: 'text-mint', barClass: 'bg-mint' },
  failed: { note: 'Failed', badge: '!', badgeClass: 'text-coral-deep', barClass: 'bg-coral-deep' },
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
    <div className="rounded-xl border-[1.5px] border-line bg-surface px-2.5 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        <span>{iconFor(doc.mime_type)}</span>
        <span className={cn('truncate flex-1', pending && 'text-muted')} title={doc.name}>
          {doc.name}
        </span>
        <span className={cn('shrink-0 font-bold', meta.badgeClass)}>{meta.badge}</span>
      </div>

      {(pending || detailed) && (
        <div className="mt-1.5 flex flex-col gap-1">
          <div className={cn('text-[11px]', doc.status === 'failed' ? 'text-coral-deep' : 'text-faint')}>
            {doc.error || meta.note}
          </div>
          {pending && (
            <div className="h-1 rounded-full bg-line-soft">
              <div
                className={cn('h-1 rounded-full transition-all', meta.barClass)}
                style={{ width: `${value}%` }}
              />
            </div>
          )}
        </div>
      )}

      {detailed && (onReprocess || onDelete) && (
        <div className="mt-2 flex gap-2 text-[11.5px]">
          {onReprocess && (doc.status === 'processing' || doc.status === 'failed') && (
            <button
              onClick={onReprocess}
              className="rounded-md bg-brand-soft px-2 py-1 font-semibold text-brand cursor-pointer"
            >
              Reprocess
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="ml-auto rounded-md px-2 py-1 text-coral-deep hover:bg-coral-soft cursor-pointer"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function iconFor(mime: string | null): string {
  if (!mime) return '📄'
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('markdown') || mime.includes('text')) return '📝'
  return '📎'
}
