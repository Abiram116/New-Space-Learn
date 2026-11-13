/**
 * "Review again": flip through a deck's cards when none are due.
 *
 * There are no grades here, on purpose. Every grade the server receives
 * rewrites the card's FSRS state and its due date (`grade_card`), so grading a
 * card early would move the schedule and count as a real review. This sends
 * nothing: flip, next, back. The screen says so in one line.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { SubspaceHeader } from '../../components/layout/SubspaceHeader'
import { useImmersive } from '../../components/layout/immersive'
import { ProgressBar } from '../../components/ui/Bits'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { useReducedMotion } from '../../components/ui/motion'
import { EASE } from '../../components/celebrate/easing'
import { cn } from '../../lib/cn'
import { useIsMobile } from '../../lib/useIsMobile'
import { anyModalOpen, stageKeyGate } from '../quizzes/keys'
import { PhoneTopRow } from '../quizzes/phoneKit'
import { Kbd, StageCount } from '../quizzes/StageKit'
import { PhoneFace } from './PhoneReview'
import { CardFace } from './Review'
import { PRACTICE_NOTE, type Mode } from './model'

/** Marks the card itself: Enter/Space on it runs the keys below, once. */
const OWN = 'data-review-key'

export function Practice({
  mode,
  setMode,
  onExit,
  title,
}: {
  mode: Extract<Mode, { kind: 'practice' }>
  setMode: (m: Mode) => void
  onExit: () => void
  title: string
}) {
  const card = mode.cards[mode.index]
  const total = mode.cards.length
  const last = mode.index + 1 >= total
  const isMobile = useIsMobile()
  useImmersive(isMobile)
  const reduced = useReducedMotion()

  // Keep the handlers in a ref so the key listener never goes stale.
  const stateRef = useRef({ mode, onExit })
  useLayoutEffect(() => {
    stateRef.current = { mode, onExit }
  })

  const flip = useCallback(() => {
    const m = stateRef.current.mode
    setMode({ ...m, flipped: !m.flipped })
  }, [setMode])
  const go = useCallback(
    (step: 1 | -1) => {
      const { mode: m, onExit: exit } = stateRef.current
      const index = m.index + step
      if (index < 0) return
      if (index >= m.cards.length) exit()
      else setMode({ ...m, index, flipped: false })
    },
    [setMode],
  )
  /** The main button, and Space/Enter: show the answer, then move on. */
  const advance = useCallback(() => {
    if (stateRef.current.mode.flipped) go(1)
    else flip()
  }, [flip, go])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Space only flips (and flips back); Enter is the one that moves on.
      const action = e.key === ' ' || e.key === 'Spacebar'
        ? flip
        : e.key === 'Enter'
          ? () => {
              if (stateRef.current.mode.flipped) go(1)
            }
        : e.key === 'ArrowRight'
          ? () => go(1)
          : e.key === 'ArrowLeft'
            ? () => go(-1)
            : e.key === 'Escape' || e.key === 'Esc'
              ? () => stateRef.current.onExit()
              : null
      const gate = stageKeyGate(e, { ownAttr: OWN, modalOpen: anyModalOpen(), wouldHandle: action !== null })
      if (gate === 'ignore') return
      e.preventDefault()
      if (gate === 'handle') action?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, go])

  if (!card) return null

  const nextLabel = !mode.flipped ? 'Show answer' : last ? 'Done' : 'Next card'
  // Keyed per card so the next one arrives face-up instead of turning over.
  const face = (
    <button
      key={mode.index}
      type="button"
      onClick={flip}
      {...{ [OWN]: '' }}
      aria-label={mode.flipped ? 'Show question' : 'Flip card'}
      className={cn(
        'relative h-full w-full cursor-pointer rounded-2xl text-left',
        '[transform-style:preserve-3d] motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-300',
        isMobile && 'phone-tap',
      )}
      style={{
        transform: mode.flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        transition: reduced ? 'none' : `transform 620ms ${EASE.flip}`,
      }}
    >
      {isMobile ? (
        <>
          <PhoneFace side="front" text={card.front} />
          <PhoneFace side="back" text={card.back} source={card.source} />
        </>
      ) : (
        <>
          <CardFace side="front" text={card.front} />
          <CardFace side="back" text={card.back} source={card.source} />
        </>
      )}
    </button>
  )
  const bar = <ProgressBar value={((mode.index + 1) / total) * 100} className={isMobile ? 'h-1' : undefined} />

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="phone-practice">
        <PhoneTopRow
          onClose={onExit}
          closeLabel="End practice"
          current={mode.index + 1}
          total={total}
          noun="Card"
          bar={bar}
        />
        <div className="min-h-0 flex-1 px-4 pb-2 pt-3 [perspective:1600px]">{face}</div>
        <div className="shrink-0 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-1">
          <p className="flex min-h-7 items-center justify-center text-center text-[13px] text-muted">
            {PRACTICE_NOTE}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="xl"
              className="min-h-14"
              onClick={() => go(-1)}
              disabled={mode.index === 0}
              aria-label="Previous card"
            >
              <Icon name="arrowLeft" size={16} />
            </Button>
            <Button size="xl" className="min-h-14 flex-1" onClick={advance}>
              {nextLabel}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubspaceHeader
        title={title}
        breadcrumb={false}
        actions={
          <Button variant="ghost" size="sm" onClick={onExit}>
            <Icon name="close" size={14} /> End practice
            <span className="stage-keys ml-1 text-[0.85em]">
              <Kbd k="Esc" />
            </span>
          </Button>
        }
      />

      <div className="study-stage flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="stage-grid">
          <div className="stage-main flex flex-col gap-[clamp(16px,2.6dvh,30px)]">
            <div className="flex flex-col gap-3">
              <StageCount current={mode.index + 1} total={total} noun="Card" />
              {bar}
            </div>

            <div className="stage-card w-full">
              <div className="h-full w-full [perspective:1800px]">{face}</div>
            </div>

            <div className="flex flex-col items-center gap-3">
              <div className="flex w-full justify-center gap-2">
                <Button variant="secondary" size="lg" onClick={() => go(-1)} disabled={mode.index === 0}>
                  <Icon name="arrowLeft" size={15} /> Back
                </Button>
                <Button size="lg" className="min-w-40" onClick={advance}>
                  {nextLabel}
                </Button>
              </div>
              <p className="stage-label text-center text-muted">{PRACTICE_NOTE}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
