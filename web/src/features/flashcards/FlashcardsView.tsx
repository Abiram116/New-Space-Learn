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

import { useCallback, useState } from 'react'
import { LIMITS } from '../../lib/limits'
import {
  createCard,
  createDeck,
  deleteCard,
  deleteDeck,
  generateCards,
  listCards,
  listDecks,
  updateCard,
} from '../../api/flashcards'
import type { Deck, Flashcard } from '../../api/types'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Card, DashedCard } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon } from '../../components/ui/Icon'
import { Textarea } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { ProgressBar } from '../../components/ui/Bits'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { estimateRetention } from '../../lib/retention'
import { stripMarkdown } from '../../lib/text'
import { useAsync } from '../../lib/useAsync'
import { SubspaceMissing } from '../spaces/SubspaceMissing'
import { Review } from './Review'
import { Summary } from './Summary'
import { GenerateModal, NewDeckModal } from './modals'
import type { Mode } from './model'

export function FlashcardsView() {
  const { space, subspace, base } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return (
    <Inner
      key={subspace.id}
      subspaceId={subspace.id}
      subspaceName={subspace.name}
      base={base}
    />
  )
}

function Inner({
  subspaceId,
  subspaceName,
  base,
}: {
  subspaceId: string
  subspaceName: string
  base: string
}) {
  const { show, showError } = useToast()
  const decks = useAsync(() => listDecks(subspaceId), [subspaceId], `decks:${subspaceId}`)
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
    // You just emptied this deck, so "review again" would only ever fire the
    // "nothing due" toast. Offer the next deck that actually has cards ready,
    // and when nothing does, the other way to use what you just reviewed.
    const nextDeck = (decks.data ?? []).find((d) => d.id !== mode.deckId && d.due > 0) ?? null
    return (
      <Summary
        grades={mode.grades}
        deckName={deck?.name ?? 'Deck'}
        onDone={() => setMode({ kind: 'decks' })}
        nextDeck={nextDeck}
        onReviewNext={beginReview}
        quizHref={`${base}/quizzes`}
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
          /* Manual deck creation belongs to the dashed slot in the grid — the
             one empty binder pocket. The header keeps the one action the grid
             can't express. */
          <Button size="sm" onClick={() => setGenOpen(true)}>
            <Icon name="sparkle" size={14} /> Generate
          </Button>
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
        confirmLabel="Delete"
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

      {/* One button. The tile body above already opens the deck, so a "Cards"
          button on the same tile was a second door to the same room. */}
      <div className="mt-auto flex gap-2 pt-1">
        <Button size="sm" variant={due ? 'primary' : 'secondary'} onClick={onReview} className="flex-1">
          Review
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
  const cards = useAsync(() => listCards(deckId), [deckId], `cards:${deckId}`)
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
                    <div className="flex shrink-0 gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
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
        confirmLabel="Delete"
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
          maxLength={LIMITS.cardFront}
          placeholder="What does one turn of the Krebs cycle yield?"
        />
        <Textarea
          name="back"
          label="Answer"
          value={back}
          onChange={(e) => setBack(e.target.value)}
          rows={4}
          maxLength={LIMITS.cardBack}
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
