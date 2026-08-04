import { useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { toneDot } from '../../lib/tone'
import { friendlyMessage } from '../../api/errors'
import { useToast } from '../../components/ui/Toast'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useSpaces } from './SpacesProvider'

export function SpaceTree() {
  const { spaceId, subspaceId } = useParams()
  const { spaces, addSubspace, deleteSpace, deleteSubspace } = useSpaces()
  const { show } = useToast()
  const navigate = useNavigate()

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [addingIn, setAddingIn] = useState<string | null>(null)
  const [newTopic, setNewTopic] = useState('')
  const [confirmDeleteSpace, setConfirmDeleteSpace] = useState<string | null>(null)
  const [confirmDeleteSubspace, setConfirmDeleteSubspace] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const toggle = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }))

  const isOpen = (id: string) => {
    const explicit = collapsed[id]
    if (explicit !== undefined) return !explicit
    return id === spaceId
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
      navigate(`/s/${spaceId}/${created.id}`)
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
      if (subspaceId === id) navigate(spaceId ? `/s/${spaceId}` : '/', { replace: true })
      setConfirmDeleteSubspace(null)
    } catch (e) {
      show(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-0.5 text-[13.5px]">
      {spaces.map((space) => {
        const open = isOpen(space.id)
        return (
          <div key={space.id} className="group/space flex flex-col gap-0.5">
            <div className="flex items-center">
              <button
                onClick={() => toggle(space.id)}
                className={cn(
                  'flex flex-1 items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-colors cursor-pointer',
                  space.id === spaceId
                    ? 'bg-brand-tint font-semibold text-ink'
                    : 'text-ink-3 hover:bg-line-soft',
                )}
              >
                <span className={cn('text-[11px]', open ? 'text-brand' : 'text-faint')}>
                  {open ? '▾' : '▸'}
                </span>
                <span className={cn('h-2 w-2 rounded-[3px]', toneDot[space.tone])} />
                <span className="truncate">{space.name}</span>
              </button>
              <button
                onClick={() => setConfirmDeleteSpace(space.id)}
                title="Delete space"
                aria-label={`Delete space ${space.name}`}
                className="opacity-0 group-hover/space:opacity-100 rounded-md px-1 text-xs text-faint hover:text-coral-deep transition-opacity cursor-pointer"
              >
                ⋯
              </button>
            </div>

            {open && (
              <div className="ml-5 flex flex-col gap-0.5 border-l-[1.5px] border-line pl-2.5">
                {space.subspaces.map((sub) => (
                  <div key={sub.id} className="group/sub flex items-center">
                    <NavLink
                      to={`/s/${space.id}/${sub.id}`}
                      className={({ isActive }) =>
                        cn(
                          'flex-1 rounded-[9px] px-2.5 py-1.5 truncate transition-colors',
                          isActive
                            ? 'bg-brand-soft font-semibold text-brand'
                            : 'text-ink-3 hover:bg-line-soft',
                        )
                      }
                    >
                      {sub.name}
                    </NavLink>
                    <button
                      onClick={() => setConfirmDeleteSubspace(sub.id)}
                      aria-label={`Delete topic ${sub.name}`}
                      className="opacity-0 group-hover/sub:opacity-100 rounded-md px-1 text-xs text-faint hover:text-coral-deep transition-opacity cursor-pointer"
                    >
                      ⋯
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
                    className="rounded-[9px] border-[1.5px] border-brand-200 bg-surface px-2.5 py-1 text-[13px] outline-none"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setAddingIn(space.id)
                      setNewTopic('')
                    }}
                    className="rounded-[9px] px-2.5 py-1.5 text-left text-faint transition-colors hover:text-brand cursor-pointer"
                  >
                    + add topic
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
