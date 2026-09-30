import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LIMITS } from '../../lib/limits'
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
  // Pressing Enter to confirm a rename calls `commitRename`, which clears
  // `renamingSpace` synchronously — that unmounts the input, and removing a
  // focused element fires a native blur, which is *also* wired to
  // `commitRename` (`onBlur`). Both calls read the same still-in-scope
  // `renameText`/`id`, so without this guard every Enter-confirmed rename
  // fired the PATCH twice. Set add happens before the first `await`, so the
  // blur-triggered second call (which runs after React flushes the render
  // that removed the input) sees the id already in flight and returns.
  const committingRename = useRef<Set<string>>(new Set())

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
    if (committingRename.current.has(id)) return
    committingRename.current.add(id)
    try {
      const name = renameText.trim()
      setRenamingSpace(null)
      const current = spaces.find((s) => s.id === id)
      if (!name || name === current?.name) return
      await renameSpace(id, name)
    } catch (e) {
      show(friendlyMessage(e), 'error')
    } finally {
      committingRename.current.delete(id)
    }
  }

  const commitRenameSubspace = async (id: string) => {
    if (committingRename.current.has(id)) return
    committingRename.current.add(id)
    try {
      const name = renameText.trim()
      setRenamingSubspace(null)
      const current = spaces.flatMap((s) => s.subspaces).find((sub) => sub.id === id)
      if (!name || name === current?.name) return
      await renameSubspace(id, name)
    } catch (e) {
      show(friendlyMessage(e), 'error')
    } finally {
      committingRename.current.delete(id)
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
    <div className="flex min-w-0 flex-col gap-1 text-[15px]">
      {spaces.map((space) => {
        const open = isOpen(space.id)
        return (
          <div key={space.id} className="group/space flex min-w-0 flex-col gap-1">
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
                  maxLength={LIMITS.spaceName}
                  aria-label={`Rename ${space.name}`}
                  className="min-h-10 min-w-0 flex-1 rounded-[10px] border border-brand/50 bg-well px-3 text-[15px] font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
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
                  'flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5 py-2 text-left transition-colors cursor-pointer pointer-coarse:min-h-11',
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
                  <Icon name="chevronRight" size={14} />
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
              <div className="ml-[18px] flex min-w-0 flex-col gap-1 border-l border-line pl-2.5">
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
                        maxLength={LIMITS.subspaceName}
                  aria-label={`Rename ${sub.name}`}
                        className="min-h-10 min-w-0 flex-1 rounded-[10px] border border-brand/50 bg-well px-3 text-[14px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                      />
                    ) : (
                      <NavLink
                        to={subspacePath(space, sub)}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cn(
                            'flex min-h-10 min-w-0 flex-1 items-center rounded-[10px] px-2.5 py-2 text-[14.5px] transition-colors pointer-coarse:min-h-11',
                            isActive
                              ? 'bg-brand-soft font-bold text-brand-deep'
                              : 'font-medium text-ink-2 hover:bg-line-soft hover:text-ink',
                          )
                        }
                      >
                        <span className="truncate">{sub.name}</span>
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
                    maxLength={LIMITS.subspaceName}
                    placeholder="New topic"
                    className="min-h-10 min-w-0 rounded-[10px] border border-brand/50 bg-well px-3 text-[14px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setAddingIn(space.id)
                      setNewTopic('')
                    }}
                    className="flex min-h-10 items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[14px] text-muted transition-colors hover:bg-line-soft hover:text-brand cursor-pointer pointer-coarse:min-h-11"
                  >
                    <Icon name="plus" size={14} /> Add topic
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
  // Where the menu sits, in viewport coordinates. It is rendered through a
  // portal with `position: fixed` because the rail's list clips overflow —
  // an absolutely-positioned menu on the last few rows was cut off or forced
  // the list to scroll.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true)
    }
    const dismiss = () => setOpen(false)
    // `mousedown`, not `click`: a click that lands on another row would
    // otherwise activate that row *and* leave this menu open behind it.
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [open])

  // Focus lands on the first item when the menu opens, so the keyboard flow is
  // trigger -> Enter -> arrows -> Enter, and Escape hands focus back.
  useEffect(() => {
    if (open && pos) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open, pos])

  const toggle = () => {
    if (open) return close(false)
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const menuHeight = items.length * 44 + 10
      const below = rect.bottom + 4
      // Flip upward when there is no room below (last rows in a short window).
      const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, rect.top - 4 - menuHeight) : below
      setPos({ top, right: Math.max(8, window.innerWidth - rect.right) })
    }
    setOpen(true)
  }

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const at = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      els[(at + 1) % els.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      els[(at - 1 + els.length) % els.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      els[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      els[els.length - 1]?.focus()
    } else if (e.key === 'Tab') {
      // A menu is not a place to tab through; leaving it closes it.
      setOpen(false)
    }
  }

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name}`}
        title={`Actions for ${name}`}
        className={cn(
          // 40px square on every device — the ⋯ is the only way to rename or
          // delete, so it is never a small target.
          'grid h-10 w-10 place-items-center rounded-[10px] cursor-pointer pointer-coarse:h-11 pointer-coarse:w-11',
          'transition-[opacity,background-color,color] duration-150',
          open ? 'bg-line-soft text-ink' : 'text-muted hover:bg-line-soft hover:text-ink',
          /* Quiet until you reach for it — but only where "reaching for it"
             exists. `pointer-fine` scopes the hiding to mouse/trackpad; a
             touch screen (coarse pointer) always shows it, which is what
             makes rename/delete reachable on a phone. Hover on the row,
             keyboard focus anywhere inside it, or an open menu all reveal it
             on desktop. `group/row` is the shared hook both row types set. */
          'pointer-fine:opacity-0',
          'pointer-fine:group-hover/row:opacity-100',
          'pointer-fine:group-has-[:focus-visible]/row:opacity-100',
          'pointer-fine:focus-visible:opacity-100',
          open && 'pointer-fine:opacity-100',
        )}
      >
        <Icon name="more" size={18} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions for ${name}`}
            onKeyDown={onMenuKey}
            style={{ top: pos.top, right: pos.right }}
            // Same entrance as every other popover in the app (Select's
            // dropdown, Modal, the note editor's floating panels) — one family
            // for "a small panel now exists here" rather than a silent pop.
            className="fixed z-50 w-52 rounded-[12px] border border-line bg-raised p-1 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)] motion-safe:animate-[dockSwap_140ms_var(--ease-sl)_both]"
          >
            {items.map((item, i) => (
              <div key={item.label}>
                {/* Destructive item sits behind a rule: it is never adjacent to
                    the everyday actions above it. */}
                {item.destructive && i > 0 && <div className="mx-1 my-1 border-t border-line" />}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close(false)
                    item.onSelect()
                  }}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left text-[14px] transition-colors cursor-pointer md:min-h-10 pointer-coarse:min-h-11',
                    item.destructive
                      ? 'text-coral-deep hover:bg-coral-soft focus-visible:bg-coral-soft'
                      : 'text-ink-2 hover:bg-line-soft hover:text-ink focus-visible:bg-line-soft',
                  )}
                >
                  <Icon name={item.icon} size={16} filled={item.iconFilled} />
                  {item.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
