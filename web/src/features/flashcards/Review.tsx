/**
 * The review session: one card at a time, flip, grade, advance.
 *
 * Split out of `FlashcardsView` (1,063 lines) before Phase 3 adds the exam
 * countdown and the "compressed to fit your exam" indicator to it — the plan
 * is explicit that the split has to happen BEFORE the new surfaces land, not
 * after, or the refactor gets done twice or abandoned.
 *
 * Grading is optimistic: the next card appears immediately and the PATCH goes
 * out behind it. SM-2 lite runs identically in `lib/schedule.ts`, so the only
 * cost of the optimism is briefly stale interval math.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gradeCard } from '../../api/flashcards'
import type { Grade } from '../../api/types'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { ProgressBar } from '../../components/ui/Bits'
import { Tip } from '../../components/ui/Tip'
import { useReducedMotion } from '../../components/ui/motion'
import {
  AmbienceField,
  noteCardGraded,
  useAmbienceField,
  useStudySession,
} from '../../components/celebrate'
import { clearStatsCache } from '../../lib/briefCache'
import { cn } from '../../lib/cn'
import { nextIntervalLabel } from '../../lib/schedule'
import { stripMarkdown } from '../../lib/text'
import { EASE } from '../../components/celebrate/easing'
import { anyModalOpen, isConfirmKey, stageKeyGate } from '../quizzes/keys'
import { KeyHints, StageCount, type KeyHint } from '../quizzes/StageKit'
import { useImmersive } from '../../components/layout/immersive'
import { useIsMobile } from '../../lib/useIsMobile'
import { PhoneReview } from './PhoneReview'
import { useCardMotion } from './cardMotion'
import { DEFAULT_GRADE_HIGHLIGHT, reviewKeyAction, type ReviewKeyAction } from './keys'
import { GRADES, GRADE_PULSE, type Mode } from './model'

/** Marks the stage's own controls: Enter/Space on these runs the review keys. */
const OWN = 'data-review-key'

/** An Enter/Space this soon after the flip is a double-press, not a grade:
 *  nobody has read the answer in a quarter of a second. */
const MIN_READ_MS = 250

export function Review({
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
  // Phones get their own immersive stage; everything below (grading, the
  // Again re-queue, the key handling) is shared with it.
  const isMobile = useIsMobile()
  useImmersive(isMobile)
  // Keep the handler in a ref so the key listener never goes stale.
  const stateRef = useRef({ mode, card })
  useLayoutEffect(() => {
    stateRef.current = { mode, card }
  })
  // Blocks a second `grade()` for the *same* queue slot — a fast
  // double-click, or a mouse click landing right after the same hotkey
  // fires, reads the same `stateRef.current.card` before the
  // advance-to-the-next-card render has committed (grading is deliberately
  // optimistic/synchronous, so nothing else was gating this). Two calls
  // meant two `gradeCard` PATCHes for one card — a plain read-modify-write
  // on the server, so whichever lands last silently wins and the other
  // grade is discarded from the SM-2 state, while `activity.bump` still
  // counts both as a card reviewed. Keyed by queue index, not card id: an
  // "Again" card is re-queued later in this same session and gets the same
  // id back, so id alone would wrongly gate its second pass too.
  const gradedRef = useRef<number>(-1)

  // The room the session sits in: warmer as the queue empties, a pulse of
  // light on a Good/Easy, a breath of dimness on an Again.
  useStudySession()
  const ambience = useAmbienceField()
  const cardRef = useRef<HTMLDivElement>(null)
  const faceRef = useRef<HTMLButtonElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const gradeRefs = useRef<(HTMLButtonElement | null)[]>([])
  const flippedAt = useRef(0)
  const reduced = useReducedMotion()
  useEffect(() => {
    ambience.api.progress(total ? mode.index / total : 0)
  }, [ambience.api, mode.index, total])
  useCardMotion(cardRef, mode.index, mode.flipped, reduced)

  // The highlighted grade, per queue slot: every new card starts on Good.
  // Stored with its slot so moving on resets it without an effect.
  const [hl, setHl] = useState({ index: mode.index, value: DEFAULT_GRADE_HIGHLIGHT })
  const highlight = hl.index === mode.index ? hl.value : DEFAULT_GRADE_HIGHLIGHT

  /* What each grade costs, computed from this card's own ease/interval/reps
     with the same arithmetic the server runs. Shown on the button so the
     choice is informed rather than a guess about a hidden algorithm. */
  const previews = useMemo(() => {
    const out = {} as Record<Grade, string>
    for (const g of GRADES) out[g.key] = card ? nextIntervalLabel(card, g.key) : ''
    return out
  }, [card])

  const flip = useCallback(() => {
    const m = stateRef.current.mode
    if (!m.flipped) flippedAt.current = performance.now()
    setMode({ ...m, flipped: !m.flipped })
  }, [setMode])

  const grade = useCallback(
    (g: Grade) => {
      const { mode: m, card: c } = stateRef.current
      if (!c || gradedRef.current === m.index) return
      gradedRef.current = m.index
      const saved = gradeCard(c.id, g)
      saved.catch(showError)
      noteCardGraded(saved, { anchor: cardRef, bar: barRef })
      ambience.api.pulse(GRADE_PULSE[g])
      // Due counts and the streak just moved; don't let Home serve the
      // pre-review numbers from cache.
      clearStatsCache()
      const grades = [...m.grades, g]
      // Standard SRS behaviour: "Again" doesn't finish this card's part in
      // the session, it re-queues it at the tail so it comes back before the
      // session ends. The session is only done once every card's *last*
      // grade cleared Again — growing `cards` here is what makes that fall
      // out of the existing index/length check below for free.
      const cards = g === 'again' ? [...m.cards, c] : m.cards
      if (m.index + 1 >= cards.length) {
        onFinish()
        setMode({ kind: 'summary', deckId: m.deckId, grades, limit: m.limit, pending: m.pending, mixed: m.mixed })
      } else {
        setMode({ ...m, cards, index: m.index + 1, flipped: false, grades })
      }
    },
    [onFinish, setMode, showError, ambience.api],
  )

  // A new card arrives face-up with Good highlighted — so focus must not be
  // left sitting on the grade you just pressed, or Enter would repeat it
  // while the ring says Good. It moves to the card, where Space flips.
  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('[data-grade-index]')) {
      faceRef.current?.focus({ preventScroll: true })
    }
  }, [mode.index])

  const act = useCallback(
    (a: ReviewKeyAction) => {
      if (a.type === 'flip') flip()
      else if (a.type === 'highlight') {
        setHl({ index: stateRef.current.mode.index, value: a.index })
        gradeRefs.current[a.index]?.focus()
      } else grade(GRADES[a.index].key)
    },
    [flip, grade],
  )
  const live = useRef({ highlight, act })
  useLayoutEffect(() => {
    live.current = { highlight, act }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { mode: m } = stateRef.current
      const owner = (e.target as Element | null)?.closest?.('[data-grade-index]')
      const focused = owner ? Number(owner.getAttribute('data-grade-index')) : null
      const action = reviewKeyAction(e.key, {
        flipped: m.flipped,
        highlight: live.current.highlight,
        focused,
        count: GRADES.length,
      })
      const gate = stageKeyGate(e, { ownAttr: OWN, modalOpen: anyModalOpen(), wouldHandle: action !== null })
      if (gate === 'ignore') return
      // Space must never scroll the page, and Enter must never also click
      // the focused card — which would flip it straight back.
      e.preventDefault()
      if (gate !== 'handle' || !action) return
      if (
        action.type === 'grade' &&
        isConfirmKey(e.key) &&
        performance.now() - flippedAt.current < MIN_READ_MS
      ) {
        return
      }
      live.current.act(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!card) return null

  if (isMobile) {
    return (
      <PhoneReview
        index={mode.index}
        total={total}
        card={card}
        flipped={mode.flipped}
        previews={previews}
        highlight={highlight}
        cardRef={cardRef}
        faceRef={faceRef}
        barRef={barRef}
        gradeRefs={gradeRefs}
        reduced={reduced}
        // Light on a phone: the compact field is a single soft glow.
        ambience={<AmbienceField field={ambience} compact />}
        onClose={() => setMode({ kind: 'decks' })}
        onFlip={flip}
        onGrade={grade}
        onHighlight={(i) => setHl({ index: mode.index, value: i })}
      />
    )
  }

  const hints: KeyHint[] = mode.flipped
    ? [
        { keys: ['left', 'right'], label: 'Choose grade' },
        { keys: ['Enter'], label: 'Confirm' },
        { keys: ['1', '–', '4'], label: 'Grade directly' },
      ]
    : [{ keys: ['Space', 'or', 'Enter'], label: 'Flip the card' }]

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

      <div className="relative isolate flex min-h-0 flex-1 flex-col">
        <AmbienceField field={ambience} />
        <div className="study-stage flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="stage-grid">
            <div className="stage-main flex flex-col gap-[clamp(16px,2.6dvh,30px)]">
              <div className="flex flex-col gap-3">
                <StageCount current={mode.index + 1} total={total} noun="Card" />
                <div ref={barRef}>
                  <ProgressBar value={(mode.index / total) * 100} />
                </div>
              </div>

              {/* The card. Real 3D — the back is a separate face, rotated behind.
                  Keyed per queue slot so the next card arrives face-up: turning
                  the old card back over used to show the NEW card's answer for
                  the first half of the rotation. The outer layer carries the lift
                  and the deal (see useCardMotion); the button only ever rotates. */}
              <div className="stage-card w-full">
                <div ref={cardRef} className="h-full w-full [perspective:1800px]">
                  <button
                    key={mode.index}
                    ref={faceRef}
                    type="button"
                    onClick={flip}
                    {...{ [OWN]: '' }}
                    aria-label={mode.flipped ? 'Show question' : 'Show answer'}
                    className={cn(
                      'relative h-full w-full cursor-pointer rounded-2xl text-left',
                      '[transform-style:preserve-3d] motion-reduce:transition-none',
                      'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-300',
                    )}
                    style={{
                      transform: mode.flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                      transition: reduced ? 'none' : `transform 780ms ${EASE.flip}`,
                    }}
                  >
                    <CardFace side="front" text={card.front} />
                    <CardFace side="back" text={card.back} source={card.source} />
                  </button>
                </div>
              </div>

              {/* The grade row is always here — dimmed and out of the tab order
                  until the card is flipped — so the card never jumps a row's
                  height at the moment you're reading the answer. One ordered
                  scale: colour only marks the one categorical split there is,
                  Again (you didn't know it) against the three that say you did.
                  The figure under each is when you'd see this card next. */}
              <div className="flex flex-col gap-[clamp(12px,1.8dvh,18px)]">
                <div className="grid grid-cols-4 gap-[clamp(6px,0.8cqw,12px)]" aria-hidden={!mode.flipped}>
                  {GRADES.map((g, i) => {
                    const active = mode.flipped && highlight === i
                    return (
                      <button
                        key={g.key}
                        ref={(el) => void (gradeRefs.current[i] = el)}
                        type="button"
                        {...{ [OWN]: '' }}
                        data-grade-index={i}
                        data-active={active || undefined}
                        onClick={() => mode.flipped && grade(g.key)}
                        onFocus={() => mode.flipped && setHl({ index: mode.index, value: i })}
                        aria-disabled={!mode.flipped}
                        tabIndex={mode.flipped && highlight === i ? 0 : -1}
                        aria-label={`${g.label} — press ${g.hotkey} — next in ${previews[g.key]}`}
                        className={cn(
                          'group flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] px-1',
                          'py-[clamp(12px,1.8dvh,18px)] t-control duration-150 active:translate-y-px',
                          // The keyboard ring itself lives in stage.css (.stage-grade),
                          // behind a fine-pointer query: on a phone a ring on Good
                          // before you've touched anything reads as a pre-selection.
                          'stage-grade border-line bg-surface hover:border-line-dash hover:bg-raised',
                          !mode.flipped && 'pointer-events-none opacity-35',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              'text-[clamp(1rem,0.85rem+0.4cqw,1.25rem)] font-bold',
                              g.key === 'again' ? 'text-coral-deep' : active ? 'text-ink' : 'text-ink-2',
                            )}
                          >
                            {g.label}
                          </span>
                          <span className="stage-keys stage-label">
                            <kbd className="inline-grid h-[1.6em] min-w-[1.6em] place-items-center rounded-md border border-line bg-well font-mono text-[0.85em] font-semibold text-muted">
                              {g.hotkey}
                            </kbd>
                          </span>
                        </span>
                        <span className="stage-label tabular-nums text-muted">{previews[g.key]}</span>
                      </button>
                    )
                  })}
                </div>

                <div className="flex min-h-[1.9em] items-center justify-center">
                  <KeyHints hints={hints} className="justify-center" />
                  <span className="stage-touch-only stage-label text-muted">
                    {mode.flipped ? 'How well did you know it?' : 'Tap the card to see the answer'}
                  </span>
                </div>

                {/* The number under each grade is the single least obvious thing
                    on this screen, and it is the whole mechanic. */}
                <Tip id="cards-grades-v1" icon="clock">
                  The number under each grade is when you'll see this card next.
                  <strong className="font-semibold text-ink-3"> Again</strong> resets
                  it to one day; <strong className="font-semibold text-ink-3">Easy</strong>{' '}
                  pushes it furthest out. Answer honestly — the schedule only works
                  if the grades are true.
                </Tip>
              </div>
            </div>

            {/* The wide screen's spare gutter: how the session is going, and
                what's coming. Only shown when the gutter can hold it. */}
            <aside className="stage-aside flex-col gap-5">
              {mode.grades.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="stage-label px-0.5 font-semibold text-ink-3">So far</span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {GRADES.map((g) => {
                      const count = mode.grades.filter((x) => x === g.key).length
                      return (
                        <div
                          key={g.key}
                          className="flex flex-col items-center gap-1 rounded-[10px] bg-well py-2"
                        >
                          <span className={cn('nameplate text-[18px] tabular-nums', g.text)}>
                            {count}
                          </span>
                          <span className="text-[11.5px] text-muted">{g.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <span className="stage-label px-0.5 font-semibold text-ink-3">Up next</span>
                <div className="flex flex-col gap-1.5">
                  {mode.cards.slice(mode.index + 1, mode.index + 6).map((c, i) => (
                    <div
                      key={`${c.id}-${i}`}
                      className="stage-label truncate rounded-lg border border-line bg-well/80 px-3 py-2 text-muted"
                    >
                      {stripMarkdown(c.front)}
                    </div>
                  ))}
                  {mode.cards.length - mode.index - 1 > 5 && (
                    <div className="stage-label px-0.5 text-faint">
                      +{mode.cards.length - mode.index - 6} more
                    </div>
                  )}
                  {mode.index + 1 >= mode.cards.length && (
                    <div className="stage-label px-0.5 text-faint">Last card in this session.</div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CardFace({
  side,
  text,
  source,
  hint,
  compact = false,
}: {
  side: 'front' | 'back'
  text: string
  source?: string | null
  hint?: string
  /** Dock density: a ~320px column, so the padding and the display size both
   *  step down. Same component, same flip — only the scale changes, which is
   *  what keeps the dock from drifting into a second implementation. */
  compact?: boolean
}) {
  const isBack = side === 'back'
  const plain = stripMarkdown(text)
  // At stage size a long face steps down a size rather than overflowing:
  // a 40px display line is for a prompt, not a paragraph.
  const long = plain.length > (isBack ? 260 : 110)
  return (
    <div
      className={cn(
        'cardstock absolute inset-0 flex flex-col rounded-2xl',
        compact ? 'p-4' : 'p-[clamp(20px,2.6cqw,40px)]',
        '[backface-visibility:hidden]',
        isBack && 'bg-raised',
      )}
      style={isBack ? { transform: 'rotateY(180deg)' } : undefined}
    >
      <span className={cn('setcode', !compact && 'stage-label')}>{isBack ? 'Answer' : 'Question'}</span>
      {compact ? (
        <div className="flex flex-1 items-center justify-center py-4">
          <p
            className={cn(
              'text-center',
              isBack ? 'text-[13px] leading-relaxed text-ink-2' : 'nameplate text-[17px] leading-tight text-ink',
            )}
          >
            {plain}
          </p>
        </div>
      ) : (
        // `m-auto` rather than centring the flex box: an over-long face then
        // scrolls from its first line instead of being clipped at the top.
        <div className="flex min-h-0 flex-1 overflow-y-auto py-[clamp(12px,2dvh,24px)]">
          <p
            className={cn(
              'm-auto text-center',
              isBack
                ? cn('max-w-[60ch] leading-relaxed text-ink', long ? 'stage-back-long' : 'stage-back')
                : cn('nameplate max-w-[30ch] leading-[1.05] text-ink', long ? 'stage-face-long' : 'stage-face'),
            )}
          >
            {plain}
          </p>
        </div>
      )}
      <div className="flex items-end justify-between gap-2">
        <span className={cn('setcode truncate', !compact && 'stage-label')}>
          {source ? stripMarkdown(source) : ''}
        </span>
        {hint && <span className={cn('setcode shrink-0', !compact && 'stage-label')}>{hint}</span>}
      </div>
    </div>
  )
}
