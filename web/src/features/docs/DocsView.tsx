import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteDocument,
  listDocuments,
  reprocessDocument,
  uploadDocument,
} from '../../api/documents'
import { createSubspaceLink, deleteSubspaceLink, listSubspaceLinks } from '../../api/spaces'
import type { Document, Subspace } from '../../api/types'
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
import { useSpaces } from '../spaces/SpacesProvider'
import { SourceItem } from './SourceItem'

type LocalUpload = {
  key: string
  name: string
  progress: number
}

const POLL_MS = 2500
const POLL_TIMEOUT_MS = 60_000

export function DocsView() {
  const { space, subspace } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return <DocsInner subspaceId={subspace.id} />
}

function DocsInner({ subspaceId }: { subspaceId: string }) {
  const { show, showError } = useToast()
  const [docs, setDocs] = useState<Document[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<LocalUpload[]>([])
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<number | null>(null)

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

  // Poll while any doc is still being processed. Stops itself when everything
  // is ready/failed, and after a hard timeout to be nice to Render.
  useEffect(() => {
    if (!docs) return
    const pending = docs.some((d) => d.status === 'processing' || d.status === 'uploading')
    if (!pending) return
    const started = Date.now()
    pollRef.current = window.setInterval(() => {
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        if (pollRef.current) window.clearInterval(pollRef.current)
        pollRef.current = null
        return
      }
      void refresh()
    }, POLL_MS)
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
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
    try {
      await deleteDocument(deleteId)
      setDocs((prev) => (prev ? prev.filter((d) => d.id !== deleteId) : prev))
      setDeleteId(null)
      show('Document deleted.', 'success')
    } catch (err) {
      showError(err)
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

  const loading = docs === null && !error
  const isEmpty = docs !== null && docs.length === 0 && uploads.length === 0

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
              accept=".pdf,.md,.txt"
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

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6">
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
              description="Add a PDF, markdown, or plain-text file. It gets chunked and embedded so answers in this topic can cite pages."
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
                  <div
                    className="h-1 rounded-full bg-sky transition-all duration-300"
                    style={{ width: `${u.progress}%` }}
                  />
                </div>
              </div>
            ))}

            {docs?.map((doc) => (
              <SourceItem
                key={doc.id}
                doc={doc}
                detailed
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

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Delete this document?"
        description="Its chunks are removed from the knowledge base. Notes and chats stay."
        confirmLabel="Delete"
        onCancel={() => setDeleteId(null)}
        onConfirm={del}
        destructive
      />
    </div>
  )
}

/**
 * Explicit, opt-in links to other topics — never auto-inferred. When set,
 * chat in this topic also draws a little context from the linked one.
 */
function RelatedTopics({ subspaceId }: { subspaceId: string }) {
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
        const updated = await listSubspaceLinks(subspaceId)
        setLinks(updated)
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
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
        Related topics
      </span>
      {links.map((l) => (
        <span
          key={l.id}
          className="flex items-center gap-1.5 rounded-full border border-line bg-well px-2.5 py-1 text-[12.5px] text-ink-3"
        >
          {l.name}
          <button
            onClick={() => remove(l.id)}
            className="text-faint transition-colors hover:text-coral-deep cursor-pointer"
            aria-label={`Unlink ${l.name}`}
          >
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}
      <div className="relative">
        <button
          onClick={() => setPicking((v) => !v)}
          className="flex items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 text-[12.5px] text-faint transition-colors hover:border-brand hover:text-brand-deep cursor-pointer"
        >
          <Icon name="plus" size={11} /> Link a topic
        </button>
        {picking && (
          <div className="absolute left-0 top-[calc(100%+6px)] z-20 max-h-64 w-56 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lg">
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
