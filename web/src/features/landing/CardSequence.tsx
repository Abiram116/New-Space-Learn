/**
 * One card at a time, in sequence.
 *
 * The scroll drives a single pointer through four beats. Each beat brings a
 * card in, expands it to show what that artifact actually is, holds it while
 * you read, then collapses it away as the next one arrives. Only ever one
 * card open — which is the point. Four cards floating at once asks you to
 * pick where to look; one card at a time tells you what to look at, and lets
 * each artifact get the whole screen for a moment.
 *
 * This replaces a version where all four spilled out together and could be
 * dragged around. That was more fun to fiddle with and much worse at
 * explaining anything: the cards were too small to read, and nothing said
 * which came first.
 *
 * The expand is a genuine scale change of the card's own box, not a
 * cross-fade between a small and large copy — so the collapsed chip and the
 * open panel are visibly the same object, and the sequence reads as one card
 * growing rather than a slideshow.
 */

import { type CSSProperties } from 'react'
import { Icon, type IconName } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { mapRange, useScrollProgress } from '../../lib/useScrollProgress'
import { useReducedMotion } from '../../components/ui/motion'
import { EASE_CSS } from './language'

export type SequenceCard = {
  icon: IconName
  kind: string
  title: string
  body: string
  code?: string
  tone: 'brand' | 'sky' | 'sun' | 'mint'
}

const TONE: Record<SequenceCard['tone'], string> = {
  brand: 'bg-brand-soft text-brand-deep',
  sky: 'bg-sky-soft text-sky-deep',
  sun: 'bg-sun-soft text-sun-deep',
  mint: 'bg-mint-soft text-mint-deep',
}

export function CardSequence({ cards }: { cards: SequenceCard[] }) {
  const reduced = useReducedMotion()
  const { ref, progress } = useScrollProgress<HTMLDivElement>()

  // Reduced motion gets the whole set laid out, no pinning, no sequencing.
  if (reduced) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-24 sm:grid-cols-2">
        {cards.map((c) => (
          <OpenCard key={c.kind} card={c} />
        ))}
      </section>
    )
  }

  // Each card owns an equal slice of the scroll, with a little lead-in
  // before the first so the section doesn't start mid-animation.
  const lead = 0.08
  const slice = (1 - lead) / cards.length

  return (
    <div ref={ref} className="relative" style={{ height: `${cards.length * 110 + 60}svh` }}>
      <div className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden">
        {/* Beat counter — tells you how far through the set you are, so the
            pin reads as progress rather than as a stuck page. */}
        <div className="pointer-events-none absolute left-1/2 top-[13svh] z-30 flex -translate-x-1/2 gap-2">
          {cards.map((c, i) => {
            const start = lead + i * slice
            const on = progress >= start - slice * 0.35 && progress < start + slice * 0.85
            return (
              <span
                key={c.kind}
                className={cn(
                  'h-1 rounded-full transition-all duration-300',
                  on ? 'w-9 bg-brand' : 'w-4 bg-line',
                )}
                style={{ transitionTimingFunction: EASE_CSS }}
              />
            )
          })}
        </div>

        {cards.map((card, i) => {
          const start = lead + i * slice
          // in → hold → out, inside this card's own slice.
          const enter = mapRange(progress, start - slice * 0.34, start + slice * 0.1, 0, 1)
          const exit = mapRange(progress, start + slice * 0.62, start + slice * 0.92, 0, 1)
          const live = enter * (1 - exit)

          if (live <= 0.001) return null

          // Rises in, settles, sinks out — never snapping between states.
          const y = (1 - enter) * 90 - exit * 90
          const scale = 0.82 + live * 0.18
          const rot = (1 - enter) * -4 + exit * 4

          return (
            <div
              key={card.kind}
              className="absolute px-5"
              style={
                {
                  zIndex: 10 + i,
                  opacity: live,
                  transform: `translateY(${y}px) scale(${scale}) rotate(${rot}deg)`,
                } as CSSProperties
              }
            >
              <OpenCard card={card} index={i} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OpenCard({ card, index }: { card: SequenceCard; index?: number }) {
  return (
    <article className="cardstock foil w-[min(90vw,660px)] rounded-2xl p-7 sm:p-9">
      <div className="mb-5 flex items-center gap-3">
        <span className={cn('grid h-10 w-10 place-items-center rounded-xl', TONE[card.tone])}>
          <Icon name={card.icon} size={19} />
        </span>
        <span className="setcode">{card.kind}</span>
        {index !== undefined && (
          <span className="setcode ml-auto text-faint">
            {String(index + 1).padStart(2, '0')}
          </span>
        )}
      </div>

      <p className="nameplate text-[clamp(26px,4.2vw,46px)] leading-[0.95] text-ink">
        {card.title}
      </p>
      <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-3">{card.body}</p>

      {card.code && (
        <div className="mt-6 flex items-center gap-2 border-t border-line pt-4">
          <Icon name="doc" size={13} className="shrink-0 text-faint" />
          <span className="setcode truncate">{card.code}</span>
        </div>
      )}
    </article>
  )
}
