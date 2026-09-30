import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  deleteDocument,
  listDocuments,
  reprocessDocument,
  uploadDocument,
} from '../../api/documents'
import type { Document } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { Icon } from '../../components/ui/Icon'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DashedCard } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { useToast } from '../../components/ui/Toast'
import { useActiveSubspace } from '../../lib/nav'
import { cn } from '../../lib/cn'
import { SubspaceMissing } from '../spaces/SubspaceMissing'
import { RelatedTopics } from '../spaces/RelatedTopics'
import { SourceItem } from './SourceItem'
import { useIsMobile } from '../../lib/useIsMobile'
import { PhoneDocs, type LocalUpload } from './PhoneDocs'

const POLL_MS = 2500
const POLL_MAX_MS = 10_000
const POLL_TIMEOUT_MS = 15 * 60_000

export function DocsView() {
  const { space, subspace } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return <DocsInner subspaceId={subspace.id} />
}

function DocsInner({ subspaceId }: { subspaceId: string }) {
  const { show, showError } = useToast()
  const isMobile = useIsMobile()
  const [docs, setDocs] = useState<Document[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<LocalUpload[]>([])
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<number | null>(null)
  // A citation link (`notes/format.ts`'s `sourceLine`) reads `?d=<id>` to
  // point back at the exact source a claim came from. Captured into state
  // rather than read from `params` on every render, for two reasons: the
  // highlight must survive the param being cleared from the URL (below), and
  // it must also pick up a *second* citation click while already on this
  // tab, which changes `params` without remounting the component.
  const [params, setParams] = useSearchParams()
  const [highlightId, setHighlightId] = useState<string | null>(null)

  useEffect(() => {
    const d = params.get('d')
    if (!d) return
    setHighlightId(d)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('d')
      return next
    }, { replace: true })
  }, [params, setParams])

  // `?add=1` — "add material" straight from somewhere else (Today's checklist,
  // a share target). On a phone it opens the Add sheet; the param is cleared so a
  // refresh or Back doesn't re-open it. Wide screens just drop it.
  const [addSignal, setAddSignal] = useState(0)
  useEffect(() => {
    if (params.get('add') !== '1') return
    if (isMobile) setAddSignal((n) => n + 1)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('add')
      return next
    }, { replace: true })
  }, [params, setParams, isMobile])

  useEffect(() => {
    if (!docs || !highlightId) return
    document.getElementById(highlightId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [docs, highlightId])

  const refresh = useCallback(async () => {
    try {
      const data = await listDocuments(subspaceId)
      setDocs(data)
      setError(null)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }, [subspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll while any doc is still being processed, backing off from 2.5s to
  // 10s. Ingestion runs in the background and a long PDF can take minutes on
  // the free-tier backend, so the cap is generous. `pollStart` is a ref: this
  // effect re-runs after every refresh (it depends on `docs`), and a start
  // time kept inside it reset on every poll — the old 60s cap never fired.
  const pollStart = useRef<number | null>(null)
  useEffect(() => {
    if (!docs) return
    const pending = docs.some((d) => d.status === 'processing' || d.status === 'uploading')
    if (!pending) {
      pollStart.current = null
      return
    }
    pollStart.current ??= Date.now()
    const elapsed = Date.now() - pollStart.current
    if (elapsed > POLL_TIMEOUT_MS) return
    const delay = Math.min(POLL_MAX_MS, POLL_MS * 2 ** Math.floor(elapsed / 30_000))
    pollRef.current = window.setTimeout(() => void refresh(), delay)
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }, [docs, refresh])

  const startUpload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      for (const file of list) {
        const key = `${file.name}-${file.size}-${Date.now()}`
        setUploads((prev) => [...prev, { key, name: file.name, progress: 0 }])
        try {
          const doc = await uploadDocument(subspaceId, file, (p) =>
            setUploads((prev) =>
              prev.map((u) => (u.key === key ? { ...u, progress: p } : u)),
            ),
          )
          setUploads((prev) => prev.filter((u) => u.key !== key))
          setDocs((prev) => (prev ? [doc, ...prev] : [doc]))
        } catch (err) {
          setUploads((prev) => prev.filter((u) => u.key !== key))
          showError(err)
        }
      }
    },
    [subspaceId, showError],
  )

  const onPick = () => fileRef.current?.click()

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer.files.length > 0) void startUpload(e.dataTransfer.files)
    },
    [startUpload],
  )

  const del = useCallback(async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      await deleteDocument(deleteId)
      setDocs((prev) => (prev ? prev.filter((d) => d.id !== deleteId) : prev))
      setDeleteId(null)
      show('Document deleted.', 'success')
    } catch (err) {
      // Unlike notes/decks/skills, `DELETE /documents/{id}` 404s if the row
      // is already gone rather than being a silent no-op — without the
      // `loading` guard below, a fast double-click on "Delete" fired this
      // twice and showed "Document not found" right after the toast
      // confirming a successful delete.
      showError(err)
    } finally {
      setDeleting(false)
    }
  }, [deleteId, show, showError])

  const reprocess = useCallback(
    async (id: string) => {
      try {
        const updated = await reprocessDocument(id)
        setDocs((prev) => (prev ? prev.map((d) => (d.id === id ? updated : d)) : prev))
        show('Reprocessing…', 'info')
      } catch (err) {
        showError(err)
      }
    },
    [show, showError],
  )

  const deleteDialog = (
    <ConfirmDialog
      open={Boolean(deleteId)}
      title="Delete this document?"
      description="Its chunks are removed from the knowledge base. Notes and chats stay."
      confirmLabel="Delete"
      onCancel={() => setDeleteId(null)}
      onConfirm={del}
      destructive
      loading={deleting}
    />
  )

  const loading = docs === null && !error
  const isEmpty = docs !== null && docs.length === 0 && uploads.length === 0

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PhoneDocs
          docs={docs}
          uploads={uploads}
          loading={loading}
          error={error}
          highlightId={highlightId}
          openAddSignal={addSignal}
          onFiles={(files) => void startUpload(files)}
          onDelete={setDeleteId}
          onReprocess={(id) => void reprocess(id)}
          extra={<RelatedTopics subspaceId={subspaceId} />}
        />
        {deleteDialog}
      </div>
    )
  }

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col', dragging && 'ring-4 ring-brand ring-offset-4 ring-offset-canvas')}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <SubspaceHeader
        title="Documents"
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.md,.txt,.csv,.png,.jpg,.jpeg,.webp"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && startUpload(e.target.files)}
            />
            <Button onClick={onPick}>
              <Icon name="upload" size={14} /> Upload
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-6">
        <RelatedTopics subspaceId={subspaceId} />

        {loading && <PageSpinner label="Loading documents…" />}

        {error && !loading && (
          <div className="rounded-xl border border-coral/30 bg-coral-soft px-4 py-3 text-sm text-coral-deep">
            {error}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-1 items-center justify-center py-6">
            <EmptyState
              className="w-full max-w-lg"
              icon="doc"
              title="No sources yet"
              description="Add a PDF, markdown, plain-text, CSV, or image file. It gets chunked and embedded so answers in this topic can cite pages."
              action={
                <Button size="lg" onClick={onPick}>
                  <Icon name="upload" size={15} /> Upload a file
                </Button>
              }
            />
          </div>
        )}

        {!isEmpty && !loading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {uploads.map((u) => (
              <div
                key={u.key}
                className="cardstock flex flex-col gap-2.5 rounded-xl p-3.5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-sky-soft text-sky-deep">
                    <Icon name="upload" size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink-3">
                    {u.name}
                  </span>
                  <span className="setcode shrink-0 text-sky-deep">{u.progress}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-line-soft">
                  {/* Scaled, not resized. `width` animates layout on every
                      frame; a transform composites. The track above owns the
                      rounding and clips the overflow, so the fill can be a
                      plain rectangle whose corners never squash. */}
                  <div
                    className="h-1 w-full origin-left bg-sky t-meter duration-300"
                    style={{ transform: `scaleX(${u.progress / 100})` }}
                  />
                </div>
              </div>
            ))}

            {docs?.map((doc) => (
              <SourceItem
                key={doc.id}
                doc={doc}
                detailed
                highlighted={doc.id === highlightId}
                onDelete={() => setDeleteId(doc.id)}
                onReprocess={() => reprocess(doc.id)}
              />
            ))}

            <DashedCard
              onClick={onPick}
              className="flex min-h-[124px] cursor-pointer flex-col items-center justify-center gap-2 p-3.5 text-[13px] text-muted transition-colors hover:border-brand/50 hover:text-brand-deep"
            >
              <Icon name="upload" size={20} />
              Drop files, or click to browse
            </DashedCard>
          </div>
        )}
      </div>

      {deleteDialog}
    </div>
  )
}

