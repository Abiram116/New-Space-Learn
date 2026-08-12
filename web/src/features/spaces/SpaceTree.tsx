import { useEffect, useRef, useState } from 'react'
import { isOpenIn, toggleIn } from './treeState'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { Icon, type IconName } from '../../components/ui/Icon'
import { toneDot, toneText } from '../../lib/tone'
import { friendlyMessage } from '../../api/errors'
import { useToast } from '../../components/ui/Toast'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { subspacePath } from '../../lib/nav'
import { useSpaces } from './SpacesProvider'

export function SpaceTree({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { spaceId, subspaceId } = useParams()
  const {
    spaces,
    addSubspace,
    deleteSpace,
    deleteSubspace,
    renameSpace,
    renameSubspace,
    setPinned,
  } = useSpaces()
  const { show } = useToast()
  const navigate = useNavigate()

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [addingIn, setAddingIn] = useState<string | null>(null)
  const [newTopic, setNewTopic] = useState('')
  const [confirmDeleteSpace, setConfirmDeleteSpace] = useState<string | null>(null)
  const [confirmDeleteSubspace, setConfirmDeleteSubspace] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [renamingSpace, setRenamingSpace] = useState<string | null>(null)
  const [renamingSubspace, setRenamingSubspace] = useState<string | null>(null)
  // One buffer for both, because only one row can be in rename mode at a time —
  // opening a second rename closes the first by construction.
  const [renameText, setRenameText] = useState('')

  /* Both the reader and the writer come from `treeState`, which is the point:
     they used to be separate expressions with different ideas of the default,
     and that disagreement is what made an untouched subject take two clicks
     to open. See treeState.ts. */
  const isOpen = (id: string) => isOpenIn(collapsed, id, spaces, spaceId)
  const toggle = (id: string) =>
    setCollapsed((prev) => toggleIn(prev, id, spaces, spaceId))

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

  const commitRenameSubspace = async (id: string) => {
    const name = renameText.trim()
    setRenamingSubspace(null)
    const current = spaces.flatMap((s) => s.subspaces).find((sub) => sub.id === id)
    if (!name || name === current?.name) return
    try {
      await renameSubspace(id, name)
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
            <div className="group/row flex min-w-0 items-center">
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
              <RowMenu
                name={space.name}
                items={[
                  {
                    // The label says what the click DOES, not what the current
                    // state is — "Pin" on an unpinned subject, "Unpin" on a
                    // pinned one. A menu item labelled with its state makes you
                    // work out the verb yourself.
                    label: space.pinned ? 'Unpin' : 'Pin to top',
                    icon: 'pin',
                    iconFilled: space.pinned,
                    onSelect: async () => {
                      try {
                        await setPinned(space.id, !space.pinned)
                      } catch (e) {
                        show(friendlyMessage(e), 'error')
                      }
                    },
                  },
                  {
                    label: 'Rename',
                    icon: 'pencil',
                    onSelect: () => {
                      setRenamingSpace(space.id)
                      setRenameText(space.name)
                    },
                  },
                  {
                    label: 'Delete',
                    icon: 'trash',
                    destructive: true,
                    onSelect: () => setConfirmDeleteSpace(space.id),
                  },
                ]}
              />
            </div>

            {open && (
              <div className="ml-4 flex min-w-0 flex-col gap-0.5 border-l border-line pl-2.5">
                {space.subspaces.map((sub) => (
                  <div key={sub.id} className="group/row flex min-w-0 items-center">
                    {renamingSubspace === sub.id ? (
                      <input
                        autoFocus
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onBlur={() => commitRenameSubspace(sub.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRenameSubspace(sub.id)
                          if (e.key === 'Escape') setRenamingSubspace(null)
                        }}
                        aria-label={`Rename ${sub.name}`}
                        className="min-w-0 flex-1 rounded-[9px] border border-brand/50 bg-well px-2.5 py-1 text-[13px] text-ink outline-none"
                      />
                    ) : (
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
                    )}
                    {/* The same `⋯` as the subject row above, for the same
                        reason. This was a bare bin, which meant Delete was the
                        only thing a topic could do — while `renameSubspace`
                        already existed in the provider with no way to reach
                        it. A destructive action alone on a row also makes the
                        single most dangerous control the easiest to hit. */}
                    <RowMenu
                      name={sub.name}
                      items={[
                        {
                          label: 'Rename',
                          icon: 'pencil',
                          onSelect: () => {
                            setRenamingSubspace(sub.id)
                            setRenameText(sub.name)
                          },
                        },
                        {
                          label: 'Delete',
                          icon: 'trash',
                          destructive: true,
                          onSelect: () => setConfirmDeleteSubspace(sub.id),
                        },
                      ]}
                    />
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

export type RowAction = {
  label: string
  icon: IconName
  onSelect: () => void
  /** Renders in coral. For the one item that destroys something. */
  destructive?: boolean
  /** Solid rather than outline glyph — currently only a set pin. */
  iconFilled?: boolean
}

/**
 * The `⋯` actions menu on a tree row — subjects and topics both.
 *
 * Its own component so the open/close state is per-row rather than one shared
 * "which menu is open" id threaded through the tree — with one shared value,
 * opening a second menu has to remember to close the first, and that is the
 * bug this shape makes impossible.
 *
 * Takes its items as data rather than fixed props because subjects and topics
 * do not offer the same set: a subject can be pinned to the top of the rail, a
 * topic cannot. Two near-identical menu components is how the two rows drift
 * apart in spacing, hit area and keyboard behaviour, which is exactly the
 * duplication that put a 403/404 contradiction in `subspaces.py`.
 */
function RowMenu({ name, items }: { name: string; items: RowAction[] }) {
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
          'grid h-7 w-7 place-items-center rounded-md cursor-pointer',
          'transition-[opacity,background-color,color] duration-150',
          open ? 'bg-line-soft text-ink' : 'text-muted hover:bg-line-soft hover:text-ink',
          /* Quiet until you reach for it — but only where "reaching for it"
             is a thing that exists. A plain `opacity-0` is what made this
             control unreachable on a phone twice: no hover, no button, no way
             to rename or delete anything. `@media (hover: hover)` scopes the
             hiding to pointer devices; a touch screen keeps it visible. Focus
             and the open state both override, so keyboard users are fine too.
             `group-hover/row` is the shared hook both row types set. */
          '[@media(hover:hover)]:opacity-0',
          '[@media(hover:hover)]:group-hover/row:opacity-100',
          '[@media(hover:hover)]:focus-visible:opacity-100',
          open && '[@media(hover:hover)]:opacity-100',
        )}
      >
        <Icon name="more" size={15} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-50 w-40 rounded-[10px] border border-line bg-raised p-1 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)]"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px] transition-colors cursor-pointer',
                item.destructive
                  ? 'text-coral-deep hover:bg-coral-soft'
                  : 'text-ink-2 hover:bg-line-soft hover:text-ink',
              )}
            >
              <Icon name={item.icon} size={13} filled={item.iconFilled} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
