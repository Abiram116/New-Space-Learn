/**
 * Flashcards — decks, the cards inside them, and review.
 *
 * Four states: the binder (deck grid), a deck's contents (where cards are
 * actually authored — the thing that was missing), review, and the summary.
 *
 * Grading is optimistic: we advance immediately and PATCH behind it. SM-2 lite
 * runs identically on the server, so the only cost of optimism is briefly
 * stale interval math.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createCard,
  createDeck,
  deleteCard,
  deleteDeck,
  generateCards,
  gradeCard,
  listCards,
  listDecks,
  updateCard,
} from '../../api/flashcards'
import type { Deck, Flashcard, Grade } from '../../api/types'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Card, DashedCard } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon } from '../../components/ui/Icon'
import { Input, Textarea } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { ProgressBar } from '../../components/ui/Bits'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { clearStatsCache } from '../../lib/briefCache'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { estimateRetention } from '../../lib/retention'
import { stripMarkdown } from '../../lib/text'
import { useAsync } from '../../lib/useAsync'
import { SubspaceMissing } from '../spaces/SubspaceMissing'

/** Grades read as a difficulty ramp, cold → hot, so the row is scannable. */
const GRADES: { key: Grade; label: string; hotkey: string; tone: string }[] = [
  { key: 'again', label: 'Again', hotkey: '1', tone: 'text-coral border-coral/40 hover:bg-coral/15' },
  { key: 'hard', label: 'Hard', hotkey: '2', tone: 'text-sun border-sun/40 hover:bg-sun/15' },
  { key: 'good', label: 'Good', hotkey: '3', tone: 'text-sky border-sky/40 hover:bg-sky/15' },
  { key: 'easy', label: 'Easy', hotkey: '4', tone: 'text-mint border-mint/40 hover:bg-mint/15' },
]

type Mode =
  | { kind: 'decks' }
  | { kind: 'deck'; deckId: string }
  | { kind: 'review'; deckId: string; cards: Flashcard[]; index: number; flipped: boolean; grades: Grade[] }
  | { kind: 'summary'; deckId: string; grades: Grade[] }

export function FlashcardsView() {
  const { space, subspace } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return <Inner key={subspace.id} subspaceId={subspace.id} subspaceName={subspace.name} />
}

function Inner({ subspaceId, subspaceName }: { subspaceId: string; subspaceName: string }) {
  const { show, showError } = useToast()
  const decks = useAsync(() => listDecks(subspaceId), [subspaceId])
  const [mode, setMode] = useState<Mode>({ kind: 'decks' })
  const [newDeckOpen, setNewDeckOpen] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [deleteDeckId, setDeleteDeckId] = useState<string | null>(null)

  const beginReview = useCallback(
    async (deckId: string) => {
      try {
        const cards = await listCards(deckId, { dueOnly: true })
        if (cards.length === 0) {
          show('Nothing due in this deck yet. Come back when it ripens.', 'info')
          return
        }
        setMode({ kind: 'review', deckId, cards, index: 0, flipped: false, grades: [] })
      } catch (err) {
        showError(err)
      }
    },
    [show, showError],
  )

  const removeDeck = async () => {
    if (!deleteDeckId) return
    const id = deleteDeckId
    setDeleteDeckId(null)
    decks.setData((prev) => (prev ? prev.filter((d) => d.id !== id) : prev))
    try {
      await deleteDeck(id)
      show('Deck deleted.', 'success')
    } catch (err) {
      showError(err)
      decks.refresh()
    }
  }

  if (mode.kind === 'review') {
    return (
      <Review
        mode={mode}
        setMode={setMode}
        onFinish={() => decks.refresh()}
        showError={showError}
      />
    )
  }

  if (mode.kind === 'summary') {
    const deck = decks.data?.find((d) => d.id === mode.deckId)
    return (
      <Summary
        grades={mode.grades}
        deckName={deck?.name ?? 'Deck'}
        onDone={() => setMode({ kind: 'decks' })}
        onAgain={() => beginReview(mode.deckId)}
      />
    )
  }

  if (mode.kind === 'deck') {
    const deck = decks.data?.find((d) => d.id === mode.deckId)
    return (
      <DeckDetail
        deckId={mode.deckId}
        deckName={deck?.name ?? 'Deck'}
        onBack={() => {
          setMode({ kind: 'decks' })
          decks.refresh()
        }}
        onReview={() => beginReview(mode.deckId)}
      />
    )
  }

  const list = decks.data ?? []
  const totalDue = list.reduce((n, d) => n + d.due, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader
        title="Cards"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setNewDeckOpen(true)}>
              <Icon name="plus" size={14} /> New deck
            </Button>
            <Button size="sm" onClick={() => setGenOpen(true)}>
              <Icon name="sparkle" size={14} /> Generate
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6">
        {totalDue > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-brand/25 bg-brand-tint px-4 py-3">
            <span className="nameplate text-[26px] tabular-nums text-brand">{totalDue}</span>
            <span className="text-[13px] text-ink-2">
              card{totalDue === 1 ? '' : 's'} ready across your decks.
            </span>
          </div>
        )}

        {decks.loading && (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        )}

        {!decks.loading && list.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-6">
          <EmptyState
            className="w-full max-w-lg"
            icon="deck"
            title="No decks yet"
            description={`Write cards yourself, or have them drafted from what you've indexed under ${subspaceName}.`}
            action={
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setNewDeckOpen(true)}>
                  Start a deck
                </Button>
                <Button onClick={() => setGenOpen(true)}>
                  <Icon name="sparkle" size={14} /> Generate a deck
                </Button>
              </div>
            }
          />
          </div>
        )}

        {!decks.loading && list.length > 0 && (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((deck) => (
              <DeckTile
                key={deck.id}
                deck={deck}
                onOpen={() => setMode({ kind: 'deck', deckId: deck.id })}
                onReview={() => beginReview(deck.id)}
                onDelete={() => setDeleteDeckId(deck.id)}
              />
            ))}
            <DashedCard
              className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 text-[13px] transition-colors hover:border-brand/50 hover:text-brand-deep"
              onClick={() => setNewDeckOpen(true)}
            >
              <Icon name="plus" size={20} />
              New deck
            </DashedCard>
          </div>
        )}
      </div>

      <NewDeckModal
        open={newDeckOpen}
        onClose={() => setNewDeckOpen(false)}
        onCreate={async (name) => {
          const deck = await createDeck(subspaceId, { name })
          decks.setData((prev) => [...(prev ?? []), deck])
          setNewDeckOpen(false)
          setMode({ kind: 'deck', deckId: deck.id })
        }}
      />

      <GenerateModal
        open={genOpen}
        subspaceName={subspaceName}
        onClose={() => setGenOpen(false)}
        onGenerate={async (topic, count) => {
          const cards = await generateCards(subspaceId, { topic, count })
          setGenOpen(false)
          decks.refresh()
          show(`Wrote ${cards.length} cards.`, 'success')
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteDeckId)}
        title="Delete this deck?"
        description="Every card in it goes too. This can't be undone."
        confirmLabel="Delete deck"
        onCancel={() => setDeleteDeckId(null)}
        onConfirm={removeDeck}
      />
    </div>
  )
}

// ── Deck tile ──────────────────────────────────────────────────────────

function DeckTile({
  deck,
  onOpen,
  onReview,
  onDelete,
}: {
  deck: Deck
  onOpen: () => void
  onReview: () => void
  onDelete: () => void
}) {
  const due = deck.due > 0
  return (
    <Card
      foil={due}
      className={cn(
        'group relative flex flex-col gap-3 p-4 transition-transform duration-200',
        'hover:-translate-y-0.5',
        due && 'ring-1 ring-brand/30',
      )}
    >
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${deck.name}`}
        className="absolute right-2.5 top-2.5 z-10 rounded-md p-1 text-faint opacity-0 transition-opacity hover:text-coral focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Icon name="trash" size={14} />
      </button>

      <button type="button" onClick={onOpen} className="flex flex-col gap-3 text-left">
        <div className="flex items-baseline gap-2">
          <span className="nameplate text-[20px] leading-none text-ink">{deck.name}</span>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'nameplate text-[34px] leading-none tabular-nums',
              due ? 'text-brand' : 'text-faint',
            )}
          >
            {deck.due}
          </span>
          <span className="setcode">due of {deck.total}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <ProgressBar value={deck.known_pct} tone={due ? 'brand' : 'mint'} />
          <span className="setcode">{deck.known_pct}% known</span>
        </div>
      </button>

      <div className="mt-auto flex gap-2 pt-1">
        <Button size="sm" variant={due ? 'primary' : 'secondary'} onClick={onReview} className="flex-1">
          Review
        </Button>
        <Button size="sm" variant="secondary" onClick={onOpen}>
          Cards
        </Button>
      </div>
    </Card>
  )
}

// ── Deck contents: where cards are authored ────────────────────────────

function DeckDetail({
  deckId,
  deckName,
  onBack,
  onReview,
}: {
  deckId: string
  deckName: string
  onBack: () => void
  onReview: () => void
}) {
  const { show, showError } = useToast()
  const cards = useAsync(() => listCards(deckId), [deckId])
  const [editing, setEditing] = useState<Flashcard | 'new' | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const save = async (front: string, back: string) => {
    try {
      if (editing === 'new') {
        const created = await createCard(deckId, { front, back })
        cards.setData((prev) => [...(prev ?? []), created])
        show('Card added.', 'success')
      } else if (editing) {
        const updated = await updateCard(editing.id, { front, back })
        cards.setData((prev) => (prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev))
        show('Card updated.', 'success')
      }
      setEditing(null)
    } catch (err) {
      showError(err)
    }
  }

  const remove = async () => {
    if (!deleteId) return
    const id = deleteId
    setDeleteId(null)
    cards.setData((prev) => (prev ? prev.filter((c) => c.id !== id) : prev))
    try {
      await deleteCard(id)
    } catch (err) {
      showError(err)
      cards.refresh()
    }
  }

  const list = cards.data ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader
        title={deckName}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={onBack}>
              <Icon name="arrowLeft" size={14} /> All decks
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing('new')}>
              <Icon name="plus" size={14} /> Add card
            </Button>
            <Button size="sm" onClick={onReview}>
              Review
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6">
        {cards.loading && (
          <div className="flex flex-col gap-2.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        )}

        {!cards.loading && list.length === 0 && (
          <EmptyState
            icon="deck"
            title="This deck is empty"
            description="Add the first question and answer. Cards you write yourself tend to stick best."
            action={<Button onClick={() => setEditing('new')}>Add a card</Button>}
          />
        )}

        {list.length > 0 && (
          <>
            <div className="mb-3 flex items-baseline justify-between">
              <span className="setcode">
                {list.length} card{list.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="flex flex-col gap-2.5">
              {list.map((card, i) => (
                <li key={card.id}>
                  <Card className="group flex items-start gap-3 p-3.5">
                    <span className="setcode mt-0.5 w-8 shrink-0 tabular-nums">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold text-ink">
                        {stripMarkdown(card.front)}
                      </p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                        {stripMarkdown(card.back)}
                      </p>
                    </div>
                    {(() => {
                      const retention = estimateRetention(card)
                      if (retention === null) return null
                      return (
                        <span
                          className="setcode mt-0.5 shrink-0 tabular-nums text-faint"
                          title="Estimated from time since last review and this card's ease/interval — not measured."
                        >
                          ~{retention}%
                        </span>
                      )
                    })()}
                    <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => setEditing(card)}
                        aria-label="Edit card"
                        className="rounded-md p-1.5 text-faint hover:text-ink"
                      >
                        <Icon name="note" size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteId(card.id)}
                        aria-label="Delete card"
                        className="rounded-md p-1.5 text-faint hover:text-coral"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <CardEditor
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        card={editing}
        onClose={() => setEditing(null)}
        onSave={save}
      />

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Delete this card?"
        description="It won't come back."
        confirmLabel="Delete card"
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />
    </div>
  )
}

function CardEditor({
  card,
  onClose,
  onSave,
}: {
  card: Flashcard | 'new' | null
  onClose: () => void
  onSave: (front: string, back: string) => Promise<void>
}) {
  const isNew = card === 'new'
  const existing = card && card !== 'new' ? card : null
  const [front, setFront] = useState(existing ? stripMarkdown(existing.front) : '')
  const [back, setBack] = useState(existing ? stripMarkdown(existing.back) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!front.trim() || !back.trim()) {
      setError('A card needs both a question and an answer.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(front.trim(), back.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={card !== null} onClose={onClose} title={isNew ? 'Add a card' : 'Edit card'}>
      <div className="flex flex-col gap-3">
        <Textarea
          name="front"
          label="Question"
          value={front}
          onChange={(e) => setFront(e.target.value)}
          rows={2}
          placeholder="What does the discount factor control?"
        />
        <Textarea
          name="back"
          label="Answer"
          value={back}
          onChange={(e) => setBack(e.target.value)}
          rows={4}
          placeholder="How much future reward is worth relative to immediate reward."
        />
        {error && <p className="text-xs font-semibold text-coral-deep">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add card' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Review ─────────────────────────────────────────────────────────────

function Review({
  mode,
  setMode,
  onFinish,
  showError,
}: {
  mode: Extract<Mode, { kind: 'review' }>
  setMode: (m: Mode) => void
  onFinish: () => void
  showError: (e: unknown) => void
}) {
  const card = mode.cards[mode.index]
  const total = mode.cards.length
  // Keep the handler in a ref so the key listener never goes stale.
  const stateRef = useRef({ mode, card })
  stateRef.current = { mode, card }

  const flip = useCallback(() => {
    const m = stateRef.current.mode
    setMode({ ...m, flipped: !m.flipped })
  }, [setMode])

  const grade = useCallback(
    (g: Grade) => {
      const { mode: m, card: c } = stateRef.current
      if (!c) return
      void gradeCard(c.id, g).catch(showError)
      // Due counts and the streak just moved; don't let Home serve the
      // pre-review numbers from cache.
      clearStatsCache()
      const grades = [...m.grades, g]
      if (m.index + 1 >= m.cards.length) {
        onFinish()
        setMode({ kind: 'summary', deckId: m.deckId, grades })
      } else {
        setMode({ ...m, index: m.index + 1, flipped: false, grades })
      }
    },
    [onFinish, setMode, showError],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (!stateRef.current.mode.flipped) flip()
        return
      }
      if (!stateRef.current.mode.flipped) return
      const hit = GRADES.find((g) => g.hotkey === e.key)
      if (hit) {
        e.preventDefault()
        grade(hit.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flip, grade])

  if (!card) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader
        title="Review"
        actions={
          <Button variant="ghost" size="sm" onClick={() => setMode({ kind: 'decks' })}>
            <Icon name="close" size={14} /> End session
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-4 py-6 lg:flex-row lg:items-start lg:justify-center">
        <div className="flex w-full max-w-xl flex-col items-center gap-6 lg:pt-6">
          <div className="flex w-full items-center gap-3">
            <span className="setcode tabular-nums">
              {mode.index + 1} / {total}
            </span>
            <ProgressBar value={((mode.index) / total) * 100} className="flex-1" />
          </div>

          {/* The card. Real 3D — the back is a separate face, rotated behind. */}
          <div
            className="w-full [perspective:1600px]"
            style={{ height: 'min(46vh, 340px)' }}
          >
            <button
              type="button"
              onClick={flip}
              aria-label={mode.flipped ? 'Show question' : 'Show answer'}
              className={cn(
                'relative h-full w-full cursor-pointer text-left',
                '[transform-style:preserve-3d] transition-transform duration-500',
                'motion-reduce:transition-none',
              )}
              style={{ transform: mode.flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
            >
              <CardFace side="front" text={card.front} hint="Space to flip" />
              <CardFace side="back" text={card.back} source={card.source} />
            </button>
          </div>

          <div className="flex w-full flex-col gap-2">
            {mode.flipped ? (
              <div className="grid grid-cols-4 gap-2">
                {GRADES.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => grade(g.key)}
                    className={cn(
                      'flex flex-col items-center gap-0.5 rounded-[11px] border bg-raised py-2.5',
                      'text-[12.5px] font-bold transition-colors cursor-pointer',
                      g.tone,
                    )}
                  >
                    {g.label}
                    <span className="setcode">{g.hotkey}</span>
                  </button>
                ))}
              </div>
            ) : (
              <Button size="lg" onClick={flip} className="w-full">
                Show answer
              </Button>
            )}
          </div>
        </div>

        {/* Real use of the wide screen: what's coming, and how the session's going so far. */}
        <aside className="hidden w-56 shrink-0 flex-col gap-4 lg:flex lg:pt-6">
          {mode.grades.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="setcode px-0.5">So far</span>
              <div className="grid grid-cols-4 gap-1.5">
                {GRADES.map((g) => {
                  const count = mode.grades.filter((x) => x === g.key).length
                  return (
                    <div
                      key={g.key}
                      className="flex flex-col items-center gap-0.5 rounded-[10px] bg-well py-1.5"
                    >
                      <span className={cn('nameplate text-[16px] tabular-nums', g.tone.split(' ')[0])}>
                        {count}
                      </span>
                      <span className="setcode text-[9px]">{g.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <span className="setcode px-0.5">Up next</span>
            <div className="flex flex-col gap-1.5">
              {mode.cards.slice(mode.index + 1, mode.index + 6).map((c) => (
                <div
                  key={c.id}
                  className="truncate rounded-lg border border-line bg-well px-2.5 py-2 text-[12px] text-muted"
                >
                  {stripMarkdown(c.front)}
                </div>
              ))}
              {mode.cards.length - mode.index - 1 > 5 && (
                <div className="px-0.5 text-[11px] text-faint">
                  +{mode.cards.length - mode.index - 6} more
                </div>
              )}
              {mode.index + 1 >= mode.cards.length && (
                <div className="px-0.5 text-[11px] text-faint">Last card in this session.</div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function CardFace({
  side,
  text,
  source,
  hint,
}: {
  side: 'front' | 'back'
  text: string
  source?: string | null
  hint?: string
}) {
  const isBack = side === 'back'
  return (
    <div
      className={cn(
        'cardstock absolute inset-0 flex flex-col rounded-2xl p-6 sm:p-8',
        '[backface-visibility:hidden]',
        isBack && 'bg-raised',
      )}
      style={isBack ? { transform: 'rotateY(180deg)' } : undefined}
    >
      <span className="setcode">{isBack ? 'Answer' : 'Question'}</span>
      <div className="flex flex-1 items-center justify-center py-4">
        <p
          className={cn(
            'text-center',
            isBack
              ? 'text-[15px] leading-relaxed text-ink-2'
              : 'nameplate text-[clamp(22px,4vw,32px)] leading-tight text-ink',
          )}
        >
          {stripMarkdown(text)}
        </p>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="setcode truncate">{source ? stripMarkdown(source) : ''}</span>
        {hint && <span className="setcode shrink-0">{hint}</span>}
      </div>
    </div>
  )
}

// ── Summary ────────────────────────────────────────────────────────────

function Summary({
  grades,
  deckName,
  onDone,
  onAgain,
}: {
  grades: Grade[]
  deckName: string
  onDone: () => void
  onAgain: () => void
}) {
  const tally = useMemo(() => {
    const counts: Record<Grade, number> = { again: 0, hard: 0, good: 0, easy: 0 }
    for (const g of grades) counts[g] += 1
    return counts
  }, [grades])
  const solid = tally.good + tally.easy
  const pct = grades.length ? Math.round((solid / grades.length) * 100) : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader title="Session complete" />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <Card foil className="flex w-full max-w-md flex-col gap-5 p-7 text-center">
          <div>
            <div className="nameplate text-[64px] leading-none text-brand tabular-nums">{pct}%</div>
            <p className="setcode mt-1">solid on {deckName}</p>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {GRADES.map((g) => (
              <div key={g.key} className="flex flex-col gap-0.5 rounded-[10px] bg-well py-2">
                <span className={cn('nameplate text-[22px] tabular-nums', g.tone.split(' ')[0])}>
                  {tally[g.key]}
                </span>
                <span className="setcode">{g.label}</span>
              </div>
            ))}
          </div>

          <p className="text-[13px] leading-relaxed text-muted">
            {tally.again > 0
              ? `${tally.again} card${tally.again === 1 ? '' : 's'} came back short — those return sooner.`
              : 'Nothing missed. The whole deck moves further out.'}
          </p>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onDone} className="flex-1">
              Done
            </Button>
            <Button onClick={onAgain} className="flex-1">
              Review again
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

// ── Modals ─────────────────────────────────────────────────────────────

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
  const { showError } = useToast()

  useEffect(() => {
    if (open) setName('')
  }, [open])

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onCreate(name.trim())
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New deck">
      <div className="flex flex-col gap-3">
        <Input
          name="deck"
          label="Deck name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Bellman equations"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create deck'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function GenerateModal({
  open,
  subspaceName,
  onClose,
  onGenerate,
}: {
  open: boolean
  subspaceName: string
  onClose: () => void
  onGenerate: (topic: string | undefined, count: number) => Promise<void>
}) {
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(8)
  const [busy, setBusy] = useState(false)
  const { showError } = useToast()

  useEffect(() => {
    if (open) {
      setTopic('')
      setCount(8)
    }
  }, [open])

  const submit = async () => {
    setBusy(true)
    try {
      await onGenerate(topic.trim() || undefined, count)
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Generate a deck">
      <div className="flex flex-col gap-3">
        <Input
          name="topic"
          label="Topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={subspaceName}
          hint="Left blank, it draws on everything indexed in this topic."
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="count" className="setcode">
            How many cards
          </label>
          <div className="flex items-center gap-3">
            <input
              id="count"
              type="range"
              min={3}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="flex-1 accent-[var(--color-brand)]"
            />
            <span className="nameplate w-8 text-right text-[22px] tabular-nums text-brand">
              {count}
            </span>
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-faint">
          Drafted cards are a starting point — edit anything that reads wrong before
          you rely on it.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Writing cards…' : 'Generate'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
