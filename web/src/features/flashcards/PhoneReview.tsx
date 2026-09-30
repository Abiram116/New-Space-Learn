/**
 * Card review, made for a thumb.
 *
 * Immersive: the shell's bars step aside (see `useImmersive`), leaving a slim
 * top row, one big card, and a thumb-zone footer. The footer is ONE thing at a
 * time in the same place: a large "Show answer" before the flip, the four
 * grades after it — so nothing jumps under a finger mid-session.
 *
 * Swiping the flipped card is a shortcut for the two grades you reach for most
 * (right = Good, left = Again). It moves the card with `transform` only and is
 * never the only way to grade; the buttons are always there.
 */

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Flashcard, Grade } from '../../api/types'
import { Icon } from '../../components/ui/Icon'
import { ProgressBar } from '../../components/ui/Bits'
import { EASE } from '../../components/celebrate/easing'
import { cn } from '../../lib/cn'
import { stripMarkdown } from '../../lib/text'
import { PhoneTopRow, haptic, seenOnce } from '../quizzes/phoneKit'
import { GRADES } from './model'

const SWIPE_HINT_KEY = 'sl:review-swipe-hint-v1'
/** Pixels of horizontal travel before a drag counts as a swipe rather than a tap. */
const START_PX = 10

export function PhoneReview({
  index,
  total,
  card,
  flipped,
  previews,
  highlight,
  cardRef,
  faceRef,
  barRef,
  gradeRefs,
  reduced,
  ambience,
  onClose,
  onFlip,
  onGrade,
  onHighlight,
}: {
  index: number
  total: number
  card: Flashcard
  flipped: boolean
  previews: Record<Grade, string>
  highlight: number
  cardRef: RefObject<HTMLDivElement | null>
  faceRef: RefObject<HTMLButtonElement | null>
  barRef: RefObject<HTMLDivElement | null>
  gradeRefs: RefObject<(HTMLButtonElement | null)[]>
  reduced: boolean
  /** The (light) ambience field, rendered behind everything. */
  ambience: ReactNode
  onClose: () => void
  onFlip: () => void
  onGrade: (g: Grade) => void
  onHighlight: (i: number) => void
}) {
  const layerRef = useRef<HTMLDivElement>(null)
  const goodRef = useRef<HTMLSpanElement>(null)
  const againRef = useRef<HTMLSpanElement>(null)
  const drag = useRef<{ x: number; y: number; dx: number; active: boolean } | null>(null)
  const swallowClick = useRef(false)
  const [hintSeen, setHintSeen] = useState(() => seenOnce(SWIPE_HINT_KEY).seen)

  const gradeAndTick = (g: Grade) => {
    haptic(10)
    if (!hintSeen) {
      seenOnce(SWIPE_HINT_KEY).mark()
      setHintSeen(true)
    }
    onGrade(g)
  }

  // A new card arrives centred: clear whatever the last swipe left behind.
  useLayoutEffect(() => {
    const el = layerRef.current
    if (el) {
      el.style.transform = ''
      el.style.opacity = ''
    }
    if (goodRef.current) goodRef.current.style.opacity = '0'
    if (againRef.current) againRef.current.style.opacity = '0'
  }, [index])

  const paint = (dx: number) => {
    const el = layerRef.current
    if (!el) return
    el.style.transform = `translate3d(${dx}px,0,0) rotate(${dx / 24}deg)`
    const t = Math.min(1, Math.abs(dx) / 110)
    if (goodRef.current) goodRef.current.style.opacity = dx > 0 ? String(t) : '0'
    if (againRef.current) againRef.current.style.opacity = dx < 0 ? String(t) : '0'
  }

  const springBack = (from: number) => {
    const el = layerRef.current
    if (!el) return
    if (!reduced && el.animate) {
      el.animate(
        [
          { transform: `translate3d(${from}px,0,0) rotate(${from / 24}deg)` },
          { transform: 'none' },
        ],
        { duration: 240, easing: EASE.spring },
      )
    }
    paint(0)
    el.style.transform = ''
  }

  const onPointerDown = (e: React.PointerEvent) => {
    swallowClick.current = false
    // Only a flipped card can be graded, so only a flipped card can be swiped.
    if (!flipped || (e.pointerType === 'mouse' && e.button !== 0)) return
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, active: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.active) {
      if (Math.abs(dy) > START_PX && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null // a vertical scroll of a long answer — not ours
        return
      }
      if (Math.abs(dx) > START_PX && Math.abs(dx) > Math.abs(dy) * 1.3) {
        d.active = true
        swallowClick.current = true
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* synthetic pointer — fine */
        }
      } else return
    }
    d.dx = dx
    paint(dx)
  }

  const finish = (cancelled: boolean) => {
    const d = drag.current
    drag.current = null
    if (!d?.active) return
    const width = layerRef.current?.offsetWidth ?? 320
    const far = Math.abs(d.dx) > Math.max(84, width * 0.27)
    if (cancelled || !far) {
      springBack(d.dx)
      return
    }
    const dir = d.dx > 0 ? 1 : -1
    const el = layerRef.current
    const leave = () => gradeAndTick(dir > 0 ? 'good' : 'again')
    if (!el || reduced || !el.animate) {
      leave()
      return
    }
    const to = `translate3d(${dir * width * 1.15}px,0,0) rotate(${dir * 9}deg)`
    el.style.transform = to
    const a = el.animate(
      [{ transform: `translate3d(${d.dx}px,0,0) rotate(${d.dx / 24}deg)` }, { transform: to }],
      { duration: 170, easing: 'ease-in' },
    )
    a.onfinish = leave
    a.oncancel = leave
  }

  const showHint = flipped && !hintSeen

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col" data-testid="phone-review">
      {ambience}

      <PhoneTopRow
        onClose={onClose}
        closeLabel="End session"
        current={index + 1}
        total={total}
        noun="Card"
        bar={
          <div ref={barRef}>
            <ProgressBar value={(index / total) * 100} className="h-1" />
          </div>
        }
      />

      {/* The card zone takes every pixel the top row and footer leave. */}
      <div className="relative min-h-0 flex-1 px-4 pb-2 pt-3">
        <div
          ref={layerRef}
          className="h-full w-full touch-pan-y will-change-transform"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => finish(false)}
          onPointerCancel={() => finish(true)}
          onClickCapture={(e) => {
            if (swallowClick.current) {
              swallowClick.current = false
              e.preventDefault()
              e.stopPropagation()
            }
          }}
        >
          <div ref={cardRef} className="h-full w-full [perspective:1600px]">
            <button
              key={index}
              ref={faceRef}
              type="button"
              onClick={onFlip}
              data-review-key=""
              aria-label={flipped ? 'Show question' : 'Flip card'}
              className={cn(
                'phone-tap relative h-full w-full rounded-2xl text-left',
                '[transform-style:preserve-3d] motion-reduce:transition-none',
                'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-300',
              )}
              style={{
                transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                transition: reduced ? 'none' : `transform 620ms ${EASE.flip}`,
              }}
            >
              <PhoneFace side="front" text={card.front} />
              <PhoneFace side="back" text={card.back} source={card.source} />
            </button>
          </div>
        </div>

        {/* What the swipe will do, fading in as the card leaves. */}
        <span
          ref={againRef}
          aria-hidden
          style={{ opacity: 0 }}
          className="pointer-events-none absolute left-7 top-7 rounded-full bg-coral-soft px-3 py-1.5 text-[14px] font-bold text-coral-deep"
        >
          Again
        </span>
        <span
          ref={goodRef}
          aria-hidden
          style={{ opacity: 0 }}
          className="pointer-events-none absolute right-7 top-7 rounded-full bg-sky-soft px-3 py-1.5 text-[14px] font-bold text-sky-deep"
        >
          Good
        </span>
      </div>

      {/* Thumb zone. Same footprint before and after the flip. */}
      <div className="shrink-0 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-1">
        <p className="flex h-7 items-center justify-center gap-2 text-[13px] text-muted" aria-live="polite">
          {showHint ? (
            <>
              <Icon name="arrowLeft" size={13} />
              Swipe left for Again, right for Good
              <Icon name="arrowRight" size={13} />
            </>
          ) : flipped ? (
            'How well did you know it?'
          ) : (
            'Tap the card to flip it'
          )}
        </p>

        {flipped ? (
          <div className="grid grid-cols-4 gap-2">
            {GRADES.map((g, i) => {
              const active = highlight === i
              return (
                <button
                  key={g.key}
                  ref={(el) => void (gradeRefs.current[i] = el)}
                  type="button"
                  data-review-key=""
                  data-grade-index={i}
                  data-active={active || undefined}
                  onClick={() => gradeAndTick(g.key)}
                  onFocus={() => onHighlight(i)}
                  tabIndex={active ? 0 : -1}
                  aria-label={`${g.label} — next in ${previews[g.key]}`}
                  className={cn(
                    'phone-tap stage-grade flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border-[1.5px] px-1 py-2',
                    't-control duration-150 active:translate-y-px active:bg-raised',
                    g.key === 'again' ? 'border-coral/40 bg-coral-soft/50' : 'border-line bg-surface',
                  )}
                >
                  <span
                    className={cn(
                      'text-[16px] font-bold leading-none',
                      g.key === 'again' ? 'text-coral-deep' : 'text-ink',
                    )}
                  >
                    {g.label}
                  </span>
                  <span className="text-[12.5px] tabular-nums leading-tight text-muted">
                    {previews[g.key]}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={onFlip}
            data-review-key=""
            className="phone-tap flex min-h-16 w-full items-center justify-center rounded-2xl bg-brand text-[17px] font-bold text-[#1a120f] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_3px_0_#a8331d] active:translate-y-[3px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_0_#a8331d]"
          >
            Show answer
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * One face of the card, sized to what it holds. Text steps down with length
 * rather than shrinking to fit — a 30px prompt and a 16px paragraph are both
 * readable at arm's length, a 12px one squeezed to fit is not. What still
 * doesn't fit scrolls inside the face.
 */
function PhoneFace({
  side,
  text,
  source,
}: {
  side: 'front' | 'back'
  text: string
  source?: string | null
}) {
  const isBack = side === 'back'
  const plain = stripMarkdown(text)
  const n = plain.length
  const size = isBack
    ? n > 320
      ? 'text-[16px] leading-[1.55]'
      : n > 160
        ? 'text-[18px] leading-[1.5]'
        : 'text-[22px] leading-[1.4]'
    : n > 140
      ? 'text-[20px] leading-[1.25]'
      : n > 70
        ? 'text-[25px] leading-[1.15]'
        : 'text-[31px] leading-[1.1]'
  return (
    <div
      className={cn(
        'cardstock absolute inset-0 flex flex-col rounded-2xl p-5',
        '[backface-visibility:hidden]',
        isBack && 'bg-raised',
      )}
      style={isBack ? { transform: 'rotateY(180deg)' } : undefined}
    >
      <span className="setcode text-[12.5px]">{isBack ? 'Answer' : 'Question'}</span>
      {/* `m-auto` rather than centring the flex box, so an over-long face
          scrolls from its first line instead of being clipped at the top. */}
      <div className="flex min-h-0 flex-1 overflow-y-auto py-3">
        <p
          className={cn(
            'm-auto w-full',
            isBack
              ? cn('text-ink', size, n > 140 ? 'text-left' : 'text-center')
              : cn('nameplate text-center text-ink [text-wrap:balance]', size),
          )}
        >
          {plain}
        </p>
      </div>
      {source && (
        <span className="setcode truncate text-[12.5px]">{stripMarkdown(source)}</span>
      )}
    </div>
  )
}
