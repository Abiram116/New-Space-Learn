/**
 * The phone's topic switcher — what the desktop rail's subject tree becomes.
 *
 * A bottom sheet listing subjects, each with its topics. Picking a topic
 * keeps you on the same kind of page (Cards stays Cards) or, from Today,
 * opens the topic's hub. Creating things happens in here too: "New topic"
 * inline under a subject, "New subject" in the footer — so the phone never
 * needs the rail's drawer.
 *
 * Renaming, pinning and deleting stay with the desktop rail. On a phone
 * they're rare, destructive, and not what a revision session is for.
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/errors'
import type { Space, Subspace } from '../../api/types'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { LIMITS } from '../../lib/limits'
import { subspacePath } from '../../lib/nav'
import { toneDot } from '../../lib/tone'
import { NewSpaceModal } from '../spaces/NewSpaceModal'
import { useSpaces } from '../spaces/SpacesProvider'
import { switchTarget } from './phoneNav'

export function TopicSwitcher({
  open,
  onClose,
  currentId,
}: {
  open: boolean
  onClose: () => void
  /** The topic the shell considers current, marked with a check. */
  currentId: string | null
}) {
  const { spaces, loading, error, refresh } = useSpaces()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [newSubjectOpen, setNewSubjectOpen] = useState(false)
  // A subject just created from here: once its first topic shows up in the
  // list, go to it — the student made it to study it.
  const [pendingSpace, setPendingSpace] = useState<string | null>(null)

  useEffect(() => {
    if (!pendingSpace) return
    const space = spaces.find((s) => s.id === pendingSpace)
    if (!space) return
    setPendingSpace(null)
    const first = space.subspaces[0]
    navigate(first ? subspacePath(space, first) : '/home')
  }, [pendingSpace, spaces, navigate])

  const pick = (space: Space, sub: Subspace) => {
    onClose()
    const target = switchTarget(pathname, subspacePath(space, sub))
    if (target !== pathname) navigate(target)
  }

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title="Topics"
        footer={
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => {
              onClose()
              setNewSubjectOpen(true)
            }}
          >
            <Icon name="plus" size={17} /> New subject
          </Button>
        }
      >
        {loading && spaces.length === 0 ? (
          <div className="flex flex-col gap-2 py-2" aria-label="Loading topics">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : error && spaces.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-3">
            <p className="text-[15px] text-muted">{error}</p>
            <Button variant="secondary" onClick={() => void refresh()}>
              Try again
            </Button>
          </div>
        ) : spaces.length === 0 ? (
          <div className="py-4">
            <p className="text-[16px] font-semibold text-ink">No subjects yet</p>
            <p className="mt-1 text-[15px] leading-relaxed text-muted">
              A subject holds topics, and a topic holds your files. Start one below.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5 pb-1">
            {spaces.map((space) => (
              <SubjectGroup
                key={space.id}
                space={space}
                currentId={currentId}
                onPick={(sub) => pick(space, sub)}
                onCreated={(sub) => {
                  onClose()
                  navigate(subspacePath(space, sub))
                }}
              />
            ))}
          </div>
        )}
      </BottomSheet>

      <NewSpaceModal
        open={newSubjectOpen}
        onClose={() => setNewSubjectOpen(false)}
        onCreated={(id) => setPendingSpace(id)}
      />
    </>
  )
}

function SubjectGroup({
  space,
  currentId,
  onPick,
  onCreated,
}: {
  space: Space
  currentId: string | null
  onPick: (sub: Subspace) => void
  onCreated: (sub: Subspace) => void
}) {
  const { addSubspace } = useSpaces()
  const { show } = useToast()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setAdding(false)
      return
    }
    setBusy(true)
    try {
      const created = await addSubspace(space.id, trimmed)
      setName('')
      setAdding(false)
      onCreated(created)
    } catch (e) {
      show(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label={space.name}>
      <h3 className="flex items-center gap-2.5 px-1 pb-1.5">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', toneDot[space.tone])} aria-hidden />
        <span className="setcode-strong min-w-0 truncate">{space.name}</span>
      </h3>
      <ul className="overflow-hidden rounded-2xl border border-line bg-well/50">
        {space.subspaces.map((sub) => {
          const current = sub.id === currentId
          const cards = sub.counts?.cards ?? 0
          return (
            <li key={sub.id} className="border-b border-line-soft last:border-b-0">
              <button
                type="button"
                onClick={() => onPick(sub)}
                aria-current={current ? 'true' : undefined}
                className={cn(
                  't-control flex min-h-[54px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-line-soft',
                  current && 'bg-brand-tint',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[16px]', current ? 'font-bold text-ink' : 'font-semibold text-ink-2')}>
                    {sub.name}
                  </span>
                  {cards > 0 && (
                    <span className="mt-0.5 block font-mono text-[11.5px] tracking-[0.04em] text-faint">
                      {cards} {cards === 1 ? 'card' : 'cards'}
                    </span>
                  )}
                </span>
                {current && <Icon name="check" size={18} className="shrink-0 text-brand" />}
              </button>
            </li>
          )
        })}
        <li>
          {adding ? (
            <form
              className="flex items-center gap-2 px-3 py-2"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <input
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={LIMITS.subspaceName}
                placeholder="Topic name"
                aria-label={`New topic in ${space.name}`}
                enterKeyHint="done"
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setAdding(false)
                    setName('')
                  }
                }}
                className="min-h-11 min-w-0 flex-1 rounded-[11px] border border-line bg-well px-3 text-[16px] text-ink outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
              />
              <Button type="submit" disabled={busy} aria-busy={busy}>
                Add
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="t-control flex min-h-[50px] w-full items-center gap-3 px-4 text-left text-[15px] font-semibold text-muted active:bg-line-soft"
            >
              <Icon name="plus" size={17} className="text-brand" />
              New topic
            </button>
          )}
        </li>
      </ul>
    </section>
  )
}
