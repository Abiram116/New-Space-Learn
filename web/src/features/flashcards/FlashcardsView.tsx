/**
 * Flashcards: deck grid, review flow (front → flip → grade), session summary.
 *
 * Grading is optimistic — we advance to the next card immediately and PATCH
 * in the background. Because SM-2 lite runs identically on the server, the
 * only thing we sacrifice on optimism is stale interval math for a moment.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createDeck, deleteDeck, gradeCard, listCards, listDecks } from '../../api/flashcards'
import type { Deck, Flashcard, Grade } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Card, DashedCard } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { ProgressBar } from '../../components/ui/Bits'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { useAsync } from '../../lib/useAsync'
import { SubspaceMissing } from '../spaces/SubspaceMissing'

const GRADES: { key: Grade; label: string; hotkey: string; className: string }[] = [
  { key: 'again', label: 'Again', hotkey: '1', className: 'bg-surface text-coral-deep' },
  { key: 'hard', label: 'Hard', hotkey: '2', className: 'bg-surface text-sun-deep' },
  { key: 'good', label: 'Good', hotkey: '3', className: 'bg-surface text-sky-deep' },
  { key: 'easy', label: 'Easy', hotkey: '4', className: 'bg-mint text-white' },
]

type Mode =
  | { kind: 'decks' }
  | { kind: 'review'; deckId: string; cards: Flashcard[]; index: number; flipped: boolean; grades: number[] }
  | { kind: 'summary'; deckId: string; started: number; grades: number[] }

export function FlashcardsView() {
  const { space, subspace } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return <Inner subspaceId={subspace.id} />
}

function Inner({ subspaceId }: { subspaceId: string }) {
  const { show, showError } = useToast()
  const decks = useAsync(() => listDecks(subspaceId), [subspaceId])
  const [mode, setMode] = useState<Mode>({ kind: 'decks' })
  const [newDeckOpen, setNewDeckOpen] = useState(false)
  const [deleteDeckId, setDeleteDeckId] = useState<string | null>(null)

  const beginReview = useCallback(
    async (deckId: string) => {
      try {
        const cards = await listCards(deckId, { dueOnly: true })
        if (cards.length === 0) {
          show("Nothing due right now — check back later.", 'info')
          return
        }
        setMode({
          kind: 'review',
          deckId,
          cards,
          index: 0,
          flipped: false,
          grades: [],
        })
      } catch (err) {
        showError(err)
      }
    },
    [show, showError],
  )

  const grade = useCallback(
    async (g: Grade) => {
      if (mode.kind !== 'review') return
      const card = mode.cards[mode.index]
      if (!card) return
      const gradeIndex = GRADES.findIndex((x) => x.key === g)
      const nextGrades = [...mode.grades, gradeIndex]

      // Fire-and-forget: don't block the UI on the server.
      void gradeCard(card.id, g).catch(showError)

      if (mode.index + 1 >= mode.cards.length) {
        setMode({
          kind: 'summary',
          deckId: mode.deckId,
          started: performance.now(),
          grades: nextGrades,
        })
        void decks.refresh()
      } else {
        setMode({ ...mode, index: mode.index + 1, flipped: false, grades: nextGrades })
      }
    },
    [decks, mode, showError],
  )

  const flip = useCallback(() => {
    if (mode.kind === 'review') setMode({ ...mode, flipped: !mode.flipped })
  }, [mode])

  // Keyboard shortcuts during review.
  useEffect(() => {
    if (mode.kind !== 'review') return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        flip()
        return
      }
      if (!mode.flipped) return
      const g = GRADES.find((x) => x.hotkey === e.key)
      if (g) {
        e.preventDefault()
        void grade(g.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, flip, grade])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader
        title="Flashcards"
        actions={
          <>
            <Button variant="secondary" onClick={() => setNewDeckOpen(true)}>
              + New deck
            </Button>
            {mode.kind !== 'decks' && (
              <Button variant="secondary" onClick={() => setMode({ kind: 'decks' })}>
                Back to decks
              </Button>
            )}
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {mode.kind === 'decks' && (
          <DecksGrid
            decks={decks.data}
            loading={decks.loading}
            error={decks.error}
            onReview={beginReview}
            onNew={() => setNewDeckOpen(true)}
            onDelete={setDeleteDeckId}
          />
        )}

        {mode.kind === 'review' && (
          <ReviewCard
            card={mode.cards[mode.index]}
            index={mode.index}
            total={mode.cards.length}
            flipped={mode.flipped}
            onFlip={flip}
            onGrade={grade}
          />
        )}

        {mode.kind === 'summary' && (
          <SessionSummary
            grades={mode.grades}
            elapsedMs={performance.now() - mode.started}
            onDone={() => setMode({ kind: 'decks' })}
          />
        )}
      </div>

      <NewDeckModal
        open={newDeckOpen}
        onClose={() => setNewDeckOpen(false)}
        onCreate={async (name) => {
          try {
            await createDeck(subspaceId, { name })
            await decks.refresh()
            setNewDeckOpen(false)
            show('Deck created.', 'success')
          } catch (err) {
            showError(err)
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteDeckId)}
        title="Delete this deck?"
        description="All cards in it will be lost. Chats and notes stay."
        confirmLabel="Delete"
        onCancel={() => setDeleteDeckId(null)}
        onConfirm={async () => {
          if (!deleteDeckId) return
          try {
            await deleteDeck(deleteDeckId)
            await decks.refresh()
            setDeleteDeckId(null)
          } catch (err) {
            showError(err)
          }
        }}
        destructive
      />
    </div>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────────

function DecksGrid({
  decks,
  loading,
  error,
  onReview,
  onNew,
  onDelete,
}: {
  decks: Deck[] | null
  loading: boolean
  error: string | null
  onReview: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  if (loading)
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    )
  if (error) {
    return (
      <div className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
        {error}
      </div>
    )
  }
  if (!decks || decks.length === 0) {
    return (
      <EmptyState
        icon="🗂"
        title="No decks yet"
        description="Create a deck to start reviewing cards with spaced repetition."
        action={<Button onClick={onNew}>Create a deck</Button>}
      />
    )
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {decks.map((deck) => (
        <Card key={deck.id} className="group flex flex-col gap-2 p-3.5">
          <div className="flex items-start gap-2">
            <b className="flex-1 text-sm truncate">{deck.name}</b>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold',
                deck.due > 0 ? 'bg-sun-soft' : deck.total === 0 ? 'bg-line-soft text-faint' : 'bg-mint-soft',
              )}
            >
              {deck.total === 0 ? 'empty' : deck.due > 0 ? `${deck.due} due` : 'done'}
            </span>
          </div>
          <div className="text-xs text-muted">
            {deck.total} card{deck.total === 1 ? '' : 's'} · {deck.known_pct}% known
          </div>
          <ProgressBar value={deck.known_pct} tone={deck.known_pct >= 90 ? 'mint' : 'brand'} />
          <div className="mt-1 flex justify-between text-xs">
            {deck.due > 0 ? (
              <button
                onClick={() => onReview(deck.id)}
                className="font-semibold text-brand cursor-pointer"
              >
                Review deck →
              </button>
            ) : (
              <span className="text-faint">No cards due</span>
            )}
            <button
              onClick={() => onDelete(deck.id)}
              className="text-faint opacity-0 group-hover:opacity-100 hover:text-coral-deep transition-opacity cursor-pointer"
              aria-label="Delete deck"
            >
              Delete
            </button>
          </div>
        </Card>
      ))}
      <DashedCard
        className="flex flex-col items-center justify-center gap-1 p-3.5 text-[13px] cursor-pointer hover:border-brand"
        onClick={onNew}
      >
        <span className="text-xl text-brand">+</span>
        New deck
      </DashedCard>
    </div>
  )
}

function ReviewCard({
  card,
  index,
  total,
  flipped,
  onFlip,
  onGrade,
}: {
  card: Flashcard
  index: number
  total: number
  flipped: boolean
  onFlip: () => void
  onGrade: (g: Grade) => void
}) {
  return (
    <div className="mx-auto max-w-160">
      {!flipped ? (
        <button
          onClick={onFlip}
          className="flex h-[280px] w-full cursor-pointer flex-col gap-4 rounded-[20px] border-[1.5px] border-line bg-surface p-5.5 text-left transition-colors hover:border-brand-200"
        >
          <div className="flex items-center gap-2 text-xs text-muted">
            Card {index + 1} / {total}
            <div className="h-[5px] flex-1 rounded-full bg-line-soft">
              <div
                className="h-[5px] rounded-full bg-brand transition-all"
                style={{ width: `${((index + 1) / total) * 100}%` }}
              />
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center px-2.5 text-center font-display text-[22px] leading-[1.35] font-medium">
            {card.front}
          </div>
          <div className="text-center text-[12.5px] font-semibold text-brand">
            Tap card or press Space to flip
          </div>
        </button>
      ) : (
        <div className="flex h-[280px] w-full flex-col gap-3.5 rounded-[20px] border-[1.5px] border-brand-200 bg-brand-soft p-5.5">
          <div className="text-xs text-muted">Answer</div>
          <div className="flex-1 text-sm leading-[1.55] overflow-y-auto whitespace-pre-wrap">
            {card.back}
            {card.source && (
              <div className="mt-2 inline-block rounded-[9px] bg-surface px-2.5 py-1.5 text-[11.5px] text-brand-deep">
                source: {card.source}
              </div>
            )}
          </div>
          <div className="flex gap-2 text-center text-[12.5px] font-semibold">
            {GRADES.map((g) => (
              <button
                key={g.key}
                onClick={() => onGrade(g.key)}
                title={`Press ${g.hotkey}`}
                className={cn(
                  'flex-1 rounded-xl py-2.5 transition-transform hover:scale-[1.03] cursor-pointer',
                  g.className,
                )}
              >
                {g.label}
                <div className="text-[10px] font-normal opacity-70">{g.hotkey}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SessionSummary({
  grades,
  elapsedMs,
  onDone,
}: {
  grades: number[]
  elapsedMs: number
  onDone: () => void
}) {
  const totals = useMemo(() => {
    const easy = grades.filter((g) => g === 3).length
    const good = grades.filter((g) => g === 2).length
    const hard = grades.filter((g) => g === 1).length
    const again = grades.filter((g) => g === 0).length
    return { easyGood: easy + good, hard, again }
  }, [grades])

  const mm = Math.floor(elapsedMs / 60_000)
  const ss = String(Math.floor((elapsedMs % 60_000) / 1000)).padStart(2, '0')

  return (
    <Card className="mx-auto flex max-w-2xl flex-wrap items-center gap-5.5 rounded-[18px] px-5.5 py-4.5">
      <div>
        <div className="text-[11px] font-bold tracking-[0.09em] text-faint">SESSION DONE</div>
        <div className="mt-1 font-display text-xl font-semibold">
          {grades.length} cards in {mm}:{ss} 🎉
        </div>
      </div>
      <div className="flex gap-2.5 text-center text-xs">
        <SumTile value={totals.easyGood} label="Easy / Good" className="bg-mint-soft" />
        <SumTile value={totals.hard} label="Hard" className="bg-sun-soft" />
        <SumTile value={totals.again} label="Again" className="bg-coral-soft" />
      </div>
      <Button onClick={onDone} className="ml-auto">
        Done
      </Button>
    </Card>
  )
}

function SumTile({ value, label, className }: { value: number; label: string; className: string }) {
  return (
    <div className={cn('rounded-xl px-4 py-2.5', className)}>
      <b className="text-[17px]">{value}</b>
      <div>{label}</div>
    </div>
  )
}

function NewDeckModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) {
      setErr('Give the deck a name.')
      return
    }
    setBusy(true)
    try {
      await onCreate(name.trim())
      setName('')
    } catch (e) {
      setErr(friendlyMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New deck" width="sm">
      <div className="flex flex-col gap-4">
        <Input
          label="Deck name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Attention basics"
          autoFocus
          error={err}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Creating…' : 'Create deck'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
