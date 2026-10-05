/**
 * Your material, in the dock: the files answers come from, and the one place to add more.
 *
 * This is step 1 of the dock and the thing the whole product rests on — answers
 * come from these files and cite their pages — so it leads the dock, says in
 * words what state each file is in (the old row was a name and a tick nobody
 * could read), and is a real button to add another instead of a few pixels of
 * small print. With nothing added yet it is the whole screen's call to action.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { deleteDocument, reprocessDocument, uploadDocument } from '../../api/documents'
import type { Document } from '../../api/types'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { toneSoft, toneText } from '../../lib/tone'
import { fileIcon } from '../docs/SourceItem'
import { DockSectionHead, Spinner } from './dockParts'

/* ── What state the sources are in, in words ────────────────────────────── */

export type SourcesState = {
  kind: 'loading' | 'none' | 'reading' | 'ready' | 'failed'
  ready: number
  reading: number
  failed: number
  /** The name of the first file that could not be read, if any. */
  failedName?: string
  /** The one-line state of the topic, for the dock's header. */
  title: string
  /** And what it means for the person looking at it. */
  hint: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function sourcesState(docs: Document[], loading: boolean): SourcesState {
  const ready = docs.filter((d) => d.status === 'ready').length
  const reading = docs.filter((d) => d.status === 'processing' || d.status === 'uploading').length
  const failed = docs.filter((d) => d.status === 'failed').length
  const failedDoc = docs.find((d) => d.status === 'failed')
  const failedName = failedDoc ? (failedDoc.name.length > 26 ? `${failedDoc.name.slice(0, 24)}…` : failedDoc.name) : undefined
  const base = { ready, reading, failed, failedName }

  if (loading && docs.length === 0) return { ...base, kind: 'loading', title: 'Checking your files…', hint: '' }
  if (docs.length === 0) {
    return { ...base, kind: 'none', title: 'No files yet', hint: 'Add one and I’ll answer from it.' }
  }
  if (ready > 0) {
    return {
      ...base,
      kind: 'ready',
      title: `Answering from ${plural(ready, 'file')}`,
      hint: reading > 0 ? `Still reading ${reading} more.` : '',
    }
  }
  if (reading > 0) {
    return { ...base, kind: 'reading', title: 'Reading your file…', hint: 'You can ask once it’s done.' }
  }
  return { ...base, kind: 'failed', title: 'Couldn’t read your file', hint: 'Try again, or add a different one.' }
}

/* ── One source ─────────────────────────────────────────────────────────── */

function kindLabel(doc: Document): string {
  const name = doc.name.toLowerCase()
  const mime = doc.mime_type ?? ''
  if (name.endsWith('.pdf') || mime.includes('pdf')) return 'PDF'
  if (name.endsWith('.md') || mime.includes('markdown')) return 'Markdown'
  if (name.endsWith('.csv') || mime.includes('csv')) return 'CSV'
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp)$/.test(name)) return 'Image'
  return 'Text'
}

function sizeLabel(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DockSourceRow({
  doc,
  onRetry,
  onRemove,
  onDelete,
  retrying = false,
}: {
  doc: Document
  onRetry?: () => void
  /** For a file that couldn't be read: sits beside Try again. */
  onRemove?: () => void
  /** For any file: a quiet bin at the row's edge. Asks first (the caller confirms). */
  onDelete?: () => void
  retrying?: boolean
}) {
  const pending = doc.status === 'processing' || doc.status === 'uploading'
  const failed = doc.status === 'failed'
  const live = pending && typeof doc.progress === 'number' ? Math.round(doc.progress * 100) : null
  const tone = failed ? 'coral' : pending ? 'sun' : 'mint'
  const status = failed
    ? 'Couldn’t read this'
    : pending
      ? live !== null
        ? `Reading… ${live}%`
        : 'Reading…'
      : 'Ready'
  const detail = [kindLabel(doc), sizeLabel(doc.size_bytes)].filter(Boolean).join(' · ')

  return (
    <li className={cn('cardstock flex items-start gap-2.5 rounded-[10px] px-2.5 py-2.5', failed && 'ring-1 ring-coral/25')}>
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-line-soft text-ink-3">
        <Icon name={fileIcon(doc.mime_type)} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold leading-tight text-ink" title={doc.name}>
          {doc.name}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11.5px] leading-tight">
          <span className={cn('inline-flex items-center gap-1 font-bold', toneText[tone])}>
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full bg-current', pending && 'animate-pulse')} />
            {status}
          </span>
          {detail && <span className="text-faint">· {detail}</span>}
        </p>
        {pending && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-1 w-full origin-left bg-sun t-meter duration-300"
              style={{ transform: `scaleX(${(live ?? 40) / 100})` }}
            />
          </div>
        )}
        {failed && (
          <div className="mt-1.5 flex flex-col items-start gap-1.5">
            {doc.error && <p className="text-[11.5px] leading-snug text-muted">{doc.error}</p>}
            <div className="flex items-center gap-1.5">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={retrying}
                  className={cn(
                    'inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-bold',
                    toneSoft.coral,
                    toneText.coral,
                    'hover:brightness-110 disabled:cursor-progress disabled:opacity-60',
                  )}
                >
                  {retrying ? <Spinner size={11} /> : <Icon name="refresh" size={12} />} Try again
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  onClick={onRemove}
                  className="inline-flex min-h-7 cursor-pointer items-center rounded-full px-2.5 text-[11.5px] font-bold text-muted transition-colors hover:text-ink"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {onDelete && !failed && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Remove ${doc.name}`}
          title="Remove this file"
          className="-mr-1 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md text-faint transition-colors hover:bg-coral-soft hover:text-coral-deep"
        >
          <Icon name="trash" size={14} />
        </button>
      )}
    </li>
  )
}


/* ── The files themselves ──────────────────────────────────────────────── */

const ACCEPT = '.pdf,.md,.txt,.csv,.png,.jpg,.jpeg,.webp'

/** Anything on the page can ask the dock to open its file picker. */
export const ADD_FILE_EVENT = 'sl:add-file'

/** What the dock needs from the files: to open the file picker, or retry. */
export type SourcesHandle = {
  choose: () => void
  /** Retries the first file that failed. */
  retryFailed: () => void
}

/** An upload in flight: which file of how many, and how far along. */
type Sending = { name: string; index: number; total: number; percent: number }

export const DockSources = forwardRef<
  SourcesHandle,
  {
    subspaceId: string
    docs: Document[]
    loading: boolean
    error: string | null
    /** Called after an upload, a retry or a removal, so the list is read again. */
    onChanged: () => void
    /** The Add files button under the list: the screen's main button (orange),
     *  a quiet one, or none (a panel whose own main button adds files). */
    addButton?: 'primary' | 'quiet' | 'none'
    /** Opens the file picker when something else on the page asks to add a file
     *  (the empty chat's button). Only the dock's first screen listens, so two
     *  copies mounted at once don't open two pickers. */
    listenForAdd?: boolean
    /** Show only this many, then a link to the rest (`onSeeAll`). */
    limit?: number
    onSeeAll?: () => void
  }
>(function DockSources({ subspaceId, docs, loading, error, onChanged, addButton = 'quiet', listenForAdd = false, limit, onSeeAll }, handle) {
  const { showError } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [sending, setSending] = useState<Sending | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Document | null>(null)
  const [removing, setRemoving] = useState(false)
  const uploading = sending !== null

  /** One after another, so each gets its own progress and its own error. */
  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      for (const [i, file] of list.entries()) {
        setSending({ name: file.name, index: i + 1, total: list.length, percent: 0 })
        try {
          await uploadDocument(subspaceId, file, (percent) =>
            setSending((s) => (s && s.name === file.name ? { ...s, percent } : s)),
          )
          onChanged()
        } catch (err) {
          showError(err)
        }
      }
      setSending(null)
    },
    [subspaceId, onChanged, showError],
  )

  const retry = useCallback(
    async (doc: Document) => {
      setRetrying(doc.id)
      try {
        await reprocessDocument(doc.id)
        onChanged()
      } catch (err) {
        showError(err)
      } finally {
        setRetrying(null)
      }
    },
    [onChanged, showError],
  )

  const remove = useCallback(
    async (doc: Document) => {
      setRemoving(true)
      try {
        await deleteDocument(doc.id)
        setConfirming(null)
        onChanged()
      } catch (err) {
        showError(err)
      } finally {
        setRemoving(false)
      }
    },
    [onChanged, showError],
  )

  const choose = () => fileRef.current?.click()
  useEffect(() => {
    if (!listenForAdd) return
    window.addEventListener(ADD_FILE_EVENT, choose)
    return () => window.removeEventListener(ADD_FILE_EVENT, choose)
  })
  useImperativeHandle(handle, () => ({
    choose,
    retryFailed: () => {
      const failed = docs.find((d) => d.status === 'failed')
      if (failed) void retry(failed)
    },
  }))

  const shown = limit ? docs.slice(0, limit) : docs
  const hidden = docs.length - shown.length
  const empty = docs.length === 0 && !uploading

  return (
    // The drop target is the whole section, not just the empty state, so
    // dropping a file works however many are already there.
    <section
      aria-labelledby="dock-sources-label"
      className={cn(
        'flex flex-col gap-2 rounded-[10px] transition-colors',
        dragging && !empty && 'bg-brand-soft/40 ring-1 ring-brand/40',
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (e.dataTransfer.files.length > 0) void upload(e.dataTransfer.files)
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        aria-label="Choose files to add"
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files)
          // Reset, or choosing the same file twice in a row fires nothing.
          e.target.value = ''
        }}
      />

      <DockSectionHead id="dock-sources-label">Your material</DockSectionHead>

      {loading && docs.length === 0 ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-14 rounded-[10px]" />
          ))}
        </div>
      ) : error && docs.length === 0 ? (
        <p className="text-[12px] text-muted">{error}</p>
      ) : empty ? (
        // Nothing here yet: the box IS the button, and the one thing to do.
        <button
          type="button"
          onClick={choose}
          className={cn(
            'group flex cursor-pointer flex-col items-center gap-1.5 rounded-[12px] border border-dashed px-4 py-5 text-center t-control duration-200',
            dragging
              ? 'border-brand bg-brand-soft'
              : addButton === 'primary'
                ? 'border-brand/60 bg-brand-tint hover:border-brand hover:bg-brand-soft'
                : 'border-line-dash bg-well/40 hover:border-brand/50',
          )}
        >
          <span
            className={cn(
              'mb-1 grid h-11 w-11 place-items-center rounded-full bg-brand text-[#1a120f] transition-transform group-hover:-translate-y-0.5',
              !dragging && 'dock-float',
              dragging && 'scale-110',
            )}
          >
            <Icon name="upload" size={19} />
          </span>
          <span className="text-[13.5px] font-bold text-ink">Add your notes or PDFs</span>
          <span className="text-[11.5px] leading-snug text-muted">I’ll answer from them, with page numbers.</span>
          <span className="text-[11px] text-faint">Drop them here, or click · up to 20 MB each</span>
        </button>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {sending && <SendingRow sending={sending} />}
            {shown.map((doc) => (
              <DockSourceRow
                key={doc.id}
                doc={doc}
                onRetry={() => void retry(doc)}
                onRemove={() => void remove(doc)}
                onDelete={() => setConfirming(doc)}
                retrying={retrying === doc.id}
              />
            ))}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              onClick={onSeeAll}
              className="flex min-h-8 w-fit cursor-pointer items-center gap-1.5 rounded-md px-1 text-[12px] font-semibold text-muted transition-colors hover:text-ink"
            >
              See all {docs.length} files <Icon name="arrowRight" size={12} />
            </button>
          )}
          {addButton !== 'none' && (
            <button
              type="button"
              onClick={choose}
              disabled={uploading}
              className={cn(
                'flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] px-3 text-[13px] font-bold t-control duration-200',
                'disabled:cursor-progress disabled:opacity-60',
                addButton === 'primary'
                  ? 'bg-brand text-[#1a120f] hover:brightness-110 active:scale-[0.98]'
                  : 'border border-dashed border-line-dash text-ink-2 hover:border-brand/50 hover:text-ink',
              )}
            >
              {uploading ? <Spinner size={13} /> : <Icon name="plus" size={14} />}
              {uploading ? 'Adding…' : 'Add files'}
            </button>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? `Remove ${confirming.name}?` : 'Remove this file?'}
        description="I’ll stop answering from it. Your notes and chats stay."
        confirmLabel="Remove"
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && void remove(confirming)}
        destructive
        loading={removing}
      />
    </section>
  )
})

/** The file being sent right now, with how far along it is. */
function SendingRow({ sending }: { sending: Sending }) {
  const of = sending.total > 1 ? ` (${sending.index} of ${sending.total})` : ''
  return (
    <li role="status" className="cardstock flex items-start gap-2.5 rounded-[10px] px-2.5 py-2.5">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-deep">
        <Spinner size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold leading-tight text-ink" title={sending.name}>
          {sending.name}
        </p>
        <p className="mt-1 text-[11.5px] font-bold leading-tight text-brand-deep">
          Uploading… {sending.percent}%{of}
        </p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line-soft">
          <div
            className="h-1 w-full origin-left bg-brand t-meter duration-300"
            style={{ transform: `scaleX(${Math.max(4, sending.percent) / 100})` }}
          />
        </div>
      </div>
    </li>
  )
}
