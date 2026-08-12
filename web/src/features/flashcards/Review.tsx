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

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { gradeCard } from '../../api/flashcards'
import type { Grade } from '../../api/types'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { ProgressBar } from '../../components/ui/Bits'
import { Tip } from '../../components/ui/Tip'
import { clearStatsCache } from '../../lib/briefCache'
import { cn } from '../../lib/cn'
import { nextIntervalLabel } from '../../lib/schedule'
import { stripMarkdown } from '../../lib/text'
import { GRADES, type Mode } from './model'

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
  // Keep the handler in a ref so the key listener never goes stale.
  const stateRef = useRef({ mode, card })
  stateRef.current = { mode, card }

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

          {/* The grade row is always here — dimmed and out of the tab order
              until the card is flipped — so the card never jumps a row's
              height at the moment you're reading the answer.

              LEDGER, not cardstock. Grading is a measurement of your own
              recall, so it sits on a rule with its interval as a figure. It
              used to be four bevelled chips in four hues, which reads as four
              unrelated categories — but grading is one ordered scale, and the
              ascending intervals underneath already say so in real numbers.
              Colour is left to carry the only categorical split there is:
              Again means you didn't know it, the other three mean you did. */}
          <div className="flex w-full flex-col gap-3 pb-[5px]">
            <div className="ruled-datum grid grid-cols-4" aria-hidden={!mode.flipped}>
              {GRADES.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => mode.flipped && grade(g.key)}
                  aria-disabled={!mode.flipped}
                  tabIndex={mode.flipped ? 0 : -1}
                  aria-label={`${g.label} — press ${g.hotkey} — next in ${previews[g.key]}`}
                  className={cn(
                    'ruled group flex cursor-pointer flex-col items-center gap-1 px-1 py-3',
                    'transition-colors duration-100 hover:bg-line-soft active:translate-y-px',
                    'focus-visible:bg-line-soft focus-visible:outline-none',
                    !mode.flipped && 'pointer-events-none opacity-30',
                  )}
                >
                  <span className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        'text-[13px] font-bold',
                        g.key === 'again' ? 'text-coral-deep' : 'text-ink-3',
                        'group-hover:text-ink',
                      )}
                    >
                      {g.label}
                    </span>
                    <span className="setcode tabular-nums">{g.hotkey}</span>
                  </span>
                  <span className="text-[12px] tabular-nums text-faint">
                    {previews[g.key]}
                  </span>
                </button>
              ))}
            </div>

            {/* The number under each grade is the single least obvious thing
                on this screen, and it is the whole mechanic. */}
            <Tip id="cards-grades-v1" icon="clock" className="mt-4">
              The number under each grade is when you'll see this card next.
              <strong className="font-semibold text-ink-3"> Again</strong> resets
              it to one day; <strong className="font-semibold text-ink-3">Easy</strong>{' '}
              pushes it furthest out. Answer honestly — the schedule only works
              if the grades are true.
            </Tip>
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
                      <span className={cn('nameplate text-[16px] tabular-nums', g.text)}>
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
  return (
    <div
      className={cn(
        'cardstock absolute inset-0 flex flex-col rounded-2xl',
        compact ? 'p-4' : 'p-6 sm:p-8',
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
              ? cn('leading-relaxed text-ink-2', compact ? 'text-[13px]' : 'text-[15px]')
              : cn(
                  'nameplate leading-tight text-ink',
                  compact ? 'text-[17px]' : 'text-[clamp(22px,4vw,32px)]',
                ),
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
