/**
 * Notes: list of notes on the left, editor on the right.
 *
 * Editing debounces to a PATCH after 800ms of idle typing. The last-known
 * server state is what the sidebar reflects; the editor edits its own local
 * copy to keep typing snappy.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { labelFor, notePreview, provenanceLabel, relativeTime, type Filter } from './format'
import { NoteEditor } from './NoteEditor'
import { createNote, deleteNote, generateNote, listAllNotes } from '../../api/notes'
import type { Note } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Select } from '../../components/ui/Select'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { Skeleton } from '../../components/ui/Skeleton'
import { Stagger } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { toneBar } from '../../lib/tone'
import { NoteBriefDialog } from '../chat/NoteBriefDialog'
import { SubspaceMissing } from '../spaces/SubspaceMissing'
import { useSpaces } from '../spaces/SpacesProvider'


export function NotesView() {
  const { space, subspace, base } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return <Inner subspaceId={subspace.id} base={base} />
}

function Inner({
  subspaceId,
  base,
}: {
  subspaceId: string
  /** Route prefix for this topic — citation links point inside it. */
  base: string
}) {
  const [params, setParams] = useSearchParams()
  const { show, showError } = useToast()
  const { spaces } = useSpaces()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(params.get('n'))
  const [filter, setFilter] = useState<Filter>('all')
  /** 'all' or a subject id — a subject rather than a name, so two subjects
   *  that happen to share a name still filter independently. */
  const [subjectFilter, setSubjectFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Below `lg:`, chat's dock — where "Write a note" otherwise lives — isn't
  // rendered at all (see `ContextDock`'s `ActiveAgentsStrip`), and the Notes
  // tab itself had no AI entry point at any width, unlike Quizzes/Flashcards'
  // own "Generate" buttons. Same dialog and the same `generateNote` call the
  // chat agent already uses — reached from a second place, not reimplemented.
  const [noteBriefOpen, setNoteBriefOpen] = useState(false)
  const [writingNote, setWritingNote] = useState(false)

  // Global on purpose: a note is a thing the student wrote, and it should be
  // reachable from anywhere they might want it, not hidden the moment they
  // navigate to a different topic. `subspaceId` still decides where a NEW
  // note is created (below), it just no longer decides what's visible.
  // Fetches once on mount — `selectedId` is deliberately not a dependency,
  // see the original note on this pattern in the git history.
  const refresh = useCallback(async () => {
    try {
      const data = await listAllNotes()
      setNotes(data)
      setError(null)
      setSelectedId((cur) => cur ?? data[0]?.id ?? null)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Which subject a note's subspace belongs to, and that subject's own
   *  accent tone — resolved from the sidebar's already-loaded space list
   *  (`useSpaces`) rather than a second fetch, since every note already
   *  carries its `subspace_id`. */
  const subspaceToSpace = useMemo(() => {
    const map = new Map<string, (typeof spaces)[number]>()
    for (const s of spaces) {
      for (const sub of s.subspaces) map.set(sub.id, s)
    }
    return map
  }, [spaces])

  const subjectOptions = useMemo(
    () => spaces.filter((s) => (notes ?? []).some((n) => n.subspace_id && subspaceToSpace.get(n.subspace_id)?.id === s.id)),
    [spaces, notes, subspaceToSpace],
  )

  const visible = useMemo(() => {
    if (!notes) return []
    return notes.filter((n) => {
      if (filter === 'ai' && !n.touched_by_agent) return false
      if (filter === 'mine' && !n.touched_by_user) return false
      if (subjectFilter !== 'all') {
        const space = n.subspace_id ? subspaceToSpace.get(n.subspace_id) : undefined
        if (space?.id !== subjectFilter) return false
      }
      if (search && !n.title.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [notes, filter, subjectFilter, subspaceToSpace, search])

  const current = notes?.find((n) => n.id === selectedId) ?? null

  /* Shown once there's more than one note to tell apart — even an all-AI or
   * all-mine topic still benefits from seeing "Mine 0" rather than the row
   * vanishing outright, which read as a bug rather than "none yet". */
  const showOriginFilter = (notes?.length ?? 0) > 1

  /** Selects a note AND writes it to the URL, so the two never disagree.
   *  `?n=` was previously only written on create, so reloading or sharing the
   *  page after clicking around reopened whichever note happened to be first. */
  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id)
      setParams(id ? { n: id } : {}, { replace: true })
    },
    [setParams],
  )

  const newBlank = async () => {
    try {
      const note = await createNote(subspaceId, {
        title: 'Untitled note',
        body_md: '',
        origin: 'user',
      })
      setNotes((prev) => (prev ? [note, ...prev] : [note]))
      select(note.id)
    } catch (err) {
      showError(err)
    }
  }

  const writeNote = async (input: { topic?: string; instructions?: string }) => {
    setWritingNote(true)
    try {
      const note = await generateNote(subspaceId, input)
      setNotes((prev) => (prev ? [note, ...prev] : [note]))
      select(note.id)
      setNoteBriefOpen(false)
      show('Note written.', 'success')
    } catch (err) {
      // Dialog stays open on failure, same as the chat agent's version of
      // this — a rate limit or dropped connection shouldn't cost the brief
      // the student just typed.
      showError(err)
    } finally {
      setWritingNote(false)
    }
  }

  const del = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteNote(confirmDelete)
      setNotes((prev) => (prev ? prev.filter((n) => n.id !== confirmDelete) : prev))
      if (selectedId === confirmDelete) {
        const rest = (notes ?? []).filter((n) => n.id !== confirmDelete)
        select(rest[0]?.id ?? null)
      }
      setConfirmDelete(null)
      show('Note deleted.', 'success')
    } catch (err) {
      showError(err)
    } finally {
      setDeleting(false)
    }
  }

  const applyPatch = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((prev) => (prev ? prev.map((n) => (n.id === id ? { ...n, ...patch } : n)) : prev))
  }, [])

  const loading = notes === null && !error
  const totalNotes = notes?.length ?? 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Still uses SubspaceHeader for the breadcrumb, title and actions row
          — but not its tab strip. Notes stopped being a per-topic screen
          (see the 2026-08 audit: it's an account-wide library now, reached
          from whichever topic happens to be open), so a row of five tabs
          implying "which of THIS topic's screens am I on" was actively
          misleading here. Chat/Docs keep theirs; they're still genuinely
          scoped to one topic. */}
      <SubspaceHeader
        title="Notes"
        tabs={false}
        actions={
          <div className="flex shrink-0 gap-1.5">
            {/* "Write with AI" (the fuller label) lives in the empty state
                below, where there's room. Here it's next to "New" in a
                header shared with the tab strip, so it stays compact. */}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setNoteBriefOpen(true)}
              aria-label="Write a note with AI"
              title="Write a note with AI"
            >
              <Icon name="sparkle" size={13} /> AI note
            </Button>
            <Button size="sm" onClick={newBlank}>
              <Icon name="plus" size={13} /> New
            </Button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
      {/* Master/detail. One pane at a time on phones: the list until you pick a
          note, then the editor (which offers its own way back). */}
      <aside
        className={cn(
          'w-full shrink-0 flex-col border-r border-line bg-well md:flex md:w-[288px]',
          current ? 'hidden' : 'flex',
        )}
      >
        <div className="flex flex-col gap-3 px-4 pb-3 pt-4">
          {/* Search and filters only exist once there is something to search or
              filter. On a fresh topic they were two dead controls above an
              empty state, which is three things saying "nothing here". */}
          {totalNotes > 0 && (
            <label className="relative flex items-center">
              <Icon
                name="search"
                size={13}
                className="pointer-events-none absolute left-2.5 text-faint"
              />
              <input
                placeholder="Search notes"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-[10px] border border-line bg-canvas py-1.5 pl-8 pr-2.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
              />
            </label>
          )}

          {showOriginFilter && (
            <div className="flex gap-1">
              {(['all', 'ai', 'mine'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  // AI and Mine count how many notes each PARTY has touched,
                  // not a three-way split of All — a note the AI wrote and
                  // you then edited counts in both, so AI + Mine can add up
                  // to more than All. The title spells that out on hover
                  // rather than leaving the mismatch looking like a bug.
                  title={
                    f === 'all'
                      ? 'Every note in this topic'
                      : f === 'ai'
                        ? 'Notes the AI has written or edited — some may also be yours'
                        : 'Notes you have written or edited — some may also be AI-written'
                  }
                  className={cn(
                    'flex-1 rounded-[8px] px-2 py-1 text-[11.5px] transition-colors cursor-pointer',
                    filter === f
                      ? 'bg-brand-soft font-bold text-brand-deep'
                      : 'text-muted hover:bg-line-soft hover:text-ink-3',
                  )}
                >
                  {labelFor(f, notes)}
                </button>
              ))}
            </div>
          )}

          {/* Only once notes span more than one subject — a single-subject
              library has nothing for this to narrow down. */}
          {subjectOptions.length > 1 && (
            <Select
              value={subjectFilter}
              onChange={setSubjectFilter}
              ariaLabel="Filter by subject"
              options={[
                { value: 'all', label: 'All subjects' },
                ...subjectOptions.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          )}
          {error && (
            <div className="flex flex-col items-start gap-2 p-4 text-xs text-coral-deep">
              <p>{error}</p>
              <Button size="sm" variant="secondary" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          )}
          {!loading && !error && totalNotes === 0 && (
            <div className="p-4">
              <EmptyState
                icon="note"
                title="No notes yet"
                description="Start a blank one, or have the AI write one from what's indexed here."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="secondary" onClick={() => setNoteBriefOpen(true)}>
                      <Icon name="sparkle" size={14} /> Write with AI
                    </Button>
                    <Button onClick={newBlank}>New note</Button>
                  </div>
                }
              />
            </div>
          )}
          {!loading && totalNotes > 0 && visible.length === 0 && (
            <p className="px-4 py-6 text-center text-[12.5px] text-muted">
              Nothing matches “{search}”.
            </p>
          )}
          {/* Deals itself in on load. `Stagger` keys on position, so typing in
              the search box refilters without re-animating the rows that
              survive the filter — the list settles once, then behaves like a
              list. */}
          {!loading && (
            <Stagger step={22} max={160}>
            {visible.map((item) => {
              const active = item.id === current?.id
              const preview = notePreview(item.body_md)
              return (
                <button
                  key={item.id}
                  onClick={() => select(item.id)}
                  className={cn(
                    'relative block w-full px-4 py-3 text-left transition-colors cursor-pointer',
                    active ? 'bg-surface' : 'hover:bg-surface/60',
                  )}
                >
                  {/* A rule, not a filled tint block — the selected row is
                      marked in the margin the way a page is, so the list still
                      reads as a list. */}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-y-0 left-0 w-[2px]',
                      active ? 'bg-brand' : 'bg-transparent',
                    )}
                  />
                  <div
                    className={cn(
                      'truncate text-[13px]',
                      active ? 'font-bold text-ink' : 'font-semibold text-ink-2',
                    )}
                  >
                    {item.title || 'Untitled note'}
                  </div>
                  {preview && (
                    <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted">
                      {preview}
                    </div>
                  )}
                  {/* Subject · Topic, with the subject's own accent as a small
                      bar rather than a full-colour badge — a cue, not a
                      second thing shouting for attention next to the title. */}
                  {(item.subject_name || item.subspace_name) && (
                    <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
                      <span
                        aria-hidden
                        className={cn(
                          'h-2.5 w-[3px] shrink-0 rounded-full',
                          item.subspace_id
                            ? toneBar[subspaceToSpace.get(item.subspace_id)?.tone ?? 'brand']
                            : 'bg-line',
                        )}
                      />
                      <span className="truncate">
                        {item.subject_name}
                        {item.subject_name && item.subspace_name ? ' · ' : ''}
                        {item.subspace_name}
                      </span>
                    </div>
                  )}
                  {/* Provenance is an icon + a tooltip, not a sentence in the
                      row — "CREATED BY AI · EDITED BY YOU" at setcode's
                      letter-spacing ran wider than the 288px sidebar itself,
                      wrapping mid-word and clipping. The badge alone still
                      says "AI was involved"; the exact story (created vs.
                      edited, by whom) is one hover away via `title`, the
                      same trade every icon-with-a-title in this app makes. */}
                  <div className="setcode mt-1.5 flex items-center gap-1.5">
                    {item.touched_by_agent && (
                      <span className="flex shrink-0 items-center gap-1" title={provenanceLabel(item)}>
                        <span className="relative inline-flex shrink-0">
                          <Icon name="note" size={9} className="text-sky-deep" />
                          <Icon
                            name="sparkle"
                            size={5}
                            filled
                            className="absolute -right-0.5 -top-0.5 text-sky-deep"
                          />
                        </span>
                        {/* A second, separate mark for "and a human has
                            too" — without it, an AI-created note you've
                            since rewritten looks identical to one nobody
                            has touched since the AI wrote it. Beside the
                            badge, not stacked on it — a third icon crammed
                            onto a 9px glyph stops reading as anything. */}
                        {item.touched_by_user && <Icon name="userEdit" size={10} className="text-brand-deep" />}
                      </span>
                    )}
                    <span className="truncate">{relativeTime(item.updated_at)}</span>
                  </div>
                </button>
              )
            })}
            </Stagger>
          )}
        </div>
      </aside>

      {loading ? (
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <PageSpinner label="Loading notes…" />
        </div>
      ) : !current ? (
        <div className="hidden min-w-0 flex-1 items-center justify-center p-6 md:flex">
          {/* Only prompts when there is something to pick. With zero notes the
              sidebar already shows "No notes yet" with the same New-note
              button, and rendering both put two competing empty states with
              two different messages on screen at once. */}
          {totalNotes > 0 ? (
            <EmptyState
              icon="note"
              title="Pick a note to read"
              description="Or create one — the editor autosaves as you type."
              action={<Button onClick={newBlank}>New note</Button>}
            />
          ) : null}
        </div>
      ) : (
        <NoteEditor
          key={current.id}
          note={current}
          subspaceId={subspaceId}
          base={base}
          onPatch={(patch) => applyPatch(current.id, patch)}
          onDelete={() => setConfirmDelete(current.id)}
          onBack={() => select(null)}
        />
      )}
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this note?"
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={del}
        destructive
        loading={deleting}
      />

      <NoteBriefDialog
        open={noteBriefOpen}
        busy={writingNote}
        onCancel={() => setNoteBriefOpen(false)}
        onGenerate={writeNote}
      />
    </div>
  )
}



// ── Helpers ────────────────────────────────────────────────────────────
