import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { Icon } from '../../components/ui/Icon'
import { toneDot, toneText } from '../../lib/tone'
import { friendlyMessage } from '../../api/errors'
import { useToast } from '../../components/ui/Toast'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { subspacePath } from '../../lib/nav'
import { useSpaces } from './SpacesProvider'

export function SpaceTree({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { spaceId, subspaceId } = useParams()
  const { spaces, addSubspace, deleteSpace, deleteSubspace, renameSpace, setPinned } =
    useSpaces()
  const { show } = useToast()
  const navigate = useNavigate()

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [addingIn, setAddingIn] = useState<string | null>(null)
  const [newTopic, setNewTopic] = useState('')
  const [confirmDeleteSpace, setConfirmDeleteSpace] = useState<string | null>(null)
  const [confirmDeleteSubspace, setConfirmDeleteSubspace] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [renamingSpace, setRenamingSpace] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')

  const toggle = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }))

  const isOpen = (id: string) => {
    const explicit = collapsed[id]
    if (explicit !== undefined) return !explicit
    const space = spaces.find((s) => s.id === id)
    // Defaults open when there's nothing to collapse — an empty subject's
    // only useful state is "show me how to add a topic", not a closed row
    // that gives no hint anything is missing.
    return id === spaceId || space?.subspaces.length === 0
  }

  const commitTopic = async (spaceId: string) => {
    const name = newTopic.trim()
    if (!name) {
      setAddingIn(null)
      return
    }
    try {
      const created = await addSubspace(spaceId, name)
      setAddingIn(null)
      setNewTopic('')
      const parent = spaces.find((s) => s.id === spaceId)
      navigate(parent ? subspacePath(parent, created) : `/s/${spaceId}/${created.id}`)
    } catch (e) {
      show(friendlyMessage(e), 'error')
    }
  }

  const commitRename = async (id: string) => {
    const name = renameText.trim()
    setRenamingSpace(null)
    const current = spaces.find((s) => s.id === id)
    if (!name || name === current?.name) return
    try {
      await renameSpace(id, name)
    } catch (e) {
      show(friendlyMessage(e), 'error')
    }
  }

  const removeSpace = async (id: string) => {
    setBusy(true)
    try {
      await deleteSpace(id)
      if (spaceId === id) navigate('/', { replace: true })
      setConfirmDeleteSpace(null)
    } catch (e) {
      show(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeSubspace = async (id: string) => {
    setBusy(true)
    try {
      await deleteSubspace(id)
      if (subspaceId === id) {
        // There is no route for a bare `/s/:spaceId` — only `/s/:spaceId/:subspaceId`
        // — so sending the user there after deleting the topic they were looking at
        // dropped them straight onto NotFound. Land on a sibling topic when the
        // subject still has one, otherwise Home.
        const parent = spaces.find((s) => s.id === spaceId)
        const sibling = parent?.subspaces.find((sub) => sub.id !== id)
        navigate(parent && sibling ? subspacePath(parent, sibling) : '/home', {
          replace: true,
        })
      }
      setConfirmDeleteSubspace(null)
    } catch (e) {
      show(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-[14.5px]">
      {spaces.map((space) => {
        const open = isOpen(space.id)
        return (
          <div key={space.id} className="group/space flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center">
              {renamingSpace === space.id ? (
                <input
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => commitRename(space.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(space.id)
                    if (e.key === 'Escape') setRenamingSpace(null)
                  }}
                  aria-label={`Rename ${space.name}`}
                  className="min-w-0 flex-1 rounded-[10px] border border-brand/50 bg-well px-2.5 py-1.5 text-[14px] font-semibold text-ink outline-none"
                />
              ) : (
              <button
                onClick={() => toggle(space.id)}
                className={cn(
                  // `min-w-0` is load-bearing, not decoration. A flex item
                  // defaults to `min-width: auto`, so without it this button
                  // refuses to shrink below its own text width — `truncate`
                  // never engages, and a long subject name pushes the ⋯ menu
                  // straight past the rail's `overflow-x-hidden` edge. That
                  // is why the menu appeared on "dfcs" and not on
                  // "Reinforcment Learning": the bug was name length.
                  'flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-colors cursor-pointer',
                  space.id === spaceId
                    ? 'bg-brand-tint font-bold text-ink'
                    : cn('font-semibold hover:bg-line-soft', toneText[space.tone]),
                )}
              >
                <span
                  className={cn(
                    'shrink-0 transition-transform duration-150',
                    open ? 'rotate-90 text-brand' : 'text-faint',
                  )}
                >
                  <Icon name="chevronRight" size={13} />
                </span>
                <span className={cn('h-3.5 w-1 shrink-0 rounded-full', toneDot[space.tone])} />
                <span className="truncate">{space.name}</span>
              </button>
              )}
              {/* A `⋯` menu, not a bare bin.
                  Two earlier attempts at this button both failed the same
                  way — `opacity-0` until hover meant it did not exist on a
                  touch screen, and the `opacity-40` replacement measured
                  1.89:1 against this background, under half the 3:1 WCAG
                  floor for an icon: present in the DOM, invisible in
                  practice. A `⋯` is the one affordance every user already
                  reads as "more actions here", it holds Rename as well as
                  Delete, and it stays legible because it is drawn in a solid
                  colour rather than faded into the background. */}
              <SpaceMenu
                name={space.name}
                pinned={space.pinned}
                onTogglePin={async () => {
                  try {
                    await setPinned(space.id, !space.pinned)
                  } catch (e) {
                    show(friendlyMessage(e), 'error')
                  }
                }}
                onRename={() => {
                  setRenamingSpace(space.id)
                  setRenameText(space.name)
                }}
                onDelete={() => setConfirmDeleteSpace(space.id)}
              />
            </div>

            {open && (
              <div className="ml-4 flex min-w-0 flex-col gap-0.5 border-l border-line pl-2.5">
                {space.subspaces.map((sub) => (
                  <div key={sub.id} className="group/sub flex min-w-0 items-center">
                    <NavLink
                      to={subspacePath(space, sub)}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'min-w-0 flex-1 truncate rounded-[9px] px-2.5 py-1.5 transition-colors',
                          isActive
                            ? 'bg-brand-soft font-bold text-brand-deep'
                            : 'font-medium text-ink-2 hover:bg-line-soft hover:text-ink',
                        )
                      }
                    >
                      {sub.name}
                    </NavLink>
                    <button
                      onClick={() => setConfirmDeleteSubspace(sub.id)}
                      aria-label={`Delete topic ${sub.name}`}
                      /* Same reasoning as the subject delete above. */
                      className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-coral-soft hover:text-coral-deep focus-visible:bg-coral-soft focus-visible:text-coral-deep cursor-pointer"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                ))}

                {addingIn === space.id ? (
                  <input
                    autoFocus
                    value={newTopic}
                    onChange={(e) => setNewTopic(e.target.value)}
                    onBlur={() => commitTopic(space.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitTopic(space.id)
                      if (e.key === 'Escape') {
                        setAddingIn(null)
                        setNewTopic('')
                      }
                    }}
                    placeholder="New topic"
                    className="min-w-0 rounded-[9px] border border-brand/50 bg-well px-2.5 py-1 text-[13px] text-ink outline-none"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setAddingIn(space.id)
                      setNewTopic('')
                    }}
                    className="flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-left text-faint transition-colors hover:text-brand cursor-pointer"
                  >
                    <Icon name="plus" size={13} /> add topic
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      <ConfirmDialog
        open={Boolean(confirmDeleteSpace)}
        title="Delete this space?"
        description="Everything inside it — topics, chats, notes, cards, quizzes — will be permanently deleted."
        confirmLabel="Delete"
        onCancel={() => setConfirmDeleteSpace(null)}
        onConfirm={() => confirmDeleteSpace && removeSpace(confirmDeleteSpace)}
        destructive
        loading={busy}
      />
      <ConfirmDialog
        open={Boolean(confirmDeleteSubspace)}
        title="Delete this topic?"
        description="All chats, notes, cards, and quizzes for this topic will be removed."
        confirmLabel="Delete"
        onCancel={() => setConfirmDeleteSubspace(null)}
        onConfirm={() => confirmDeleteSubspace && removeSubspace(confirmDeleteSubspace)}
        destructive
        loading={busy}
      />
    </div>
  )
}

/**
 * The `⋯` actions menu on a subject row.
 *
 * Its own component so the open/close state is per-row rather than one shared
 * "which menu is open" id threaded through the tree — with one shared value,
 * opening a second menu has to remember to close the first, and that is the
 * bug this shape makes impossible.
 */
function SpaceMenu({
  name,
  pinned,
  onTogglePin,
  onRename,
  onDelete,
}: {
  name: string
  pinned: boolean
  onTogglePin: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // `mousedown`, not `click`: a click that lands on another row would
    // otherwise activate that row *and* leave this menu open behind it.
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name}`}
        title={`Actions for ${name}`}
        className={cn(
          'grid h-7 w-7 place-items-center rounded-md transition-colors cursor-pointer',
          open ? 'bg-line-soft text-ink' : 'text-muted hover:bg-line-soft hover:text-ink',
        )}
      >
        <Icon name="more" size={15} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-50 w-40 rounded-[10px] border border-line bg-raised p-1 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onTogglePin()
            }}
            className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px] text-ink-2 transition-colors cursor-pointer hover:bg-line-soft hover:text-ink"
          >
            {/* The label says what the click DOES, not what the current
                state is — "Pin" on an unpinned subject, "Unpin" on a pinned
                one. A menu item labelled with its state makes you work out
                the verb yourself. */}
            <Icon name="pin" size={13} filled={pinned} />
            {pinned ? 'Unpin' : 'Pin to top'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onRename()
            }}
            className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px] text-ink-2 transition-colors cursor-pointer hover:bg-line-soft hover:text-ink"
          >
            <Icon name="pencil" size={13} /> Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
            className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px] text-coral-deep transition-colors cursor-pointer hover:bg-coral-soft"
          >
            <Icon name="trash" size={13} /> Delete
          </button>
        </div>
      )}
    </div>
  )
}
