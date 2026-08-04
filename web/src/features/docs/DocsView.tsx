import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteDocument,
  listDocuments,
  reprocessDocument,
  uploadDocument,
} from '../../api/documents'
import type { Document } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
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
            <Button onClick={onPick}>+ Upload</Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {loading && <PageSpinner label="Loading documents…" />}

          {error && !loading && (
            <div className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
              {error}
            </div>
          )}

          {uploads.map((u) => (
            <div
              key={u.key}
              className="rounded-xl border-[1.5px] border-line bg-surface px-2.5 py-2.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <span>📤</span>
                <span className="truncate flex-1 text-muted">{u.name}</span>
                <span className="text-sky font-bold">{u.progress}%</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-line-soft">
                <div className="h-1 rounded-full bg-sky" style={{ width: `${u.progress}%` }} />
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

          {isEmpty && (
            <EmptyState
              icon="📄"
              title="No sources yet"
              description="Add a PDF, markdown, or plain-text file. Chunks get embedded so the AI can cite pages."
              action={<Button onClick={onPick}>Upload a file</Button>}
            />
          )}

          {!isEmpty && (
            <DashedCard className="bg-surface px-4 py-6 text-center text-[13px] text-muted">
              Drop PDFs / notes here
              <div className="mt-1 text-[11px] text-faint">
                chunked and embedded for citation-backed answers
              </div>
            </DashedCard>
          )}
        </div>
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
