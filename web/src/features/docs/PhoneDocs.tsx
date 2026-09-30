/**
 * Adding material on a phone.
 *
 * The thing a student has in their hand is a phone with a camera and a page of
 * handwritten notes, so the first option is "Take a photo" — the file picker
 * is the second. Upload and ingestion progress is a plain list of rows with
 * one clear state each (uploading, reading, ready, failed), not a card grid.
 *
 * Photos go up as they're taken and the sheet stays open, so a whole chapter
 * is one sitting: snap, snap, snap, done.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Document } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { cn } from '../../lib/cn'
import { toneSoft, toneText } from '../../lib/tone'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { StickyActionBar } from '../../components/ui/StickyActionBar'
import { ActionSheet, CameraIcon, FolderIcon, PhoneTitle, useRowSheet } from '../quizzes/phoneKit'
import { fileIcon, statusMeta } from './SourceItem'

export type LocalUpload = { key: string; name: string; progress: number }

/** Everything the server ingests, by extension AND type — phones disagree on which they honour. */
const FILE_ACCEPT =
  'application/pdf,text/markdown,text/plain,text/csv,image/*,.pdf,.md,.txt,.csv,.png,.jpg,.jpeg,.webp'

export function PhoneDocs({
  docs,
  uploads,
  loading,
  error,
  highlightId,
  openAddSignal = 0,
  onFiles,
  onDelete,
  onReprocess,
  extra,
}: {
  docs: Document[] | null
  uploads: LocalUpload[]
  loading: boolean
  error: string | null
  highlightId: string | null
  /** Bumped by the parent to open the Add sheet (`?add=1`). */
  openAddSignal?: number
  onFiles: (files: File[]) => void
  onDelete: (id: string) => void
  onReprocess: (id: string) => void
  extra?: ReactNode
}) {
  const camRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [photos, setPhotos] = useState(0)
  useEffect(() => {
    if (openAddSignal > 0) setAddOpen(true)
  }, [openAddSignal])
  const sheet = useRowSheet<Document>()

  const closeAdd = () => {
    setAddOpen(false)
    setPhotos(0)
  }

  const onCamera = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = '' // the same shot twice in a row must still fire
    if (picked.length === 0) return
    // Every camera shot arrives called "image.jpg"; a name a person can tell
    // apart later is worth a few characters.
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/:/g, '.')
    onFiles(
      picked.map((f, i) =>
        f.name.toLowerCase().startsWith('image.') || /^img_?\d*\./i.test(f.name)
          ? new File([f], `Photo ${stamp}${picked.length > 1 ? ` (${i + 1})` : ''}.${f.name.split('.').pop() || 'jpg'}`, { type: f.type })
          : f,
      ),
    )
    setPhotos((n) => n + picked.length)
  }

  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return
    onFiles(picked)
    closeAdd()
  }

  const isEmpty = docs !== null && docs.length === 0 && uploads.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Two inputs: the camera one asks for the rear lens directly. */}
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="camera-input"
        onChange={onCamera}
      />
      <input
        ref={fileRef}
        type="file"
        accept={FILE_ACCEPT}
        multiple
        className="hidden"
        data-testid="file-input"
        onChange={onFilesPicked}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PhoneTitle
          title="Material"
          hideTitle
          sub={docs && docs.length + uploads.length > 0 ? `${docs.length + uploads.length} source${docs.length + uploads.length === 1 ? '' : 's'}` : undefined}
        />

        {loading && <PageSpinner label="Loading documents…" />}

        {error && !loading && (
          <div className="mx-4 rounded-xl border border-coral/30 bg-coral-soft px-4 py-3 text-[15px] text-coral-deep">
            {error}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center gap-5 px-6 py-10 text-center">
            <p className="max-w-[22ch] text-[22px] font-bold leading-snug text-ink [text-wrap:balance]">
              Snap your notes or add a PDF, and I’ll turn them into cards and quizzes.
            </p>
            <div className="flex w-full max-w-sm flex-col gap-2.5">
              <Button size="xl" className="min-h-14" onClick={() => camRef.current?.click()}>
                <CameraIcon size={20} /> Take a photo
              </Button>
              <Button size="xl" variant="secondary" className="min-h-14" onClick={() => fileRef.current?.click()}>
                <FolderIcon size={20} /> Choose from files
              </Button>
            </div>
          </div>
        )}

        {!isEmpty && !loading && (
          <ul className="border-t border-line-soft" aria-label="Material">
            {uploads.map((u) => (
              <li key={u.key} className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
                <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', toneSoft.sky, toneText.sky)}>
                  <Icon name="upload" size={18} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="truncate text-[16px] font-semibold text-ink">{u.name}</span>
                  <Bar value={u.progress} className="bg-sky" />
                  <span className="text-[12.5px] tabular-nums text-sky-deep">Uploading · {u.progress}%</span>
                </div>
              </li>
            ))}

            {docs?.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                highlighted={doc.id === highlightId}
                onMore={() => sheet.open(doc)}
                onReprocess={() => onReprocess(doc.id)}
              />
            ))}
          </ul>
        )}

        {extra && <div className="px-4 py-3">{extra}</div>}

        {!isEmpty && (
          <StickyActionBar>
            <Button size="xl" className="min-h-14 flex-1" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={18} /> Add material
            </Button>
          </StickyActionBar>
        )}
      </div>

      <BottomSheet open={addOpen} onClose={closeAdd} title="Add material">
        <div className="flex flex-col gap-3 pb-1">
          <BigOption
            icon={<CameraIcon size={26} />}
            title={photos > 0 ? 'Take another photo' : 'Take a photo'}
            sub={photos > 0 ? 'One page at a time — as many as you like' : 'Notes, a whiteboard, a textbook page'}
            onClick={() => camRef.current?.click()}
            primary
          />
          <BigOption
            icon={<FolderIcon size={26} />}
            title="Choose from files"
            sub="PDF, markdown, text, CSV or images"
            onClick={() => fileRef.current?.click()}
          />
          {photos > 0 && (
            <div className="flex items-center gap-3 rounded-xl bg-mint-soft px-4 py-3" role="status">
              <Icon name="check" size={18} className="text-mint-deep" />
              <p className="min-w-0 flex-1 text-[15px] text-mint-deep">
                {photos} photo{photos === 1 ? '' : 's'} on the way. I’ll read {photos === 1 ? 'it' : 'them'} in the background.
              </p>
              <Button size="md" variant="secondary" onClick={closeAdd}>
                Done
              </Button>
            </div>
          )}
        </div>
      </BottomSheet>

      <ActionSheet
        open={sheet.target !== null}
        title={sheet.target?.name}
        onClose={sheet.close}
        actions={
          sheet.target
            ? [
                ...(sheet.target.status === 'processing' || sheet.target.status === 'failed'
                  ? [{ label: 'Reprocess', icon: 'refresh' as const, onSelect: () => onReprocess(sheet.target!.id) }]
                  : []),
                { label: 'Delete', icon: 'trash', danger: true, onSelect: () => onDelete(sheet.target!.id) },
              ]
            : []
        }
      />
    </div>
  )
}

function Bar({ value, className }: { value: number; className: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
      <div
        className={cn('h-full w-full origin-left t-meter duration-300', className)}
        style={{ transform: `scaleX(${Math.min(1, Math.max(0.03, value / 100))})` }}
      />
    </div>
  )
}

function BigOption({
  icon,
  title,
  sub,
  onClick,
  primary,
}: {
  icon: ReactNode
  title: string
  sub: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'phone-tap flex min-h-[76px] w-full items-center gap-4 rounded-2xl border-[1.5px] px-4 text-left active:translate-y-px',
        primary ? 'border-brand/50 bg-brand-soft' : 'border-line bg-surface active:bg-raised',
      )}
    >
      <span className={cn('grid size-12 shrink-0 place-items-center rounded-xl', primary ? 'bg-brand text-[#1a120f]' : 'bg-line-soft text-ink-3')}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[17px] font-bold text-ink">{title}</span>
        <span className="text-[14px] leading-snug text-muted">{sub}</span>
      </span>
    </button>
  )
}

function DocRow({
  doc,
  highlighted,
  onMore,
  onReprocess,
}: {
  doc: Document
  highlighted: boolean
  onMore: () => void
  onReprocess: () => void
}) {
  const meta = statusMeta[doc.status]
  const pending = doc.status === 'uploading' || doc.status === 'processing'
  const isImage = doc.mime_type?.startsWith('image/') ?? false
  const live = doc.status === 'processing' && typeof doc.progress === 'number' ? doc.progress : null
  const value = doc.status === 'ready' ? 100 : live !== null ? Math.max(4, Math.round(live * 100)) : 40
  // A photo is being *read* (transcribed), a document is being *indexed*.
  const note =
    doc.status === 'processing' && isImage
      ? 'Reading your photo'
      : doc.status === 'processing'
        ? 'Getting it ready'
        : doc.status === 'ready'
          ? isImage
            ? 'Read and ready'
            : 'Ready for questions'
          : meta.note
  const line = doc.error || (live !== null ? `${note} · ${Math.round(live * 100)}%` : note)

  return (
    <li
      id={doc.id}
      className={cn(
        'flex items-start gap-3 border-b border-line-soft py-3 pl-4 pr-1 scroll-mt-4',
        highlighted && 'bg-brand-tint',
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-line-soft text-ink-3">
        <Icon name={isImage ? 'doc' : fileIcon(doc.mime_type)} size={18} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[16px] font-semibold text-ink" title={doc.name}>
          {doc.name}
        </span>
        {pending && <Bar value={value} className={meta.barClass} />}
        <span
          className={cn(
            'flex items-center gap-1.5 text-[12.5px]',
            doc.status === 'failed' ? 'text-coral-deep' : doc.status === 'ready' ? 'text-mint-deep' : 'text-muted',
          )}
        >
          <Icon name={meta.icon} size={12} filled={doc.status === 'ready'} />
          <span className="min-w-0 truncate">{line}</span>
        </span>
        {doc.status === 'failed' && (
          <button
            type="button"
            onClick={onReprocess}
            className="phone-tap mt-0.5 flex min-h-11 w-fit items-center gap-1.5 rounded-xl bg-brand-soft px-4 text-[14px] font-bold text-brand-deep"
          >
            <Icon name="refresh" size={14} /> Try again
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onMore}
        aria-label={`More actions for ${doc.name}`}
        className="phone-tap -my-1 grid size-12 shrink-0 place-items-center text-faint active:bg-surface"
      >
        <Icon name="more" size={18} />
      </button>
    </li>
  )
}
